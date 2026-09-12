from enum import Enum


class SecretKind(str, Enum):
    PROVIDER_KEY = "provider_key"
    CUSTOM_PROVIDER = "custom_provider"
    SSO_PROVIDER = "sso_provider"
    WEBHOOK_PROVIDER = "webhook_provider"
    CUSTOM_SECRET = "custom_secret"
    SUBSCRIPTION_PROVIDER = "subscription_provider"
    OAUTH_PROVIDER = "oauth_provider"
    OAUTH_GRANT = "oauth_grant"


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
        "gpt-6-astra",
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


class LLMProviderKind(str, Enum):
    BUILTIN = "builtin"
    STANDARD = "standard"
    CUSTOM = "custom"


class LLMBuiltinProviderKind(str, Enum):
    AGENTA = "agenta"
    MOCK = "mock"


class LLMStandardProviderKind(str, Enum):
    MOCK = "mock"  # local gateway development catalogue only
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
# Production entries are kept in agreement with the frontend provider catalogue
# (`web/packages/agenta-shared/src/utils/llmProviders.ts`); MOCK is development-only.
LLM_STANDARD_PROVIDER_DISPLAY_NAMES = {
    LLMStandardProviderKind.MOCK: "Mock",
    LLMStandardProviderKind.OPENAI: "OpenAI",
    LLMStandardProviderKind.COHERE: "Cohere",
    LLMStandardProviderKind.ANYSCALE: "Anyscale",
    LLMStandardProviderKind.DEEPINFRA: "DeepInfra",
    LLMStandardProviderKind.ALEPHALPHA: "Aleph Alpha",
    LLMStandardProviderKind.GROQ: "Groq",
    LLMStandardProviderKind.MINIMAX: "MiniMax",
    LLMStandardProviderKind.MISTRAL: "Mistral AI",
    LLMStandardProviderKind.MISTRALAI: "Mistral AI",
    LLMStandardProviderKind.ANTHROPIC: "Anthropic",
    LLMStandardProviderKind.PERPLEXITYAI: "Perplexity AI",
    LLMStandardProviderKind.TOGETHERAI: "Together AI",
    LLMStandardProviderKind.OPENROUTER: "OpenRouter",
    LLMStandardProviderKind.GEMINI: "Google Gemini",
}


class MCPStandardProviderKind(str, Enum):
    MOCK = "mock"  # local gateway development catalogue only
    COMPOSIO = "composio"


class MCPProviderKind(str, Enum):
    BUILTIN = "builtin"
    STANDARD = "standard"
    CUSTOM = "custom"


class MCPBuiltinProviderKind(str, Enum):
    AGENTA = "agenta"
    COMPOSIO = "composio"
    MOCK = "mock"


class LLMCustomProviderKind(str, Enum):
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


class LLMEndpointProtocol(str, Enum):
    """The provider family a custom endpoint speaks, i.e. its request/response shape.

    Chat-completions vs responses is deliberately absent: the relay serves
    `/v1/chat/completions`, `/v1/responses` and `/v1/messages` on every custom endpoint and
    the harness picks the suffix. Only openai-vs-anthropic changes behaviour. A record
    written before this field existed has no value and is read as OpenAI-compatible.
    """

    OPENAI = "openai"
    ANTHROPIC = "anthropic"


# Compatibility names for the existing public Python client.
StandardProviderKind = LLMStandardProviderKind
CustomProviderKind = LLMCustomProviderKind
STANDARD_PROVIDER_DISPLAY_NAMES = LLM_STANDARD_PROVIDER_DISPLAY_NAMES
