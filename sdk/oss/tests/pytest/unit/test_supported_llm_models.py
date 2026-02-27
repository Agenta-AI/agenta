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


@pytest.mark.skipif(not LITELLM_AVAILABLE, reason="litellm not installed")
@pytest.mark.parametrize("model,provider", list(_all_models()))
def test_model_exists_in_litellm(model: str, provider: str) -> None:
    """Every model in supported_llm_models must exist in litellm's model registry."""
    assert _model_exists_in_litellm(model), (
        f"Model '{model}' (provider: '{provider}') was not found in "
        f"litellm.model_cost.  It may be outdated or incorrectly named.  "
        f"Check https://models.litellm.ai/ for the current list."
    )
