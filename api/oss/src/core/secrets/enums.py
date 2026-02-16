from enum import Enum


class SecretKind(str, Enum):
    PROVIDER_KEY = "provider_key"
    CUSTOM_PROVIDER = "custom_provider"


class StandardProviderKind(str, Enum):
    OPENAI = "openai"
    COHERE = "cohere"
    ANYSCALE = "anyscale"
    DEEPINFRA = "deepinfra"
    ALEPHALPHA = "alephalpha"
    GROQ = "groq"
    MISTRAL = "mistral"
    MISTRALAI = "mistralai"
    ANTHROPIC = "anthropic"
    PERPLEXITYAI = "perplexityai"
    TOGETHERAI = "together_ai"
    OPENROUTER = "openrouter"
    GEMINI = "gemini"


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
    MISTRAL = "mistral"
    MISTRALAI = "mistralai"
    ANTHROPIC = "anthropic"
    PERPLEXITYAI = "perplexityai"
    TOGETHERAI = "together_ai"
    OPENROUTER = "openrouter"
    GEMINI = "gemini"
