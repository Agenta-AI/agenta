"""Real agentic loop emitting the v6 UI Message Stream protocol.

This is the un-mocked counterpart to the canned generators in `contract_stream.py`.
It drives a real LLM (via litellm) through a function-calling loop with two tools:

  * ``search_docs``         — auto-executed; runs the real Qdrant retrieval in ``rag.py``.
  * ``send_summary_email``  — human-in-the-loop; the turn PAUSES on a v6
                              ``tool-approval-request`` and only executes on resume,
                              after the user approves.

The conversation is stateless across turns (cold/replay model): on the resume request the
frontend re-POSTs the full history, we reconstruct the OpenAI ``messages`` from it, resolve
the pending approval, and continue the loop. The real Agenta trace id is read from the
span and emitted as ``data-trace`` so "View trace" resolves in the Agenta UI.

The emitted wire parts are byte-for-byte the same v6 contract the mock proves; only the
*content* is now real (real tokens, real retrieved sources, real tool side-effects, a real
trace). Tool-calls and approval are real because this is a genuine agent loop — the thing
the RAG bot in ``main.py`` is not.
"""

import asyncio
import json
import os
import smtplib
import uuid
from email.message import EmailMessage
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

# Delay between streamed tool-output chunks (search hits revealed one at a time). The v6
# protocol has no tool-output-delta, but `tool-output-available` accepts a `preliminary`
# flag, so we emit the growing output as preliminary updates then a final full one.
OUTPUT_CHUNK_DELAY_S = float(os.getenv("AGENT_OUTPUT_CHUNK_DELAY", "0.12"))

# Heavy deps (litellm / qdrant via rag / agenta) are imported lazily inside the functions
# that use them, so this module's pure helpers stay importable without credentials.

# Tools that run immediately vs. tools gated behind human approval.
AUTO_TOOLS = {"search_docs"}
APPROVAL_TOOLS = {"send_summary_email"}

# Cap the agentic loop so a misbehaving model can't spin forever.
MAX_STEPS = 6

AGENT_SYSTEM_PROMPT = (
    "You are Agenta's documentation assistant. "
    "Always call the `search_docs` tool to ground your answer in the docs before "
    "replying, and cite the document titles you used. "
    "If the user asks you to email a summary to someone, call `send_summary_email` — "
    "that tool requires explicit human approval before it runs, so call it and wait. "
    "Answer concisely in markdown."
)

TOOL_SPECS: List[Dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "search_docs",
            "description": "Search the Agenta documentation for passages relevant to a query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query."},
                    "top_k": {
                        "type": "integer",
                        "description": "How many passages to return.",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_summary_email",
            "description": "Send a summary email. Requires human approval before it runs.",
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {"type": "string", "description": "Recipient email address."},
                    "subject": {"type": "string"},
                    "body": {"type": "string"},
                },
                "required": ["to", "subject", "body"],
            },
        },
    },
]


def _sse(obj: Dict[str, Any]) -> str:
    return f"data: {json.dumps(obj)}\n\n"


# ---------------------------------------------------------------------------
# Real tool execution
# ---------------------------------------------------------------------------


def _run_search_docs(args: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Any]]:
    """Execute the real Qdrant-backed retrieval. Returns (tool_output, docs)."""
    from .rag import retrieve  # lazy: qdrant/litellm only loaded in real mode

    query = (args.get("query") or "").strip()
    top_k = args.get("top_k")
    docs = retrieve(query, top_k=top_k)
    output = {
        "hits": [
            {
                "title": d.title,
                "url": d.url,
                "score": round(d.score, 3),
                "snippet": (d.content or "")[:240],
            }
            for d in docs
        ]
    }
    return output, docs


def _run_send_email(args: Dict[str, Any]) -> Dict[str, Any]:
    """Really send the email when SMTP is configured; otherwise record it locally.

    Either way a real side-effect happens — this is not a fabricated ``{status: sent}``.
    Configure SMTP via SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD / SMTP_FROM to
    send for real; without it the message is appended to ``sent_emails.jsonl`` so the
    approval gate still has an observable effect with no extra credentials.
    """
    to = args.get("to") or ""
    subject = args.get("subject") or ""
    body = args.get("body") or ""

    host = os.getenv("SMTP_HOST")
    if host:
        msg = EmailMessage()
        msg["From"] = os.getenv(
            "SMTP_FROM", os.getenv("SMTP_USER", "agent@example.com")
        )
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587"))) as server:
            server.starttls()
            user, password = os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD")
            if user and password:
                server.login(user, password)
            server.send_message(msg)
        return {"status": "sent", "transport": "smtp", "to": to}

    # No SMTP configured — record locally (a real, inspectable side-effect).
    log_path = Path(__file__).resolve().parent.parent / "sent_emails.jsonl"
    record = {"to": to, "subject": subject, "body": body}
    with log_path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record) + "\n")
    return {
        "status": "recorded",
        "transport": "local-file",
        "path": str(log_path),
        "to": to,
    }


# ---------------------------------------------------------------------------
# Streaming one model step → v6 parts
# ---------------------------------------------------------------------------


async def _stream_step(
    messages: List[Dict[str, Any]],
    model: str,
) -> AsyncGenerator[Any, None]:
    """Call the model once (streaming) and yield v6 SSE strings for text/reasoning.

    The final item yielded is a ``("__result__", text, tool_calls)`` tuple carrying the
    assembled assistant text and any tool calls, so the caller can drive the loop.
    """
    from litellm import acompletion  # lazy: only needed in real mode

    response = await acompletion(
        model=model,
        messages=messages,
        tools=TOOL_SPECS,
        tool_choice="auto",
        stream=True,
    )

    text_id: Optional[str] = None
    reasoning_id: Optional[str] = None
    reasoning_closed = False
    text_buf = ""
    tool_acc: Dict[int, Dict[str, str]] = {}

    async for chunk in response:
        choice = chunk.choices[0]
        delta = choice.delta

        reasoning = getattr(delta, "reasoning_content", None)
        if reasoning:
            if reasoning_id is None:
                reasoning_id = str(uuid.uuid4())
                yield _sse({"type": "reasoning-start", "id": reasoning_id})
            yield _sse(
                {"type": "reasoning-delta", "id": reasoning_id, "delta": reasoning}
            )

        content = getattr(delta, "content", None)
        if content:
            if reasoning_id is not None and not reasoning_closed:
                yield _sse({"type": "reasoning-end", "id": reasoning_id})
                reasoning_closed = True
            if text_id is None:
                text_id = str(uuid.uuid4())
                yield _sse({"type": "text-start", "id": text_id})
            text_buf += content
            yield _sse({"type": "text-delta", "id": text_id, "delta": content})

        for tc in getattr(delta, "tool_calls", None) or []:
            acc = tool_acc.setdefault(
                tc.index, {"id": "", "name": "", "args": "", "started": ""}
            )
            if tc.id:
                acc["id"] = tc.id
            fn = getattr(tc, "function", None)
            if fn and fn.name:
                acc["name"] += fn.name

            # Open the v6 tool part as soon as we know id + name, then stream the input
            # JSON as `tool-input-delta` chunks so the call's input renders progressively
            # (client part state `input-streaming`) instead of appearing all at once.
            if not acc["started"] and acc["id"] and acc["name"]:
                acc["started"] = "1"
                yield _sse(
                    {
                        "type": "tool-input-start",
                        "toolCallId": acc["id"],
                        "toolName": acc["name"],
                    }
                )
                if acc["args"]:  # flush args that arrived before the name
                    yield _sse(
                        {
                            "type": "tool-input-delta",
                            "toolCallId": acc["id"],
                            "inputTextDelta": acc["args"],
                        }
                    )

            if fn and fn.arguments:
                acc["args"] += fn.arguments
                if acc["started"]:
                    yield _sse(
                        {
                            "type": "tool-input-delta",
                            "toolCallId": acc["id"],
                            "inputTextDelta": fn.arguments,
                        }
                    )

    if reasoning_id is not None and not reasoning_closed:
        yield _sse({"type": "reasoning-end", "id": reasoning_id})
    if text_id is not None:
        yield _sse({"type": "text-end", "id": text_id})

    tool_calls = [tool_acc[idx] for idx in sorted(tool_acc)]
    yield ("__result__", text_buf, tool_calls)


def _parse_args(raw: str) -> Dict[str, Any]:
    try:
        return json.loads(raw) if raw else {}
    except (json.JSONDecodeError, TypeError):
        return {}


# ---------------------------------------------------------------------------
# History reconstruction (stateless resume)
# ---------------------------------------------------------------------------


def _messages_from_uimessage(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Track A: rebuild OpenAI messages from AI SDK ``UIMessage[]`` (parts)."""
    out: List[Dict[str, Any]] = []
    for m in body.get("messages") or []:
        role = m.get("role")
        parts = m.get("parts") or []
        text = " ".join(
            p.get("text", "") for p in parts if p.get("type") == "text"
        ).strip()
        if role == "user":
            out.append({"role": "user", "content": text})
        elif role == "assistant":
            tool_parts = [
                p for p in parts if str(p.get("type", "")).startswith("tool-")
            ]
            if tool_parts:
                out.append(
                    {
                        "role": "assistant",
                        "content": text or None,
                        "tool_calls": [
                            {
                                "id": p.get("toolCallId"),
                                "type": "function",
                                "function": {
                                    "name": str(p["type"])[len("tool-") :],
                                    "arguments": json.dumps(p.get("input") or {}),
                                },
                            }
                            for p in tool_parts
                        ],
                    }
                )
                # Tool results for calls that already resolved. The pending approval call
                # (no output yet) is intentionally left unresolved; the loop adds it.
                for p in tool_parts:
                    state = p.get("state")
                    if state == "output-available":
                        out.append(
                            {
                                "role": "tool",
                                "tool_call_id": p.get("toolCallId"),
                                "content": json.dumps(p.get("output")),
                            }
                        )
                    elif state == "output-denied":
                        out.append(
                            {
                                "role": "tool",
                                "tool_call_id": p.get("toolCallId"),
                                "content": json.dumps({"status": "denied"}),
                            }
                        )
            elif text:
                out.append({"role": "assistant", "content": text})
    return out


def _messages_from_agenta(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Track B: the FE already sends OpenAI-shaped messages; pass through the fields the
    model needs (role/content/tool_calls/tool_call_id/name), dropping UI-only extras."""
    out: List[Dict[str, Any]] = []
    for m in body.get("messages") or []:
        msg: Dict[str, Any] = {"role": m.get("role"), "content": m.get("content")}
        if m.get("tool_calls"):
            msg["tool_calls"] = m["tool_calls"]
        if m.get("tool_call_id"):
            msg["tool_call_id"] = m["tool_call_id"]
        if m.get("name"):
            msg["name"] = m["name"]
        out.append(msg)
    return out


# ---------------------------------------------------------------------------
# The turn
# ---------------------------------------------------------------------------


async def run_turn(
    body: Dict[str, Any],
    track: str,
    pending: List[Dict[str, Any]],
) -> AsyncGenerator[str, None]:
    """Drive one agent turn, emitting v6 SSE strings. `pending` are approval decisions
    detected from the request (toolCallId, toolName, input, approved)."""
    from .config import settings  # lazy: pulls python-dotenv only in real mode

    model = settings.LLM_MODEL
    # Echo the resolved session_id on the `start` part per the RFC (§6.2.4).
    start: Dict[str, Any] = {"type": "start", "messageId": str(uuid.uuid4())}
    if body.get("session_id"):
        start["messageMetadata"] = {"sessionId": body["session_id"]}
    yield _sse(start)

    history = (
        _messages_from_agenta(body)
        if track == "agenta"
        else _messages_from_uimessage(body)
    )
    messages: List[Dict[str, Any]] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        *history,
    ]

    # Open a real Agenta span so the run is traced and we can surface its trace id.
    trace_id = None
    answer_text = ""
    span_cm = _open_span("agent_chat")
    span = span_cm.__enter__() if span_cm else None
    try:
        # Record the conversation on the parent span (children auto-capture their own data).
        _set_span_data("inputs", {"messages": history})

        # 1) Resolve any pending approval decisions first (resume path).
        for tool in pending:
            tool_call_id = tool["toolCallId"]
            if tool["approved"]:
                output = _run_send_email(tool.get("input") or {})
                yield _sse(
                    {
                        "type": "tool-output-available",
                        "toolCallId": tool_call_id,
                        "output": output,
                    }
                )
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": json.dumps(output),
                    }
                )
            else:
                yield _sse({"type": "tool-output-denied", "toolCallId": tool_call_id})
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": json.dumps(
                            {"status": "denied", "note": "User declined."}
                        ),
                    }
                )

        # 2) Agentic loop: model → tools → model … until a final text or an approval pause.
        for _ in range(MAX_STEPS):
            text_buf = ""
            tool_calls: List[Dict[str, str]] = []
            async for item in _stream_step(messages, model):
                if isinstance(item, tuple) and item and item[0] == "__result__":
                    _, text_buf, tool_calls = item
                else:
                    yield item
            if text_buf:
                answer_text += text_buf

            assistant_msg: Dict[str, Any] = {
                "role": "assistant",
                "content": text_buf or None,
            }
            if tool_calls:
                assistant_msg["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["args"] or "{}",
                        },
                    }
                    for tc in tool_calls
                ]
            messages.append(assistant_msg)

            if not tool_calls:
                break  # model produced a final answer

            approval_pending = False
            for tc in tool_calls:
                name, call_id = tc["name"], tc["id"]
                args = _parse_args(tc["args"])
                # `tool-input-start` + `tool-input-delta`s were already streamed in
                # `_stream_step`; here we just finalize the input.
                yield _sse(
                    {
                        "type": "tool-input-available",
                        "toolCallId": call_id,
                        "toolName": name,
                        "input": args,
                    }
                )

                if name in AUTO_TOOLS:
                    output, docs = _run_search_docs(args)
                    for d in docs[:5]:
                        yield _sse(
                            {
                                "type": "source-url",
                                "sourceId": d.url,
                                "url": d.url,
                                "title": d.title,
                            }
                        )
                    # Reveal the hits progressively as `preliminary` outputs, then a
                    # final full output. (The retrieval itself is one call — this just
                    # streams the rendering of the already-computed result.)
                    hits = output.get("hits") if isinstance(output, dict) else None
                    if isinstance(hits, list) and len(hits) > 1:
                        for k in range(1, len(hits)):
                            yield _sse(
                                {
                                    "type": "tool-output-available",
                                    "toolCallId": call_id,
                                    "output": {"hits": hits[:k]},
                                    "preliminary": True,
                                }
                            )
                            await asyncio.sleep(OUTPUT_CHUNK_DELAY_S)
                    yield _sse(
                        {
                            "type": "tool-output-available",
                            "toolCallId": call_id,
                            "output": output,
                        }
                    )
                    messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": call_id,
                            "content": json.dumps(output),
                        }
                    )
                elif name in APPROVAL_TOOLS:
                    yield _sse(
                        {
                            "type": "tool-approval-request",
                            "approvalId": f"approval_{uuid.uuid4().hex[:12]}",
                            "toolCallId": call_id,
                        }
                    )
                    approval_pending = True

            if approval_pending:
                break  # pause the turn for human approval

        _set_span_data("outputs", {"response": answer_text})
        trace_id = _trace_id_of(span)
    finally:
        if span_cm:
            span_cm.__exit__(None, None, None)

    if trace_id:
        # data-trace part (legacy/fallback channel) …
        yield _sse(
            {
                "type": "data-trace",
                "data": {
                    "traceId": trace_id,
                    "url": f"{settings.AGENTA_HOST}/observability/traces/{trace_id}",
                },
            }
        )
        # … and the RFC-aligned channel: traceId on the finish messageMetadata.
        yield _sse({"type": "finish", "messageMetadata": {"traceId": trace_id}})
    else:
        yield _sse({"type": "finish"})
    yield "data: [DONE]\n\n"


# ---------------------------------------------------------------------------
# Agenta tracing helpers (no-op if the SDK isn't initialized)
# ---------------------------------------------------------------------------


def _open_span(name: str):
    try:
        import agenta as ag

        return ag.tracer.start_as_current_span(name)
    except Exception:
        return None


def _set_span_data(key: str, value: Any) -> None:
    """Set `inputs`/`outputs` on the active Agenta span (no-op if tracing isn't init'd).

    The parent `agent_chat` span is a manual span, so it doesn't auto-capture data the way
    `@ag.instrument()` children do — we populate it explicitly so the trace shows the
    conversation in and the final answer out.
    """
    try:
        import agenta as ag

        span = ag.tracing.get_current_span()
        if span is not None:
            span.set_attributes({key: value}, namespace="data")
    except Exception:
        pass


def _trace_id_of(span) -> Optional[str]:
    if span is None:
        return None
    try:
        from opentelemetry.trace import format_trace_id

        ctx = span.get_span_context()
        if ctx and ctx.is_valid:
            return format_trace_id(ctx.trace_id)
    except Exception:
        return None
    return None
