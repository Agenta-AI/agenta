from enum import Enum


class SecretKind(str, Enum):
    PROVIDER_KEY = "provider_key"
    CUSTOM_PROVIDER = "custom_provider"
    SSO_PROVIDER = "sso_provider"
    WEBHOOK_PROVIDER = "webhook_provider"
    CUSTOM_SECRET = "custom_secret"
    OAUTH_PROVIDER = "oauth_provider"
    OAUTH_GRANT = "oauth_grant"


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


# Compatibility names for the existing public Python client.
StandardProviderKind = LLMStandardProviderKind
CustomProviderKind = LLMCustomProviderKind
STANDARD_PROVIDER_DISPLAY_NAMES = LLM_STANDARD_PROVIDER_DISPLAY_NAMES
