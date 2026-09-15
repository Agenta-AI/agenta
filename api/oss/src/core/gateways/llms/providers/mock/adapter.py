"""In-process mock LLM upstream.

No socket, no process. Registered once, statically, under the "mock" adapter key
Controllable behavior is keyed by `context.model`,
checked as a prefix so the base model name stays free-form:

    mock/echo         (default; any name matching no other suffix below)
    mock/error        raises LLMUpstreamError
    mock/slow-{n}     sleeps n seconds, then answers like mock/echo

`context.protocol` picks the response shape — Chat Completions, OpenAI
Responses or Anthropic Messages — so the three front doors each have something protocol-
shaped to relay in tests, without any of this adapter's logic branching on the door that
called it beyond this one dispatch.

The deployable app (app.py) calls this same adapter, so both tiers share one
implementation of the control convention.
"""

import asyncio
import json
import re
import time
import uuid
from typing import Any, AsyncIterator, Dict, Iterator, Optional, Tuple

from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LLMRelayResult, LLMUpstreamInterface
from oss.src.core.gateways.llms.types import LLMUpstreamError
from oss.src.core.gateways.policy.dtos import GatewayUsage, ResolvedSecret
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_ERROR_PREFIX = "mock/error"
_SLOW_RE = re.compile(r"^mock/slow-(\d+)")
_MCP_MARKER_RE = re.compile(r"MCP-ACCEPTANCE-[A-Za-z0-9_-]+")


def _parse_slow_seconds(model: str) -> Optional[int]:
    match = _SLOW_RE.match(model)
    return int(match.group(1)) if match else None


def _last_message_content(body: bytes) -> str:
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        return ""

    # "messages" (Chat Completions, Messages) or "input" (Responses) — same shape,
    # different field name on the wire.
    messages = payload.get("messages") or payload.get("input") or []
    if isinstance(messages, str):
        return messages
    if not messages:
        return ""

    content = messages[-1].get("content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return str(content)


def _word_count(text: str) -> int:
    return len(text.split())


def _mcp_marker(body: bytes) -> str | None:
    """Return the deterministic acceptance marker requested by a harness test."""
    match = _MCP_MARKER_RE.search(body.decode(errors="replace"))
    return match.group(0) if match else None


def _contains_tool_result(body: bytes) -> bool:
    text = body.decode(errors="replace").replace(" ", "")
    return any(
        token in text
        for token in (
            '"role":"tool"',
            '"type":"tool_result"',
            '"type":"function_call_output"',
        )
    )


def _tool_result_texts(value: Any) -> Iterator[str]:
    """Yield the text of every TOOL RESULT in a request body, whatever the protocol.

    Three shapes, one per protocol: a Chat Completions ``{"role": "tool"}`` message, an
    Anthropic ``{"type": "tool_result"}`` block, and a Responses
    ``{"type": "function_call_output"}`` item. Each carries its payload under a different key,
    so the key is chosen per shape rather than guessed.
    """
    if isinstance(value, list):
        for item in value:
            yield from _tool_result_texts(item)
        return
    if not isinstance(value, dict):
        return

    payload: Any = None
    if value.get("role") == "tool":
        payload = value.get("content")
    elif value.get("type") == "tool_result":
        payload = value.get("content")
    elif value.get("type") == "function_call_output":
        payload = value.get("output")

    if payload is not None:
        yield json.dumps(payload) if not isinstance(payload, str) else payload

    for child in value.values():
        yield from _tool_result_texts(child)


def _contains_successful_mcp_echo_result(body: bytes, marker: str) -> bool:
    """Recognize the mock MCP adapter's successful echo result in a tool turn.

    The marker has to be found INSIDE a tool result, not merely somewhere in the body. That
    distinction is the whole function: the marker is also in the user prompt and in the generated
    tool-call arguments, so a body that merely contains it and, separately, contains some tool
    result proves nothing about this tool.

    It used to prove nothing, and reported success anyway. A Codex run on 2026-09-15 called an MCP
    tool name its own catalog did not have, produced a `function_call_output` for an unrelated
    tool, and this function read "marker present" plus "a tool result exists" as a round trip that
    never happened — a green transcript for a call that never left the sandbox. A QA fixture that
    passes when the product did nothing is worse than one that fails, so the check now looks where
    the evidence would actually be.

    The echo tool returns the arguments it was called with, so a successful result is a tool result
    whose own text carries the marker and does not report an error.
    """
    try:
        payload = json.loads(body) if body else {}
    except (json.JSONDecodeError, TypeError):
        return False

    for text in _tool_result_texts(payload):
        normalized = text.replace(" ", "").replace("\\", "")
        if marker not in normalized:
            continue
        if (
            '"isError":true' in normalized
            or '"is_error":true' in normalized
            or '"error":' in normalized
        ):
            continue
        return True
    return False


#: The MCP tool the acceptance cells drive, and the server they must declare it under.
MCP_ECHO_TOOL = "echo"
MCP_ECHO_SERVER_NAME = "mock-mcp"

#: A tool-catalog entry names the echo tool when it ends with it, either exactly or after whatever
#: separator the harness renders: Claude writes ``mcp__mock-mcp__echo``, and a harness that renders
#: ``mcp.mock-mcp.echo`` or ``mock-mcp/echo`` matches the same way. Anchored at the end so a tool
#: merely mentioning echo in a longer word does not.
_ECHO_TOOL_NAME_RE = re.compile(rf"(?:^|[^A-Za-z0-9]){MCP_ECHO_TOOL}$", re.IGNORECASE)


def _tool_catalog_entries(
    value: Any, namespace: str | None = None
) -> Iterator[tuple[str | None, str]]:
    """Yield every tool name in a request's tool catalog, as the model would have to CALL it.

    Three shapes, and the third is the one that cost two wrong guesses. Chat Completions nests the
    name under ``function``; Responses and Messages put it on the entry. Codex groups its remote
    MCP tools under a ``{"type": "namespace", "name": "mcp__<server>", "tools": [...]}`` entry, and
    a tool inside one is called as ``<namespace>.<tool>`` — the bare nested name is not callable on
    its own, which is exactly how a catalog read that ignored the nesting still produced a tool
    call Codex refused (2026-09-15, observed in the live catalog).

    Measured, not assumed: this is the shape the Codex harness put on the wire for the mock MCP
    server, recorded in `qa.md`'s MCP permissions section.
    """
    if isinstance(value, list):
        for item in value:
            yield from _tool_catalog_entries(item, namespace)
        return
    if not isinstance(value, dict):
        return

    name = value.get("name")
    own = name if isinstance(name, str) and name else None

    if value.get("type") == "namespace" and own:
        # The namespace itself is not callable; its members are, under its name.
        for item in value.get("tools") or []:
            yield from _tool_catalog_entries(item, own)
        return

    if own:
        yield (namespace, own)

    for key, child in value.items():
        # `name` is this entry's own identity, already handled; every other value may nest a tool.
        if key in ("name", "tools"):
            continue
        yield from _tool_catalog_entries(child, namespace)


#: One resolved tool reference: the namespace it lives in (``None`` at top level) and its own name.
#: They stay separate because Codex's Responses wire keeps them separate — see `_echo_tool_ref`.
EchoToolRef = Tuple[Optional[str], str]


def _echo_tool_ref(body: bytes) -> EchoToolRef | None:
    """Read the harness's OWN reference to the MCP echo tool out of the request's tool catalog.

    Reading beats knowing. Claude renders a flat ``mcp__<server>__<tool>`` while Codex advertises a
    ``{"type": "namespace", "name": "mcp__<server>", "tools": [...]}`` entry, and hardcoding a guess
    per protocol made the Codex cell falsely pass on one guess and then fail on two more, each time
    naming a tool no harness had.

    The namespace is returned beside the name rather than joined into it, because joining is what
    kept failing: Codex's `ResponseItem::FunctionCall` carries `name` and `namespace` as SEPARATE
    wire fields, and reassembles them itself
    (``codex-rs/core/src/tools/router.rs``, ``build_tool_call``, at tag ``rust-v0.154.0`` — the
    version the runner image installs). Any joined spelling arrives as a name in the default
    namespace, matches no registered tool, and comes back as ``unsupported call: <name>``.

    The entries seen are logged, because when the cell fails for a harness whose catalog is absent
    or differently shaped, the list of what WAS offered is the one thing that says why.
    """
    try:
        payload = json.loads(body)
    except (json.JSONDecodeError, TypeError):
        return None

    entries = list(_tool_catalog_entries(payload.get("tools", [])))
    matched = next(
        (entry for entry in entries if _ECHO_TOOL_NAME_RE.search(entry[1])),
        None,
    )
    if entries:
        log.debug(
            "mock LLM: tool catalog carried %d tool(s); echo tool resolved to %r. Names: %s",
            len(entries),
            matched,
            ", ".join(
                name if namespace is None else f"{namespace}/{name}"
                for namespace, name in entries[:24]
            ),
        )
    else:
        log.debug(
            "mock LLM: request carried no tool catalog; falling back to the per-protocol name"
        )
    return matched


#: The fallback when a harness sends no tool catalog in the request, which the ACP harnesses do
#: when they configure remote MCP servers at session start. Only Claude's spelling is MEASURED —
#: it is what `mcp__<server>__<tool>` renders to and what the live Messages cell exercises. Codex
#: is deliberately absent: its spelling was twice guessed wrong, and a wrong entry here is worse
#: than none, because it sends a call for a tool the harness does not have and the cell fails for a
#: reason that looks like the product. Add it only once a live run has printed it (the debug line
#: in `_echo_tool_name`), and pin it with a case in `test_mock_llm_adapter.py`.
MCP_ECHO_TOOL_BY_PROTOCOL: Dict[LLMProtocol, str] = {
    LLMProtocol.MESSAGES: f"mcp__{MCP_ECHO_SERVER_NAME}__{MCP_ECHO_TOOL}",
}


def _default_mcp_echo_tool(protocol: LLMProtocol) -> str | None:
    """The echo tool name for a harness whose request carried no tool catalog to read."""
    return MCP_ECHO_TOOL_BY_PROTOCOL.get(protocol)


def _chat_tool_call_payload(
    *, completion_id: str, created: int, model: str, tool_name: str, marker: str
) -> Dict[str, Any]:
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [
                        {
                            "id": "call_mock_mcp_echo",
                            "type": "function",
                            "function": {
                                "name": tool_name,
                                "arguments": json.dumps({"marker": marker}),
                            },
                        }
                    ],
                },
                "finish_reason": "tool_calls",
            }
        ],
    }


def _messages_tool_call_payload(
    *, message_id: str, model: str, tool_name: str, marker: str
) -> Dict[str, Any]:
    return {
        "id": message_id,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [
            {
                "type": "tool_use",
                "id": "toolu_mock_mcp_echo",
                "name": tool_name,
                "input": {"marker": marker},
            }
        ],
        "stop_reason": "tool_use",
    }


def _responses_tool_call_payload(
    *,
    response_id: str,
    created: int,
    model: str,
    tool_name: str,
    tool_namespace: Optional[str],
    marker: str,
) -> Dict[str, Any]:
    """Codex keeps a namespaced tool's namespace in its own wire field, not joined into the name.

    ``ResponseItem::FunctionCall`` has `name` and an optional `namespace`
    (``codex-rs/protocol/src/models.rs``), and ``build_tool_call`` rebuilds the identity with
    ``ToolName::new(namespace, name)`` (``codex-rs/core/src/tools/router.rs``), both at tag
    ``rust-v0.154.0``. Omitting the field for a namespaced tool puts the call in the default
    namespace, where no MCP tool is registered.
    """
    return {
        "id": response_id,
        "object": "response",
        "created_at": created,
        "model": model,
        "status": "completed",
        "output": [
            {
                "id": "fc_mock_mcp_echo",
                "type": "function_call",
                "call_id": "call_mock_mcp_echo",
                "name": tool_name,
                **({"namespace": tool_namespace} if tool_namespace else {}),
                "arguments": json.dumps({"marker": marker}),
                "status": "completed",
            }
        ],
    }


def _completion_payload(
    *, completion_id: str, created: int, model: str, content: str
) -> Dict[str, Any]:
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
    }


def _chunk_payload(
    *, completion_id: str, created: int, model: str, delta: Dict[str, Any], finish
) -> Dict[str, Any]:
    return {
        "id": completion_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


def _responses_payload(
    *, response_id: str, created: int, model: str, content: str
) -> Dict[str, Any]:
    return {
        "id": response_id,
        "object": "response",
        "created_at": created,
        "model": model,
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": content}],
            }
        ],
    }


def _messages_payload(*, message_id: str, model: str, content: str) -> Dict[str, Any]:
    return {
        "id": message_id,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [{"type": "text", "text": content}],
        "stop_reason": "end_turn",
    }


def _sse(payload: Dict[str, Any]) -> bytes:
    return f"data: {json.dumps(payload)}\n\n".encode()


def _sse_event(event: str, payload: Dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n".encode()


async def _empty_body() -> AsyncIterator[bytes]:
    return
    yield b""  # pragma: no cover — placeholder, makes this an async generator


class MockLLMAdapter(LLMUpstreamInterface):
    """Unauthenticated, in-process mock upstream that never opens a
    socket. `secret` may be None — targets with GatewayAuthScheme.NONE are
    the intended callers."""

    async def relay_chat_completion(
        self,
        *,
        route: LLMResolvedRoute,
        secret: Optional[ResolvedSecret],
        #
        context: LLMCallContext,
        body: bytes,
        headers: Dict[str, str],
    ) -> LLMRelayResult:
        model = context.model

        if model.startswith(_ERROR_PREFIX):
            raise LLMUpstreamError(
                provider_key="mock", status_code=500, detail="forced by mock/error"
            )

        slow_seconds = _parse_slow_seconds(model)
        if slow_seconds is not None:
            await asyncio.sleep(slow_seconds)

        content = _last_message_content(body)
        marker = _mcp_marker(body)
        tool_ref = _echo_tool_ref(body)
        if tool_ref is None:
            fallback = _default_mcp_echo_tool(context.protocol)
            tool_ref = (None, fallback) if fallback else None
        tool_namespace, tool_name = tool_ref if tool_ref else (None, None)
        needs_tool_call = bool(marker and tool_name and not _contains_tool_result(body))
        if marker and _contains_tool_result(body):
            content = (
                f"mock MCP echo: {marker}"
                if _contains_successful_mcp_echo_result(body, marker)
                else "mock MCP tool call failed"
            )
        input_tokens = _word_count(body.decode(errors="replace")) if body else 0
        output_tokens = _word_count(content)
        completion_id = f"chatcmpl-mock-{uuid.uuid4().hex}"
        created = int(time.time())

        result = LLMRelayResult(
            status_code=200,
            headers={
                "content-type": (
                    "text/event-stream" if context.stream else "application/json"
                )
            },
            body=_empty_body(),
        )

        async def _body_iter() -> AsyncIterator[bytes]:
            if context.protocol == LLMProtocol.RESPONSES:
                usage = {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                }
                if needs_tool_call:
                    assert marker is not None and tool_name is not None
                    payload = _responses_tool_call_payload(
                        response_id=completion_id,
                        created=created,
                        model=model,
                        tool_name=tool_name,
                        tool_namespace=tool_namespace,
                        marker=marker,
                    )
                    payload["usage"] = usage
                    if context.stream:
                        sequence_number = 0

                        def _responses_event(
                            event: str, event_payload: Dict[str, Any]
                        ) -> bytes:
                            nonlocal sequence_number
                            framed = _sse_event(
                                event,
                                {"sequence_number": sequence_number, **event_payload},
                            )
                            sequence_number += 1
                            return framed

                        item = payload["output"][0]
                        yield _responses_event(
                            "response.created",
                            {
                                "type": "response.created",
                                "response": {
                                    **payload,
                                    "status": "in_progress",
                                    "output": [],
                                },
                            },
                        )
                        yield _responses_event(
                            "response.output_item.added",
                            {
                                "type": "response.output_item.added",
                                "output_index": 0,
                                "item": {
                                    **item,
                                    "status": "in_progress",
                                    "arguments": "",
                                },
                            },
                        )
                        yield _responses_event(
                            "response.function_call_arguments.delta",
                            {
                                "type": "response.function_call_arguments.delta",
                                "item_id": item["id"],
                                "output_index": 0,
                                "delta": item["arguments"],
                            },
                        )
                        yield _responses_event(
                            "response.function_call_arguments.done",
                            {
                                "type": "response.function_call_arguments.done",
                                "item_id": item["id"],
                                "output_index": 0,
                                "arguments": item["arguments"],
                            },
                        )
                        yield _responses_event(
                            "response.output_item.done",
                            {
                                "type": "response.output_item.done",
                                "output_index": 0,
                                "item": item,
                            },
                        )
                        yield _responses_event(
                            "response.completed",
                            {"type": "response.completed", "response": payload},
                        )
                    else:
                        yield json.dumps(payload).encode()
                elif context.stream:
                    sequence_number = 0

                    def _responses_event(event: str, payload: Dict[str, Any]) -> bytes:
                        nonlocal sequence_number
                        framed = _sse_event(
                            event, {"sequence_number": sequence_number, **payload}
                        )
                        sequence_number += 1
                        return framed

                    response = {
                        "id": completion_id,
                        "object": "response",
                        "created_at": created,
                        "model": model,
                        "status": "in_progress",
                        "output": [],
                    }
                    item = {
                        "id": f"msg-mock-{uuid.uuid4().hex}",
                        "type": "message",
                        "status": "in_progress",
                        "role": "assistant",
                        "content": [],
                    }
                    part = {"type": "output_text", "text": "", "annotations": []}
                    completed_part = {
                        "type": "output_text",
                        "text": content,
                        "annotations": [],
                    }
                    completed_item = {
                        **item,
                        "status": "completed",
                        "content": [completed_part],
                    }
                    yield _responses_event(
                        "response.created",
                        {"type": "response.created", "response": response},
                    )
                    yield _responses_event(
                        "response.in_progress",
                        {"type": "response.in_progress", "response": response},
                    )
                    yield _responses_event(
                        "response.output_item.added",
                        {
                            "type": "response.output_item.added",
                            "output_index": 0,
                            "item": item,
                        },
                    )
                    yield _responses_event(
                        "response.content_part.added",
                        {
                            "type": "response.content_part.added",
                            "item_id": item["id"],
                            "output_index": 0,
                            "content_index": 0,
                            "part": part,
                        },
                    )
                    yield _responses_event(
                        "response.output_text.delta",
                        {
                            "type": "response.output_text.delta",
                            "item_id": item["id"],
                            "output_index": 0,
                            "content_index": 0,
                            "delta": content,
                            "logprobs": [],
                        },
                    )
                    yield _responses_event(
                        "response.output_text.done",
                        {
                            "type": "response.output_text.done",
                            "item_id": item["id"],
                            "output_index": 0,
                            "content_index": 0,
                            "text": content,
                            "logprobs": [],
                        },
                    )
                    yield _responses_event(
                        "response.content_part.done",
                        {
                            "type": "response.content_part.done",
                            "item_id": item["id"],
                            "output_index": 0,
                            "content_index": 0,
                            "part": completed_part,
                        },
                    )
                    yield _responses_event(
                        "response.output_item.done",
                        {
                            "type": "response.output_item.done",
                            "output_index": 0,
                            "item": completed_item,
                        },
                    )
                    completed = _responses_payload(
                        response_id=completion_id,
                        created=created,
                        model=model,
                        content=content,
                    )
                    completed["usage"] = usage
                    completed["status"] = "completed"
                    yield _responses_event(
                        "response.completed",
                        {"type": "response.completed", "response": completed},
                    )
                else:
                    payload = _responses_payload(
                        response_id=completion_id,
                        created=created,
                        model=model,
                        content=content,
                    )
                    payload["usage"] = usage
                    yield json.dumps(payload).encode()

            elif context.protocol == LLMProtocol.MESSAGES:
                usage = {"input_tokens": input_tokens, "output_tokens": output_tokens}
                if needs_tool_call:
                    assert marker is not None and tool_name is not None
                    payload = _messages_tool_call_payload(
                        message_id=completion_id,
                        model=model,
                        tool_name=tool_name,
                        marker=marker,
                    )
                    payload["usage"] = usage
                    if context.stream:
                        block = payload["content"][0]
                        yield _sse_event(
                            "message_start",
                            {
                                "type": "message_start",
                                "message": {
                                    **payload,
                                    "content": [],
                                    "stop_reason": None,
                                },
                            },
                        )
                        yield _sse_event(
                            "content_block_start",
                            {
                                "type": "content_block_start",
                                "index": 0,
                                "content_block": {**block, "input": {}},
                            },
                        )
                        yield _sse_event(
                            "content_block_delta",
                            {
                                "type": "content_block_delta",
                                "index": 0,
                                "delta": {
                                    "type": "input_json_delta",
                                    "partial_json": json.dumps(block["input"]),
                                },
                            },
                        )
                        yield _sse_event(
                            "content_block_stop",
                            {"type": "content_block_stop", "index": 0},
                        )
                        yield _sse_event(
                            "message_delta",
                            {
                                "type": "message_delta",
                                "delta": {"stop_reason": "tool_use"},
                                "usage": usage,
                            },
                        )
                        yield _sse_event("message_stop", {"type": "message_stop"})
                    else:
                        yield json.dumps(payload).encode()
                elif context.stream:
                    message = {
                        "id": completion_id,
                        "type": "message",
                        "role": "assistant",
                        "model": model,
                        "content": [],
                        "stop_reason": None,
                        "stop_sequence": None,
                        "usage": {"input_tokens": input_tokens, "output_tokens": 0},
                    }
                    block = {"type": "text", "text": ""}
                    yield _sse_event(
                        "message_start", {"type": "message_start", "message": message}
                    )
                    yield _sse_event(
                        "content_block_start",
                        {
                            "type": "content_block_start",
                            "index": 0,
                            "content_block": block,
                        },
                    )
                    yield _sse_event(
                        "content_block_delta",
                        {
                            "type": "content_block_delta",
                            "delta": {"type": "text_delta", "text": content},
                        },
                    )
                    yield _sse_event(
                        "content_block_stop", {"type": "content_block_stop", "index": 0}
                    )
                    yield _sse_event(
                        "message_delta",
                        {
                            "type": "message_delta",
                            "delta": {"stop_reason": "end_turn"},
                            "usage": usage,
                        },
                    )
                    yield _sse_event("message_stop", {"type": "message_stop"})
                else:
                    payload = _messages_payload(
                        message_id=completion_id, model=model, content=content
                    )
                    payload["usage"] = usage
                    yield json.dumps(payload).encode()

            else:
                if needs_tool_call:
                    assert marker is not None and tool_name is not None
                    payload = _chat_tool_call_payload(
                        completion_id=completion_id,
                        created=created,
                        model=model,
                        tool_name=tool_name,
                        marker=marker,
                    )
                    payload["usage"] = {
                        "prompt_tokens": input_tokens,
                        "completion_tokens": output_tokens,
                        "total_tokens": input_tokens + output_tokens,
                    }
                    if context.stream:
                        tool_call = payload["choices"][0]["message"]["tool_calls"][0]
                        yield _sse(
                            _chunk_payload(
                                completion_id=completion_id,
                                created=created,
                                model=model,
                                delta={
                                    "role": "assistant",
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": tool_call["id"],
                                            "type": "function",
                                            "function": {
                                                "name": tool_call["function"]["name"],
                                                "arguments": tool_call["function"][
                                                    "arguments"
                                                ],
                                            },
                                        }
                                    ],
                                },
                                finish=None,
                            )
                        )
                        yield _sse(
                            _chunk_payload(
                                completion_id=completion_id,
                                created=created,
                                model=model,
                                delta={},
                                finish="tool_calls",
                            )
                        )
                        yield b"data: [DONE]\n\n"
                    else:
                        yield json.dumps(payload).encode()
                elif context.stream:
                    yield _sse(
                        _chunk_payload(
                            completion_id=completion_id,
                            created=created,
                            model=model,
                            delta={"role": "assistant", "content": content},
                            finish=None,
                        )
                    )
                    yield _sse(
                        _chunk_payload(
                            completion_id=completion_id,
                            created=created,
                            model=model,
                            delta={},
                            finish="stop",
                        )
                    )
                    yield b"data: [DONE]\n\n"
                else:
                    payload = _completion_payload(
                        completion_id=completion_id,
                        created=created,
                        model=model,
                        content=content,
                    )
                    payload["usage"] = {
                        "prompt_tokens": input_tokens,
                        "completion_tokens": output_tokens,
                        "total_tokens": input_tokens + output_tokens,
                    }
                    yield json.dumps(payload).encode()

            result.usage = GatewayUsage(
                calls=1,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
                cost=0.0,
            )

        result.body = _body_iter()
        return result
