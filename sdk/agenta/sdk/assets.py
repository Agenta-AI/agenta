from typing import Dict, Optional, Tuple

from litellm import cost_calculator


supported_llm_models = {
    "anthropic": [
        "anthropic/claude-opus-4-6",
        "anthropic/claude-sonnet-4-6",
        "anthropic/claude-opus-4-5",
        "anthropic/claude-sonnet-4-5",
        "anthropic/claude-haiku-4-5",
        "anthropic/claude-opus-4-1",
        "anthropic/claude-sonnet-4-20250514",
        "anthropic/claude-opus-4-20250514",
        "anthropic/claude-3-7-sonnet-20250219",
        "anthropic/claude-3-5-sonnet-20241022",
        "anthropic/claude-3-5-sonnet-20240620",
        "anthropic/claude-3-5-haiku-20241022",
        "anthropic/claude-3-opus-20240229",
        "anthropic/claude-3-haiku-20240307",
    ],
    "cohere": [
        "cohere/command-light",
        "cohere/command-r-plus",
        "cohere/command-nightly",
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
        "gemini/gemini-3.1-pro-preview",
        "gemini/gemini-3-pro-preview",
        "gemini/gemini-3-flash-preview",
        "gemini/gemini-2.5-pro",
        "gemini/gemini-2.5-pro-preview-05-06",
        "gemini/gemini-2.5-flash",
        "gemini/gemini-2.5-flash-preview-09-2025",
        "gemini/gemini-2.5-flash-preview-05-20",
        "gemini/gemini-2.5-flash-preview-04-17",
        "gemini/gemini-2.5-flash-lite",
        "gemini/gemini-2.5-flash-lite-preview-09-2025",
        "gemini/gemini-2.0-flash",
        "gemini/gemini-2.0-flash-001",
        "gemini/gemini-2.0-flash-lite",
        "gemini/gemini-2.0-flash-lite-preview-02-05",
        "gemini/gemini-1.5-pro",
        "gemini/gemini-1.5-flash",
        "gemini/gemini-1.5-flash-8b",
    ],
    "groq": [
        "groq/meta-llama/llama-4-maverick-17b-128e-instruct",
        "groq/meta-llama/llama-4-scout-17b-16e-instruct",
        "groq/llama-3.3-70b-versatile",
        "groq/llama-3.1-8b-instant",
        "groq/qwen/qwen3-32b",
    ],
    "mistral": [
        "mistral/mistral-tiny",
        "mistral/mistral-small",
        "mistral/mistral-medium",
        "mistral/mistral-large-latest",
    ],
    "openai": [
        "gpt-5.2-pro",
        "gpt-5.2-chat-latest",
        "gpt-5.2",
        "gpt-5.1-codex",
        "gpt-5.1-chat-latest",
        "gpt-5.1",
        "gpt-5-pro",
        "gpt-5-chat",
        "gpt-5-nano",
        "gpt-5-mini",
        "gpt-5",
        "o4-mini",
        "o3-pro",
        "o3",
        "o3-mini",
        "o1-pro",
        "o1",
        "o1-mini",
        "codex-mini-latest",
        "gpt-4.5-preview",
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
    "openrouter": [
        # Anthropic via OpenRouter
        "openrouter/anthropic/claude-opus-4.5",
        "openrouter/anthropic/claude-opus-4.1",
        "openrouter/anthropic/claude-sonnet-4.5",
        "openrouter/anthropic/claude-haiku-4.5",
        "openrouter/anthropic/claude-3.7-sonnet",
        "openrouter/anthropic/claude-3.5-sonnet",
        # DeepSeek via OpenRouter
        "openrouter/deepseek/deepseek-chat",
        "openrouter/deepseek/deepseek-r1",
        "openrouter/deepseek/deepseek-r1-0528",
        "openrouter/deepseek/deepseek-v3.2",
        # Google via OpenRouter
        "openrouter/google/gemini-2.5-pro",
        "openrouter/google/gemini-2.5-flash",
        "openrouter/google/gemini-2.0-flash-001",
        # Meta-Llama via OpenRouter
        "openrouter/meta-llama/llama-3-70b-instruct",
        # Mistral via OpenRouter
        "openrouter/mistralai/mistral-large",
        "openrouter/mistralai/mistral-small-3.2-24b-instruct",
        "openrouter/mistralai/mixtral-8x22b-instruct",
        # OpenAI via OpenRouter
        "openrouter/openai/gpt-4o",
        "openrouter/openai/gpt-4.1",
        "openrouter/openai/gpt-5",
        # Qwen via OpenRouter
        "openrouter/qwen/qwen-2.5-coder-32b-instruct",
        "openrouter/qwen/qwen3-235b-a22b-2507",
        # xAI via OpenRouter
        "openrouter/x-ai/grok-4",
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
        "together_ai/moonshotai/Kimi-K2-Instruct",
        "together_ai/mistralai/Mistral-Small-24B-Instruct-2501",
        "together_ai/mistralai/Mistral-7B-Instruct-v0.1",
        "together_ai/mistralai/Mixtral-8x7B-Instruct-v0.1",
        "together_ai/Qwen/Qwen2.5-7B-Instruct-Turbo",
        "together_ai/Qwen/Qwen2.5-72B-Instruct-Turbo",
    ],
}

providers_list = list(supported_llm_models.keys())


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
