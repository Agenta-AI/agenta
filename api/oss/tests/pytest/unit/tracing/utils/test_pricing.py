import litellm
import pytest

from oss.src.core.tracing.utils import pricing
from oss.src.core.tracing.utils.pricing import (
    MODEL_ALIASES,
    price_tokens,
    resolve_pricing_model,
)


@pytest.fixture(autouse=True)
def _fresh_pricing_caches():
    resolve_pricing_model.cache_clear()
    yield
    resolve_pricing_model.cache_clear()


@pytest.mark.parametrize(
    "model, expected",
    [
        ("claude-sonnet-4-5", "claude-sonnet-4-5"),
        ("gpt-4o", "gpt-4o"),
        ("GPT-4o", "gpt-4o"),
        ("openai/gpt-5.3-codex", "gpt-5.3-codex"),
        # OpenRouter-style ids: dotted version, provider prefix.
        ("anthropic/claude-sonnet-4.5", "claude-sonnet-4-5"),
        (
            "openrouter/anthropic/claude-sonnet-4.5",
            "openrouter/anthropic/claude-sonnet-4.5",
        ),
        ("bytedance/ui-tars-1.5-7b", "openrouter/bytedance/ui-tars-1.5-7b"),
        ("claude-sonnet-4-5-20990101", "claude-sonnet-4-5"),
        ("sonnet", MODEL_ALIASES["sonnet"]),
        ("sonnet[1m]", MODEL_ALIASES["sonnet"]),
        ("opus", MODEL_ALIASES["opus"]),
        ("haiku", MODEL_ALIASES["haiku"]),
        # Current Claude 5 family ids, in the spellings harnesses and OpenRouter send.
        ("claude-opus-5-5", "claude-opus-5-5"),
        ("claude-opus-5-5[1m]", "claude-opus-5-5"),
        ("anthropic/claude-opus-5.5", "claude-opus-5-5"),
        ("claude-opus-5", "claude-opus-5"),
        ("claude-sonnet-5", "claude-sonnet-5"),
        ("claude-fable-5-1", "claude-fable-5-1"),
        ("anthropic/claude-fable-5.1", "claude-fable-5-1"),
    ],
)
def test_resolve_pricing_model_finds_the_litellm_key(model, expected):
    assert resolve_pricing_model(model) == expected


@pytest.mark.parametrize(
    "model",
    [
        "totally-unknown-model",
        # Only litellm provider prefixes are stripped: a custom gateway keeps its own name.
        "my-gateway/gpt-5.3-codex",
        "my-gateway/claude-sonnet-4.5",
    ],
)
def test_resolve_pricing_model_returns_none_without_a_price(model):
    assert resolve_pricing_model(model) is None


def test_every_alias_points_to_a_priced_litellm_key():
    for target in MODEL_ALIASES.values():
        assert "input_cost_per_token" in litellm.model_cost[target], target


@pytest.mark.parametrize(
    "model, input_rate, output_rate",
    [
        # Anthropic list prices, USD per million tokens.
        ("claude-opus-5-5", 4.0, 20.0),
        ("claude-opus-5", 5.0, 25.0),
        ("claude-sonnet-5", 2.0, 10.0),
        ("claude-fable-5-1", 10.0, 50.0),
    ],
)
def test_claude_5_family_uses_the_anthropic_list_price(model, input_rate, output_rate):
    prompt_cost, completion_cost = price_tokens(
        model=resolve_pricing_model(model),
        prompt_tokens=1_000_000,
        completion_tokens=1_000_000,
    )

    assert prompt_cost == pytest.approx(input_rate)
    assert completion_cost == pytest.approx(output_rate)


def test_price_map_additions_are_priced_from_their_listed_rates():
    for model, (base, prices) in pricing.PRICE_MAP_ADDITIONS.items():
        assert base in litellm.model_cost, base
        entry = litellm.model_cost[model]
        for key, value in prices.items():
            assert entry[key] == value, (model, key)

    # Cache buckets use the added rates too, not the base model's.
    prompt_cost, _ = price_tokens(
        model="claude-opus-5-5",
        prompt_tokens=3_000_000,
        completion_tokens=0,
        cache_read_tokens=1_000_000,
        cache_write_tokens=1_000_000,
    )
    assert prompt_cost == pytest.approx(4.0 + 0.2 + 5.0)


def test_resolve_pricing_model_is_cached():
    resolve_pricing_model("anthropic/claude-sonnet-4.5")
    resolve_pricing_model("anthropic/claude-sonnet-4.5")

    assert resolve_pricing_model.cache_info().hits == 1
