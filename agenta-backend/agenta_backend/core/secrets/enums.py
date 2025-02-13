from enum import Enum


class SecretKind(str, Enum):
    PROVIDER_KEY = "provider_key"


class ProviderKind(str, Enum):
    OPENAI = "openai"
    COHERE = "cohere"
    ANYSCALE = "anyscale"
    DEEPINFRA = "deepinfra"
    ALEPHALPHA = "alephalpha"
    GROQ = "groq"
    MISTRALAI = "mistralai"
    ANTHROPIC = "anthropic"
    PERPLEXITYAI = "perplexityai"
    TOGETHERAI = "togetherai"
    OPENROUTER = "openrouter"
    GEMINI = "gemini"
