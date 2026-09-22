"""Unit tests for `MockLLMAdapter`.

Nothing running: the adapter is exercised as a plain Python object.
"""

import json
import time

import pytest

from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LLMRelayResult
from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter
from oss.src.core.gateways.llms.types import LLMUpstreamError


def _route(model: str = "mock/echo") -> LLMResolvedRoute:
    return LLMResolvedRoute(
        provider_key="mock", deployment_kind=LLMDeploymentKind.DIRECT, model=model
    )


def _body(content: str = "hello") -> bytes:
    return json.dumps(
        {"model": "mock/echo", "messages": [{"role": "user", "content": content}]}
    ).encode()


async def _drain(body):
    return [chunk async for chunk in body]


@pytest.mark.asyncio
async def test_echo_returns_well_formed_result():
    adapter = MockLLMAdapter()
    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo"),
        body=_body("hello there"),
        headers={},
    )

    assert isinstance(result, LLMRelayResult)
    assert result.status_code == 200

    chunks = await _drain(result.body)
    assert len(chunks) == 1
    payload = json.loads(chunks[0])
    assert payload["choices"][0]["message"]["content"] == "hello there"
    assert payload["object"] == "chat.completion"


@pytest.mark.asyncio
async def test_error_model_raises_upstream_error():
    adapter = MockLLMAdapter()

    with pytest.raises(LLMUpstreamError) as excinfo:
        await adapter.relay_chat_completion(
            route=_route("mock/error"),
            secret=None,
            context=LLMCallContext(model="mock/error"),
            body=_body(),
            headers={},
        )

    assert excinfo.value.provider_key == "mock"
    assert excinfo.value.status_code == 500


@pytest.mark.asyncio
async def test_slow_model_sleeps_before_returning():
    adapter = MockLLMAdapter()
    start = time.monotonic()

    result = await adapter.relay_chat_completion(
        route=_route("mock/slow-1"),
        secret=None,
        context=LLMCallContext(model="mock/slow-1"),
        body=_body(),
        headers={},
    )
    elapsed = time.monotonic() - start

    assert elapsed >= 1
    assert result.status_code == 200
    await _drain(result.body)


@pytest.mark.asyncio
async def test_streaming_yields_multiple_chunks_ending_in_done():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", stream=True),
        body=_body("hi"),
        headers={},
    )

    chunks = await _drain(result.body)
    assert len(chunks) > 1
    assert chunks[-1] == b"data: [DONE]\n\n"
    for chunk in chunks[:-1]:
        assert chunk.startswith(b"data: ")


@pytest.mark.asyncio
async def test_usage_populated_after_body_exhausted():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo"),
        body=_body("hello world"),
        headers={},
    )
    assert result.usage is None

    await _drain(result.body)

    assert result.usage is not None
    assert result.usage.calls == 1
    assert result.usage.cost == 0.0
    assert result.usage.input_tokens is not None
    assert result.usage.output_tokens is not None


# Protocol-shaped bodies


@pytest.mark.asyncio
async def test_responses_non_streaming_body_and_usage():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=_body("hello there"),
        headers={},
    )

    chunks = await _drain(result.body)
    payload = json.loads(chunks[0])
    assert payload["object"] == "response"
    assert payload["output"][0]["content"][0]["text"] == "hello there"
    assert payload["usage"]["output_tokens"] == result.usage.output_tokens


@pytest.mark.asyncio
async def test_responses_streaming_ends_with_a_completed_frame_carrying_usage():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(
            model="mock/echo", stream=True, protocol=LLMProtocol.RESPONSES
        ),
        body=_body("hi"),
        headers={},
    )

    chunks = await _drain(result.body)
    frames = [json.loads(chunk.split(b"data: ", 1)[1]) for chunk in chunks]
    assert [frame["sequence_number"] for frame in frames] == list(range(len(frames)))
    assert [frame["type"] for frame in frames] == [
        "response.created",
        "response.in_progress",
        "response.output_item.added",
        "response.content_part.added",
        "response.output_text.delta",
        "response.output_text.done",
        "response.content_part.done",
        "response.output_item.done",
        "response.completed",
    ]
    text_delta = next(
        frame for frame in frames if frame["type"] == "response.output_text.delta"
    )
    assert text_delta["logprobs"] == []
    assert chunks[-1].startswith(b"event: response.completed\n")
    final = json.loads(chunks[-1].split(b"data: ", 1)[1])
    assert final["response"]["usage"]["output_tokens"] == result.usage.output_tokens


@pytest.mark.asyncio
async def test_messages_non_streaming_body_and_usage():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.MESSAGES),
        body=_body("hello there"),
        headers={},
    )

    chunks = await _drain(result.body)
    payload = json.loads(chunks[0])
    assert payload["type"] == "message"
    assert payload["content"][0]["text"] == "hello there"
    assert payload["usage"]["output_tokens"] == result.usage.output_tokens


@pytest.mark.asyncio
async def test_messages_streaming_ends_with_message_stop_and_usage_on_message_delta():
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(
            model="mock/echo", stream=True, protocol=LLMProtocol.MESSAGES
        ),
        body=_body("hi"),
        headers={},
    )

    chunks = await _drain(result.body)
    assert chunks[-1].startswith(b"event: message_stop\n")
    delta_frame = next(c for c in chunks if c.startswith(b"event: message_delta\n"))
    payload = json.loads(delta_frame.split(b"data: ", 1)[1])
    assert payload["usage"]["output_tokens"] == result.usage.output_tokens


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "protocol",
    [LLMProtocol.CHAT_COMPLETIONS, LLMProtocol.RESPONSES, LLMProtocol.MESSAGES],
)
async def test_mcp_marker_requests_the_harness_rendered_echo_tool(protocol):
    marker = "MCP-ACCEPTANCE-pi_core-marker"
    body = json.dumps(
        {
            "model": "mock/echo",
            "messages": [{"role": "user", "content": f"Use echo {marker}"}],
            "tools": [{"name": "mcp__mock__echo"}],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=protocol),
        body=body,
        headers={},
    )

    payload = json.loads((await _drain(result.body))[0])
    if protocol == LLMProtocol.CHAT_COMPLETIONS:
        call = payload["choices"][0]["message"]["tool_calls"][0]
        assert call["function"]["name"] == "mcp__mock__echo"
        assert json.loads(call["function"]["arguments"])["marker"] == marker
    elif protocol == LLMProtocol.RESPONSES:
        call = payload["output"][0]
        assert call["name"] == "mcp__mock__echo"
        assert json.loads(call["arguments"])["marker"] == marker
    else:
        call = payload["content"][0]
        assert call["name"] == "mcp__mock__echo"
        assert call["input"]["marker"] == marker


@pytest.mark.asyncio
async def test_mcp_tool_result_returns_the_marker_to_the_harness():
    marker = "MCP-ACCEPTANCE-unit-result"
    body = json.dumps(
        {
            "model": "mock/echo",
            "messages": [
                {"role": "user", "content": f"Use echo {marker}"},
                {
                    "role": "tool",
                    "content": json.dumps(
                        {
                            "content": [
                                {"type": "text", "text": json.dumps({"marker": marker})}
                            ],
                            "isError": False,
                        }
                    ),
                },
            ],
            "tools": [{"name": "mcp__mock__echo"}],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo"),
        body=body,
        headers={},
    )
    payload = json.loads((await _drain(result.body))[0])
    assert marker in payload["choices"][0]["message"]["content"]


@pytest.mark.asyncio
async def test_failed_tool_result_cannot_prove_mock_mcp_delivery():
    marker = "MCP-ACCEPTANCE-unit-failure"
    body = json.dumps(
        {
            "model": "mock/echo",
            "messages": [
                {"role": "user", "content": f"Use echo {marker}"},
                {"role": "tool", "content": '{"error":{"code":-32600}}'},
            ],
            "tools": [{"name": "mcp__mock__echo"}],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo"),
        body=body,
        headers={},
    )

    payload = json.loads((await _drain(result.body))[0])
    assert payload["choices"][0]["message"]["content"] == "mock MCP tool call failed"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "rendered",
    ["mcp__mock-mcp__echo", "mcp.mock-mcp.echo", "mock-mcp/echo", "echo"],
)
async def test_the_harness_own_spelling_is_read_from_the_request(rendered):
    """Whatever the harness calls the echo tool, the mock calls it back by that name.

    Reading the catalog beats knowing it. Hardcoding a spelling per protocol made the Codex cell
    falsely pass in one direction on 2026-09-15 and then fail in the other, both times for a tool
    name no harness actually had.
    """
    marker = "MCP-ACCEPTANCE-read"
    body = json.dumps(
        {
            "model": "mock/echo",
            "input": [{"role": "user", "content": f"Use echo {marker}"}],
            "tools": [{"type": "function", "name": "shell"}, {"name": rendered}],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=body,
        headers={},
    )

    payload = json.loads((await _drain(result.body))[0])
    assert payload["output"][0]["name"] == rendered
    # A top-level tool has no namespace, so the field is omitted rather than sent empty.
    assert "namespace" not in payload["output"][0]


@pytest.mark.asyncio
async def test_a_namespaced_tool_is_named_by_its_namespace():
    """Codex groups remote MCP tools under a `type: "namespace"` entry.

    Measured from a live Codex catalog on 2026-09-15: the mock MCP server arrives as
    `{"type": "namespace", "name": "mcp__mock_mcp", "tools": [echo, fail, slow]}`, and Codex also
    groups its own `multi_agent_v1` tools the same way. The bare nested name is not what the model
    calls, so a catalog read that ignores the nesting produces a tool call the harness refuses.
    """
    marker = "MCP-ACCEPTANCE-ns"
    body = json.dumps(
        {
            "model": "mock/echo",
            "input": [{"role": "user", "content": f"Use echo {marker}"}],
            "tools": [
                {"type": "function", "name": "exec_command"},
                {
                    "type": "namespace",
                    "name": "mcp__mock_mcp",
                    "tools": [
                        {"type": "function", "name": "echo"},
                        {"type": "function", "name": "fail"},
                    ],
                },
            ],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=body,
        headers={},
    )

    payload = json.loads((await _drain(result.body))[0])
    call = payload["output"][0]
    # Codex keeps the two halves apart on the wire and rebuilds the identity itself with
    # `ToolName::new(namespace, name)` (codex-rs/core/src/tools/router.rs), identically at
    # rust-v0.145.0 and rust-v0.154.0. Any joined spelling lands in the default namespace and
    # comes back `unsupported call`.
    assert call["name"] == "echo"
    assert call["namespace"] == "mcp__mock_mcp"


@pytest.mark.asyncio
@pytest.mark.parametrize("decoy", ["echo_service_health", "fetch_echoes", "shell"])
async def test_a_tool_that_merely_mentions_echo_is_not_the_echo_tool(decoy):
    """The match is anchored at the end of the name, so a longer word never stands in for it."""
    marker = "MCP-ACCEPTANCE-decoy"
    body = json.dumps(
        {
            "model": "mock/echo",
            "input": [{"role": "user", "content": f"Use echo {marker}"}],
            "tools": [{"name": decoy}],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=body,
        headers={},
    )

    payload = json.loads((await _drain(result.body))[0])
    # The property under test is that a decoy is never mistaken for the echo tool. What happens
    # instead is the measured fallback, not the decoy's name — a catalog that names no echo tool
    # is the same "nothing to read here" as a request that carries no catalog at all.
    call = payload["output"][0]
    assert call.get("name") != decoy
    assert (call.get("namespace"), call.get("name")) == ("mcp__mock_mcp", "echo")


@pytest.mark.asyncio
async def test_codex_keeps_its_measured_fallback_when_no_catalog_is_sent():
    """A Responses request with no tool catalog still gets a callable reference.

    Removing this fallback is what turned the nine Codex cells of
    `services/oss/tests/pytest/acceptance/test_agent_gateway_route.py` red: with no catalog to read
    and no fallback, the mock had no tool to call, so it answered with the turn's own text and the
    suite saw the session preamble instead of the echo result.

    The pair is MEASURED — Codex renders the server as a namespace `mcp__mock_mcp` holding a tool
    named `echo` — and the two halves stay apart because that is how `ResponseItem::FunctionCall`
    carries them.
    """
    marker = "MCP-ACCEPTANCE-codex-fb"
    body = json.dumps(
        {
            "model": "gpt-5.5",
            "input": [{"role": "user", "content": f"Use echo {marker}"}],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=body,
        headers={},
    )

    call = json.loads((await _drain(result.body))[0])["output"][0]
    assert call["name"] == "echo"
    assert call["namespace"] == "mcp__mock_mcp"


@pytest.mark.asyncio
async def test_a_catalog_still_wins_over_the_fallback():
    """The fallback is for a request that carries nothing; a catalog is always the better source."""
    marker = "MCP-ACCEPTANCE-codex-cat"
    body = json.dumps(
        {
            "model": "gpt-5.5",
            "input": [{"role": "user", "content": f"Use echo {marker}"}],
            "tools": [
                {
                    "type": "namespace",
                    "name": "mcp__renamed_server",
                    "tools": [{"type": "function", "name": "echo"}],
                }
            ],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=body,
        headers={},
    )

    call = json.loads((await _drain(result.body))[0])["output"][0]
    assert call["namespace"] == "mcp__renamed_server"


@pytest.mark.asyncio
async def test_claude_keeps_its_measured_fallback_when_no_catalog_is_sent():
    """The ACP harnesses configure remote MCP at session start, so the request may carry none.

    Only the Messages spelling is in the fallback table, because only it has been measured on a
    live run. Codex is deliberately absent; see the table's own note.
    """
    marker = "MCP-ACCEPTANCE-fb"
    body = json.dumps(
        {
            "model": "mock/echo",
            "messages": [{"role": "user", "content": f"Use echo {marker}"}],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.MESSAGES),
        body=body,
        headers={},
    )

    payload = json.loads((await _drain(result.body))[0])
    assert payload["content"][0]["name"] == "mcp__mock-mcp__echo"


@pytest.mark.asyncio
async def test_an_unrelated_tool_result_cannot_prove_mock_mcp_delivery():
    """The false green this fixture used to report, pinned so it cannot come back.

    The marker is in the user prompt and a `function_call_output` exists — but it belongs to a
    different tool, and no echo ever ran. Before 2026-09-15 that was enough to answer
    `mock MCP echo: <marker>`, so a Codex cell went green on a call that never left the sandbox.
    """
    marker = "MCP-ACCEPTANCE-ghost"
    body = json.dumps(
        {
            "model": "mock/echo",
            "input": [
                {"role": "user", "content": f"Use echo {marker}"},
                {
                    "type": "function_call_output",
                    "call_id": "call_shell",
                    "output": "total 0\ndrwxr-xr-x 2 root root 40 Sep 15 17:00 .",
                },
            ],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=body,
        headers={},
    )

    payload = json.loads((await _drain(result.body))[0])
    # An honest red, which is the point: the fixture now says the call failed instead of
    # confirming a round trip that did not happen.
    assert payload["output"][0]["content"][0]["text"] == "mock MCP tool call failed"


@pytest.mark.asyncio
async def test_the_marker_must_be_inside_the_tool_result_not_merely_in_the_body():
    """A tool result carrying the marker IS the proof; the same marker in the prompt is not."""
    marker = "MCP-ACCEPTANCE-inside"
    body = json.dumps(
        {
            "model": "mock/echo",
            "input": [
                {"role": "user", "content": f"Use echo {marker}"},
                {
                    "type": "function_call_output",
                    "call_id": "call_echo",
                    "output": json.dumps({"marker": marker}),
                },
            ],
        }
    ).encode()
    result = await MockLLMAdapter().relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(model="mock/echo", protocol=LLMProtocol.RESPONSES),
        body=body,
        headers={},
    )

    payload = json.loads((await _drain(result.body))[0])
    assert payload["output"][0]["content"][0]["text"] == f"mock MCP echo: {marker}"


@pytest.mark.asyncio
async def test_every_content_block_frame_says_which_block_it_belongs_to():
    """Anthropic's stream carries `index` on every content-block event. The text
    branch's delta omitted it while its own start and stop events carried it, so a
    client indexing deltas by block saw a frame it could not place (M5)."""
    adapter = MockLLMAdapter()

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(
            model="mock/echo", stream=True, protocol=LLMProtocol.MESSAGES
        ),
        body=_body("hi"),
        headers={},
    )

    chunks = await _drain(result.body)
    block_frames = [
        json.loads(chunk.split(b"data: ", 1)[1])
        for chunk in chunks
        if chunk.startswith(b"event: content_block_")
    ]

    assert block_frames, "the stream carried no content-block frames"
    for frame in block_frames:
        assert frame.get("index") == 0, frame["type"]
    # Start, delta and stop, so the delta is genuinely among them.
    assert {frame["type"] for frame in block_frames} == {
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
    }
