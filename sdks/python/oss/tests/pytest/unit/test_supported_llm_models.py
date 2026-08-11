"""
Tests that all models in `supported_llm_models` are recognised by litellm.

litellm.model_cost is the authoritative model registry (mirrors models.litellm.ai).
Each model must appear there either:
  - directly (e.g. "gpt-4o", "gemini/gemini-2.5-pro"), or
  - after stripping the provider prefix (e.g. "anthropic/claude-3-5-sonnet-20241022"
    lives in litellm as "claude-3-5-sonnet-20241022").

Run:
    pytest sdk/oss/tests/pytest/unit/test_supported_llm_models.py -v
"""

import pytest

try:
    import litellm

    LITELLM_AVAILABLE = True
    LITELLM_MODEL_COST: set = set(litellm.model_cost.keys())
except ImportError:
    LITELLM_AVAILABLE = False
    LITELLM_MODEL_COST = set()

from agenta.sdk.assets import supported_llm_models


def _model_exists_in_litellm(model: str) -> bool:
    """
    Return True if *model* is known to litellm.

    Strategy:
    1. Direct lookup in litellm.model_cost.
    2. Strip the first path segment and retry.
       Covers providers like Anthropic where Agenta stores
       "anthropic/claude-X" but litellm indexes costs as "claude-X".
    """
    if model in LITELLM_MODEL_COST:
        return True
    if "/" in model:
        without_prefix = model.split("/", 1)[1]
        if without_prefix in LITELLM_MODEL_COST:
            return True
    return False


def _all_models():
    """Yield (model, provider) pairs for every entry in supported_llm_models."""
    for provider, models in supported_llm_models.items():
        for model in models:
            yield model, provider


# OpenRouter's catalog moves ahead of litellm's vendored `model_cost` snapshot: our list
# tracks OpenRouter's current top-used models, which routinely include ids the pinned
# litellm build hasn't indexed yet. For that provider a miss is an expected lag, not a bug,
# so it is reported as xfail (still runs, still flags a typo'd id via the structural check
# below) instead of failing CI. Every other provider must resolve in litellm exactly.
_LITELLM_LAGGING_PROVIDERS = {"openrouter"}


@pytest.mark.skipif(not LITELLM_AVAILABLE, reason="litellm not installed")
@pytest.mark.parametrize("model,provider", list(_all_models()))
def test_model_exists_in_litellm(model: str, provider: str) -> None:
    """Every model in supported_llm_models must exist in litellm's model registry."""
    found = _model_exists_in_litellm(model)
    if not found and provider in _LITELLM_LAGGING_PROVIDERS:
        # Structural guard even when we can't cost-check: the id must still be
        # `openrouter/<vendor>/<model>` so a typo'd prefix is caught here, not in prod.
        assert model.startswith(f"{provider}/") and model.count("/") >= 2, (
            f"Malformed OpenRouter id '{model}': expected 'openrouter/<vendor>/<model>'."
        )
        pytest.xfail(
            f"'{model}' not yet in this litellm build's model_cost (OpenRouter lag)"
        )
    assert found, (
        f"Model '{model}' (provider: '{provider}') was not found in "
        f"litellm.model_cost.  It may be outdated or incorrectly named.  "
        f"Check https://models.litellm.ai/ for the current list."
    )
