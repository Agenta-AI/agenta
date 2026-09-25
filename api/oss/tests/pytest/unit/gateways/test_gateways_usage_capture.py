"""Usage capture: each protocol's token accounting normalised into one vocabulary.

Fresh input, cache reads and cache writes are priced apart, and the split cannot be
recovered once a call is recorded, so the normalisation is pinned here per protocol, with
and without a cached slice, and through a whole multi-frame stream.
"""

import json

import pytest

from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol
from oss.src.core.gateways.llms.providers.passthrough.adapter import (
    _usage_from_payload,
)
from oss.src.core.gateways.policy.audit import build_gateway_call_attributes
from oss.src.core.gateways.policy.dtos import (
    GatewayOutcome,
    GatewayUsage,
)

from oss.tests.pytest.unit.gateways.test_gateways_llm_relay_adapter import (
    _adapter,
    _drain,
    _route,
    _sse_handler,
)
from oss.tests.pytest.unit.gateways.test_gateways_policy_audit import (
    _allowed,
    _llm_target,
    _scope,
)


@pytest.mark.parametrize(
    "protocol, payload, expected",
    [
        # Chat Completions counts the cached slice inside `prompt_tokens`.
        (
            LLMProtocol.CHAT_COMPLETIONS,
            {
                "usage": {
                    "prompt_tokens": 1200,
                    "completion_tokens": 380,
                    "prompt_tokens_details": {"cached_tokens": 1000},
                }
            },
            GatewayUsage(input_tokens=200, cache_read_tokens=1000, output_tokens=380),
        ),
        (
            LLMProtocol.CHAT_COMPLETIONS,
            {"usage": {"prompt_tokens": 11, "completion_tokens": 7}},
            GatewayUsage(input_tokens=11, output_tokens=7),
        ),
        # Responses does the same, under `input_tokens_details`.
        (
            LLMProtocol.RESPONSES,
            {
                "usage": {
                    "input_tokens": 1200,
                    "output_tokens": 380,
                    "input_tokens_details": {"cached_tokens": 1000},
                }
            },
            GatewayUsage(input_tokens=200, cache_read_tokens=1000, output_tokens=380),
        ),
        (
            LLMProtocol.RESPONSES,
            {"usage": {"input_tokens": 11, "output_tokens": 7}},
            GatewayUsage(input_tokens=11, output_tokens=7),
        ),
        # Messages reports fresh input already apart from both cached slices.
        (
            LLMProtocol.MESSAGES,
            {
                "usage": {
                    "input_tokens": 200,
                    "cache_read_input_tokens": 1000,
                    "cache_creation_input_tokens": 50,
                    "output_tokens": 380,
                }
            },
            GatewayUsage(
                input_tokens=200,
                cache_read_tokens=1000,
                cache_write_tokens=50,
                output_tokens=380,
            ),
        ),
        (
            LLMProtocol.MESSAGES,
            {"usage": {"input_tokens": 11, "output_tokens": 7}},
            GatewayUsage(input_tokens=11, output_tokens=7),
        ),
    ],
    ids=[
        "chat-cached",
        "chat-uncached",
        "responses-cached",
        "responses-uncached",
        "messages-cached",
        "messages-uncached",
    ],
)
def test_each_protocol_normalises_into_fresh_input_and_cached_slices(
    protocol, payload, expected
):
    assert _usage_from_payload(payload, protocol) == expected


def test_a_field_the_upstream_did_not_report_stays_unknown_rather_than_zero():
    usage = _usage_from_payload(
        {"usage": {"prompt_tokens_details": {"cached_tokens": 4}}},
        LLMProtocol.CHAT_COMPLETIONS,
    )

    assert usage == GatewayUsage(cache_read_tokens=4)


@pytest.mark.asyncio
async def test_a_messages_stream_keeps_the_cache_split_its_first_frame_reported():
    """`message_start` carries input and both cached slices; `message_delta`, near the
    end, carries only the output. The merge must not drop the head's cache fields."""
    head = (
        b'event: message_start\ndata: {"type":"message_start","message":{"id":"m",'
        b'"usage":{"input_tokens":200,"cache_read_input_tokens":1000,'
        b'"cache_creation_input_tokens":50,"output_tokens":1}}}\n\n'
    )
    tail = (
        b'event: message_delta\ndata: {"type":"message_delta",'
        b'"usage":{"output_tokens":380}}\n\n'
        b'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    )
    adapter = _adapter(_sse_handler(head + tail))

    result = await adapter.relay_chat_completion(
        route=_route(),
        secret=None,
        context=LLMCallContext(
            model="gpt-4o", stream=True, protocol=LLMProtocol.MESSAGES
        ),
        body=json.dumps(
            {"model": "gpt-4o", "max_tokens": 16, "messages": [], "stream": True}
        ).encode(),
        headers={},
    )
    await _drain(result.body)

    assert result.usage == GatewayUsage(
        input_tokens=200,
        cache_read_tokens=1000,
        cache_write_tokens=50,
        output_tokens=380,
    )


def test_the_audit_event_carries_the_cache_split():
    attributes = build_gateway_call_attributes(
        scope=_scope(),
        target=_llm_target(),
        decision=_allowed(),
        outcome=GatewayOutcome(
            status_code=200,
            usage=GatewayUsage(
                input_tokens=200,
                cache_read_tokens=1000,
                cache_write_tokens=50,
                output_tokens=380,
            ),
        ),
    )

    assert attributes["input_tokens"] == 200
    assert attributes["cache_read_tokens"] == 1000
    assert attributes["cache_write_tokens"] == 50
    assert attributes["output_tokens"] == 380
