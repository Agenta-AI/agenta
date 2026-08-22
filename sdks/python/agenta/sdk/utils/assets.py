from typing import Dict, Optional, Tuple

from litellm import cost_calculator


# A model is listed here once its provider still serves it. Ids whose provider has already
# retired them are removed, because the picker offering a dead model only buys the user a failed
# call.
#
# Cost metadata comes from litellm's table, and litellm 1.92.0 (the version this SDK pins) has no
# pricing for a handful of the OpenRouter, Together AI, and MiniMax ids below. Gateways add models
# faster than that table tracks them. Those models route and answer normally; they report a cost of
# zero until a later litellm ships the numbers. They stay listed because a working model with an
# unknown price is more useful than a missing one.
supported_llm_models = {
    "anthropic": [
        "anthropic/claude-fable-5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-opus-5",
        "anthropic/claude-opus-4-8",
        "anthropic/claude-opus-4-7",
        "anthropic/claude-opus-4-6",
        "anthropic/claude-sonnet-4-6",
        "anthropic/claude-opus-4-5",
        "anthropic/claude-sonnet-4-5",
        "anthropic/claude-haiku-4-5",
    ],
    "cohere": [
        "cohere/command-a-03-2025",
        "cohere/command-r7b-12-2024",
        "cohere/command-r-plus-08-2024",
        "cohere/command-r-08-2024",
    ],
    "deepinfra": [
        "deepinfra/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        "deepinfra/meta-llama/Llama-4-Scout-17B-16E-Instruct",
        "deepinfra/meta-llama/Llama-3.3-70B-Instruct",
        "deepinfra/meta-llama/Meta-Llama-3.1-70B-Instruct",
        "deepinfra/meta-llama/Meta-Llama-3.1-8B-Instruct",
        "deepinfra/deepseek-ai/DeepSeek-R1",
        "deepinfra/deepseek-ai/DeepSeek-V3",
        "deepinfra/deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
        "deepinfra/Qwen/Qwen3-235B-A22B",
        "deepinfra/Qwen/Qwen3-32B",
        "deepinfra/Qwen/Qwen2.5-72B-Instruct",
        "deepinfra/mistralai/Mixtral-8x7B-Instruct-v0.1",
        "deepinfra/mistralai/Mistral-Small-24B-Instruct-2501",
        "deepinfra/nvidia/Llama-3.1-Nemotron-70B-Instruct",
    ],
    "gemini": [
        "gemini/gemini-pro-latest",
        "gemini/gemini-flash-latest",
        "gemini/gemini-flash-lite-latest",
        "gemini/gemini-3.7-flash",
        "gemini/gemini-3.6-flash",
        "gemini/gemini-3.5-flash",
        "gemini/gemini-3.5-flash-lite",
        "gemini/gemini-3.1-pro-preview",
        "gemini/gemini-3.1-flash-lite",
        "gemini/gemini-3-flash-preview",
        "gemini/gemini-2.5-pro",
        "gemini/gemini-2.5-flash",
        "gemini/gemini-2.5-flash-lite",
    ],
    "groq": [
        "groq/openai/gpt-oss-120b",
        "groq/openai/gpt-oss-20b",
        "groq/qwen/qwen3.6-27b",
    ],
    "mistral": [
        "mistral/mistral-large-latest",
        "mistral/mistral-medium-latest",
        "mistral/mistral-small-latest",
        "mistral/mistral-large-3",
        "mistral/mistral-medium-3-5",
        "mistral/mistral-medium",
        "mistral/mistral-small",
        "mistral/mistral-tiny",
        "mistral/ministral-8b-latest",
        "mistral/magistral-medium-latest",
        "mistral/magistral-small-latest",
        "mistral/devstral-medium-latest",
        "mistral/devstral-small-latest",
        "mistral/codestral-latest",
        "mistral/pixtral-large-latest",
        "mistral/open-mistral-nemo",
    ],
    "openai": [
        # The GPT-5.6 family is listed by its concrete tiers only. The bare "gpt-5.6" id is an
        # umbrella that routes to one of them, so offering it would ask the user to pick a model
        # and then pick nothing in particular. A guard test pins this (see
        # test_pi_publishes_concrete_gpt_5_6_models_for_both_openai_providers).
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.6-cyber",
        "gpt-5.5-pro",
        "gpt-5.5",
        "gpt-5.4-pro",
        "gpt-5.4-mini",
        "gpt-5.4-nano",
        "gpt-5.4",
        "gpt-5.2-pro",
        "gpt-5.2",
        "gpt-5.1",
        "gpt-5-pro",
        "gpt-5-mini",
        "gpt-5-nano",
        "gpt-5-chat",
        "gpt-5",
        "o4-mini",
        "o3-pro",
        "o3",
        "o3-mini",
        "o1-pro",
        "o1",
        "gpt-4.1-nano",
        "gpt-4.1-mini",
        "gpt-4.1",
        "gpt-4-turbo",
        "gpt-4o-mini",
        "gpt-4o",
        "gpt-4-1106-preview",
        "gpt-4",
        "gpt-3.5-turbo-1106",
        "gpt-3.5-turbo",
    ],
    # OpenRouter's ~20 most-used models as of 2026-07-01, from the public usage
    # rankings (openrouter.ai/rankings and third-party token/spend leaderboards).
    # Every id below is also a valid key in Pi's vendored OpenRouter catalog
    # (drop the "openrouter/" prefix), so it is settable by the Pi harness picker.
    "openrouter": [
        # Anthropic via OpenRouter
        "openrouter/anthropic/claude-opus-4.8",
        "openrouter/anthropic/claude-opus-4.7",
        "openrouter/anthropic/claude-sonnet-4.6",
        "openrouter/anthropic/claude-sonnet-4.5",
        # DeepSeek via OpenRouter
        "openrouter/deepseek/deepseek-v4-flash",
        "openrouter/deepseek/deepseek-v4-pro",
        "openrouter/deepseek/deepseek-v3.2",
        # Google via OpenRouter
        "openrouter/google/gemini-3.5-flash",
        "openrouter/google/gemini-3-flash-preview",
        "openrouter/google/gemini-3.1-pro-preview",
        # MiniMax via OpenRouter
        "openrouter/minimax/minimax-m3",
        # MoonshotAI via OpenRouter
        "openrouter/moonshotai/kimi-k2.6",
        # Nvidia via OpenRouter
        "openrouter/nvidia/nemotron-3-super-120b-a12b",
        # OpenAI via OpenRouter
        "openrouter/openai/gpt-5.6-luna",
        "openrouter/openai/gpt-5.5",
        "openrouter/openai/gpt-5.4",
        # Qwen via OpenRouter
        "openrouter/qwen/qwen3.7-max",
        # Tencent via OpenRouter
        "openrouter/tencent/hy3-preview",
        # Xiaomi via OpenRouter
        "openrouter/xiaomi/mimo-v2.5-pro",
        "openrouter/xiaomi/mimo-v2.5",
        # xAI via OpenRouter
        "openrouter/x-ai/grok-4.3",
        # Z.ai via OpenRouter
        "openrouter/z-ai/glm-5.2",
        "openrouter/z-ai/glm-5",
    ],
    # NOTE: provider kind must match Secrets API enums ("perplexityai").
    # Models remain "perplexity/..." but the provider key is used to match secrets.
    "perplexityai": [
        "perplexity/sonar",
        "perplexity/sonar-pro",
        "perplexity/sonar-reasoning",
        "perplexity/sonar-reasoning-pro",
    ],
    "together_ai": [
        "together_ai/deepseek-ai/DeepSeek-R1",
        "together_ai/deepseek-ai/DeepSeek-V3",
        "together_ai/meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8",
        "together_ai/meta-llama/Llama-4-Scout-17B-16E-Instruct",
        "together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "together_ai/meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        "together_ai/meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        "together_ai/meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo",
        "together_ai/meta-llama/Llama-3.2-3B-Instruct-Turbo",
        "together_ai/moonshotai/Kimi-K2.7-Code",
        "together_ai/moonshotai/Kimi-K2.6",
        "together_ai/mistralai/Mistral-Small-24B-Instruct-2501",
        "together_ai/mistralai/Mistral-7B-Instruct-v0.1",
        "together_ai/mistralai/Mixtral-8x7B-Instruct-v0.1",
        "together_ai/Qwen/Qwen2.5-7B-Instruct-Turbo",
        "together_ai/Qwen/Qwen2.5-72B-Instruct-Turbo",
        "together_ai/zai-org/GLM-5.2",
    ],
    "minimax": [
        "minimax/MiniMax-M3",
        "minimax/MiniMax-M2.7-highspeed",
        "minimax/MiniMax-M2.5",
        "minimax/MiniMax-M2.5-lightning",
        "minimax/MiniMax-M2.1",
        "minimax/MiniMax-M2.1-lightning",
        "minimax/MiniMax-M2",
    ],
}

providers_list = list(supported_llm_models.keys())


# The prefix litellm expects on a provider's model ids. Keyed by stored vault provider kind
# (`StandardProviderKind` in the Secrets API), which covers every family in
# `supported_llm_models` plus the stored kinds that ship no catalog models. None means identity:
# the id is passed through untouched.
#
# Must agree with the frontend's table in
# `web/packages/agenta-entities/src/secret/core/litellmModelId.ts` on every shared key, or one
# model translates differently depending on which half wrote it. A kind litellm has no provider
# for maps to None on both sides rather than to a prefix that cannot route.
#
# Two different reasons land on None:
#   - `openai`, because litellm's OpenAI ids are bare ("gpt-4o", not "openai/gpt-4o"), and
#     downstream code keys off that — the responses bridge in the LLM handler only fires for a
#     model with no "/" in it, so prefixing OpenAI would silently disable it.
#   - `anyscale` and `alephalpha`, because litellm has no such provider to route to at all.
litellm_provider_prefixes: Dict[str, Optional[str]] = {
    "anthropic": "anthropic",
    "cohere": "cohere",
    "deepinfra": "deepinfra",
    "gemini": "gemini",
    "groq": "groq",
    "minimax": "minimax",
    "mistral": "mistral",
    "openai": None,
    "openrouter": "openrouter",
    # The provider kind is "perplexityai" (that is the Secrets API enum), but litellm spells
    # the model prefix "perplexity" — see the ids under "perplexityai" above.
    "perplexityai": "perplexity",
    "together_ai": "together_ai",
    # Stored vault kinds with no catalog models and no litellm provider: litellm 1.92.0 knows
    # neither service (both wound down, and litellm dropped them), so no prefix routes them.
    # `aleph_alpha/luminous-base` fails with the same "LLM Provider NOT provided" as the bare id,
    # which is why these are identity rather than the "anyscale"/"aleph_alpha" spellings they
    # would take if the providers still existed — a prefix here would be a claim this table
    # cannot honour. The keys stay so both halves cover the same set of kinds.
    "anyscale": None,
    "alephalpha": None,
}


def litellm_model_id(model: str, provider: Optional[str]) -> str:
    """Return `model` carrying the litellm prefix that `provider`'s ids use.

    Idempotent, so it is safe to call on an id that is already correct: an id that starts with
    its own family's prefix is returned unchanged. Only the family's prefix counts, never a
    leading path segment in general — an OpenRouter id is spelled `vendor/model`
    ("deepseek/deepseek-v4-flash"), which still needs prefixing exactly once, while
    "openrouter/deepseek/deepseek-v4-flash" is already done.

    A family with no prefix (OpenAI) and a provider outside the catalog both return the id
    untouched, so an unrecognized provider can never mangle a model string.
    """
    if not model or not provider:
        return model

    prefix = litellm_provider_prefixes.get(provider)
    if not prefix:
        return model

    if model.startswith(f"{prefix}/"):
        return model

    return f"{prefix}/{model}"


def _get_model_costs(model: str) -> Optional[Tuple[float, float]]:
    """
    Get the input and output costs per 1M tokens for a model.

    Uses litellm's cost_calculator (same as tracing/inline.py) for consistency.

    Args:
        model: The model name (e.g., "gpt-4o" or "anthropic/claude-3-opus-20240229")

    Returns:
        Tuple of (input_cost, output_cost) per 1M tokens, or None if not found.
    """
    try:
        costs = cost_calculator.cost_per_token(
            model=model,
            prompt_tokens=1_000_000,
            completion_tokens=1_000_000,
        )
        if costs:
            input_cost, output_cost = costs
            if input_cost > 0 or output_cost > 0:
                return (input_cost, output_cost)
    except Exception:
        pass
    return None


def _build_model_metadata() -> Dict[str, Dict[str, Dict[str, float]]]:
    """
    Build metadata dictionary with costs for all supported models.

    Returns:
        Nested dict: {provider: {model: {"input": cost, "output": cost}}}
    """
    metadata: Dict[str, Dict[str, Dict[str, float]]] = {}

    for provider, models in supported_llm_models.items():
        metadata[provider] = {}
        for model in models:
            costs = _get_model_costs(model)
            if costs:
                metadata[provider][model] = {
                    "input": costs[0],
                    "output": costs[1],
                }

    return metadata


model_metadata = _build_model_metadata()

model_to_provider_mapping = {
    model: provider
    for provider, models in supported_llm_models.items()
    for model in models
}
