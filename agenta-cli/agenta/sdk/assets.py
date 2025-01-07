supported_llm_models = {
    "Aleph Alpha": [
        "luminous-base",
        "luminous-base-control",
        "luminous-extended-control",
        "luminous-supreme",
    ],
    "Anthropic": [
        "anthropic/claude-3-5-sonnet-20240620",
        "anthropic/claude-3-opus-20240229",
        "anthropic/claude-3-sonnet-20240229",
        "anthropic/claude-3-haiku-20240307",
        "anthropic/claude-2.1",
        "anthropic/claude-2",
        "anthropic/claude-instant-1.2",
        "anthropic/claude-instant-1",
    ],
    "Anyscale": [
        "anyscale/meta-llama/Llama-2-13b-chat-hf",
        "anyscale/meta-llama/Llama-2-70b-chat-hf",
    ],
    "Cohere": [
        "cohere/command-light",
        "cohere/command-r-plus",
        "cohere/command-nightly",
    ],
    "DeepInfra": [
        "deepinfra/meta-llama/Llama-2-70b-chat-hf",
        "deepinfra/meta-llama/Llama-2-13b-chat-hf",
        "deepinfra/codellama/CodeLlama-34b-Instruct-hf",
        "deepinfra/mistralai/Mistral-7B-Instruct-v0.1",
        "deepinfra/jondurbin/airoboros-l2-70b-gpt4-1.4.1",
    ],
    "Gemini": [
        "gemini/gemini-1.5-pro-latest",
        "gemini/gemini-1.5-flash",
    ],
    "Groq": [
        "groq/llama3-8b-8192",
        "groq/llama3-70b-8192",
        "groq/llama2-70b-4096",
        "groq/mixtral-8x7b-32768",
        "groq/gemma-7b-it",
    ],
    "Mistral": [
        "mistral/mistral-tiny",
        "mistral/mistral-small",
        "mistral/mistral-medium",
        "mistral/mistral-large-latest",
    ],
    "Open AI": [
        "gpt-3.5-turbo-1106",
        "gpt-3.5-turbo",
        "gpt-4",
        "gpt-4o",
        "gpt-4o-mini",
        "gpt-4-1106-preview",
    ],
    "OpenRouter": [
        "openrouter/openai/gpt-3.5-turbo",
        "openrouter/openai/gpt-3.5-turbo-16k",
        "openrouter/anthropic/claude-instant-v1",
        "openrouter/google/palm-2-chat-bison",
        "openrouter/google/palm-2-codechat-bison",
        "openrouter/meta-llama/llama-2-13b-chat",
        "openrouter/meta-llama/llama-2-70b-chat",
    ],
    "Perplexity AI": [
        "perplexity/pplx-7b-chat",
        "perplexity/pplx-70b-chat",
        "perplexity/pplx-7b-online",
        "perplexity/pplx-70b-online",
    ],
    "Together AI": [
        "together_ai/togethercomputer/llama-2-70b-chat",
        "together_ai/togethercomputer/llama-2-70b",
        "together_ai/togethercomputer/LLaMA-2-7B-32K",
        "together_ai/togethercomputer/Llama-2-7B-32K-Instruct",
        "together_ai/togethercomputer/llama-2-7b",
        "together_ai/togethercomputer/alpaca-7b",
        "together_ai/togethercomputer/CodeLlama-34b-Instruct",
        "together_ai/togethercomputer/CodeLlama-34b-Python",
        "together_ai/WizardLM/WizardCoder-Python-34B-V1.0",
        "together_ai/NousResearch/Nous-Hermes-Llama2-13b",
        "together_ai/Austism/chronos-hermes-13b",
    ],
}

providers_list = list(supported_llm_models.keys())

model_to_provider_mapping = {
    model: provider
    for provider, models in supported_llm_models.items()
    for model in models
}
