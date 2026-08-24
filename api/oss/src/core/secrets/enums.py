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
    MOCK = "mock"  # local gateway development catalogue only
