from enum import Enum


class SecretKind(str, Enum):
    PROVIDER_KEY = "provider_key"
    CUSTOM_PROVIDER = "custom_provider"
    SSO_PROVIDER = "sso_provider"
    WEBHOOK_PROVIDER = "webhook_provider"
    CUSTOM_SECRET = "custom_secret"
    SUBSCRIPTION_PROVIDER = "subscription_provider"


class SubscriptionProviderKind(str, Enum):
    """The product family behind a hosted subscription connection."""

    CHATGPT = "chatgpt"


class SubscriptionLoginState(str, Enum):
    """How usable the stored subscription login is right now."""

    # No login has ever been stored, or the last one was removed.
    PENDING_LOGIN = "pending_login"
    READY = "ready"
    # A run reported that the login is dead and no newer login exists.
    NEEDS_LOGIN = "needs_login"


# The models a ChatGPT subscription can drive, and the harnesses that can drive them.
# Copied from `PI_SUBSCRIPTION_MODELS["openai-codex"]` in
# `sdks/python/agenta/sdk/agents/capabilities.py` rather than imported: the API must not
# depend on the SDK's agent catalog. Keep the two lists in agreement when Pi's pinned
# version changes its codex model set.
SUBSCRIPTION_PROVIDER_MODELS = {
    SubscriptionProviderKind.CHATGPT: [
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-5.4",
        "gpt-5.4-mini",
        "gpt-5.3-codex-spark",
    ],
}

SUBSCRIPTION_PROVIDER_HARNESSES = {
    SubscriptionProviderKind.CHATGPT: ["pi_core"],
}

# The display name a new subscription connection takes when the caller sends none.
SUBSCRIPTION_PROVIDER_DISPLAY_NAMES = {
    SubscriptionProviderKind.CHATGPT: "ChatGPT",
}


class CustomSecretFormat(str, Enum):
    TEXT = "text"
    JSON = "json"


class StandardProviderKind(str, Enum):
    OPENAI = "openai"
    COHERE = "cohere"
    ANYSCALE = "anyscale"
    DEEPINFRA = "deepinfra"
    ALEPHALPHA = "alephalpha"
    GROQ = "groq"
    MINIMAX = "minimax"
    MISTRAL = "mistral"
    MISTRALAI = "mistralai"
    ANTHROPIC = "anthropic"
    PERPLEXITYAI = "perplexityai"
    TOGETHERAI = "together_ai"
    OPENROUTER = "openrouter"
    GEMINI = "gemini"


# The user-facing name of each standard provider, used to name an unnamed connection on create.
# Kept in agreement with the frontend provider catalog
# (`web/packages/agenta-shared/src/utils/llmProviders.ts`).
STANDARD_PROVIDER_DISPLAY_NAMES = {
    StandardProviderKind.OPENAI: "OpenAI",
    StandardProviderKind.COHERE: "Cohere",
    StandardProviderKind.ANYSCALE: "Anyscale",
    StandardProviderKind.DEEPINFRA: "DeepInfra",
    StandardProviderKind.ALEPHALPHA: "Aleph Alpha",
    StandardProviderKind.GROQ: "Groq",
    StandardProviderKind.MINIMAX: "MiniMax",
    StandardProviderKind.MISTRAL: "Mistral AI",
    StandardProviderKind.MISTRALAI: "Mistral AI",
    StandardProviderKind.ANTHROPIC: "Anthropic",
    StandardProviderKind.PERPLEXITYAI: "Perplexity AI",
    StandardProviderKind.TOGETHERAI: "Together AI",
    StandardProviderKind.OPENROUTER: "OpenRouter",
    StandardProviderKind.GEMINI: "Google Gemini",
}


class CustomProviderKind(str, Enum):
    CUSTOM = "custom"
    AZURE = "azure"
    BEDROCK = "bedrock"
    SAGEMAKER = "sagemaker"
    VERTEX = "vertex_ai"
    OPENAI = "openai"
    COHERE = "cohere"
    ANYSCALE = "anyscale"
    DEEPINFRA = "deepinfra"
    ALEPHALPHA = "alephalpha"
    GROQ = "groq"
    MINIMAX = "minimax"
    MISTRAL = "mistral"
    MISTRALAI = "mistralai"
    ANTHROPIC = "anthropic"
    PERPLEXITYAI = "perplexityai"
    TOGETHERAI = "together_ai"
    OPENROUTER = "openrouter"
    GEMINI = "gemini"
