"""Token extraction from a litellm response's usage object.

Covers the cached-prompt-token count the cost calculation needs (see #5711): without it
every cached token is billed at the full input rate, which overstates cost by up to 6.6x
on a workload that replays a long prefix.
"""

from types import SimpleNamespace

import pytest

from agenta.sdk.litellm.litellm import _extract_token_usage


def _response(usage):
    return SimpleNamespace(usage=usage)


def test_reads_openai_style_usage_objects():
    usage = SimpleNamespace(
        prompt_tokens=25978,
        completion_tokens=100,
        total_tokens=26078,
        prompt_tokens_details=SimpleNamespace(cached_tokens=24540),
    )

    assert _extract_token_usage(_response(usage)) == {
        "prompt": 25978.0,
        "completion": 100.0,
        "total": 26078.0,
        # A SUBSET of `prompt`, not an addition to it: the cost calculation re-prices this
        # slice at the provider's cached rate rather than adding a fourth token bucket.
        "cache_read": 24540.0,
    }


def test_reads_usage_delivered_as_a_dict():
    """litellm hands the usage object through as a dict on some providers."""
    usage = {
        "prompt_tokens": 300,
        "completion_tokens": 50,
        "total_tokens": 350,
        "prompt_tokens_details": {"cached_tokens": 128},
    }

    assert _extract_token_usage(_response(usage)) == {
        "prompt": 300.0,
        "completion": 50.0,
        "total": 350.0,
        "cache_read": 128.0,
    }


def test_falls_back_to_the_flat_anthropic_style_cache_field():
    """Anthropic-style usage reports the cached count flat, with no nested details."""
    usage = SimpleNamespace(
        prompt_tokens=300,
        completion_tokens=50,
        total_tokens=350,
        cache_read_input_tokens=128,
    )

    assert _extract_token_usage(_response(usage))["cache_read"] == 128.0


def test_prefers_the_nested_count_when_a_provider_reports_both():
    """The nested value is the OpenAI-convention one that matches `prompt_tokens`."""
    usage = SimpleNamespace(
        prompt_tokens=300,
        completion_tokens=50,
        total_tokens=350,
        prompt_tokens_details=SimpleNamespace(cached_tokens=128),
        cache_read_input_tokens=999,
    )

    assert _extract_token_usage(_response(usage))["cache_read"] == 128.0


@pytest.mark.parametrize(
    "usage",
    [
        pytest.param(
            SimpleNamespace(prompt_tokens=300, completion_tokens=50, total_tokens=350),
            id="no-cache-fields",
        ),
        pytest.param(
            SimpleNamespace(
                prompt_tokens=300,
                completion_tokens=50,
                total_tokens=350,
                prompt_tokens_details=SimpleNamespace(cached_tokens=0),
            ),
            id="explicit-cache-miss",
        ),
        pytest.param(
            SimpleNamespace(
                prompt_tokens=300,
                completion_tokens=50,
                total_tokens=350,
                prompt_tokens_details=None,
            ),
            id="null-details",
        ),
    ],
)
def test_records_no_cached_count_when_nothing_was_cached(usage):
    """Absent, zero, and null all mean the same thing: nothing to re-price."""
    extracted = _extract_token_usage(_response(usage))

    assert extracted["cache_read"] is None
    assert extracted["prompt"] == 300.0


def test_tolerates_a_response_without_usage():
    """A failed or streaming-partial response can carry no usage object at all."""
    assert _extract_token_usage(_response(None)) == {
        "prompt": None,
        "completion": None,
        "total": None,
        "cache_read": None,
    }
