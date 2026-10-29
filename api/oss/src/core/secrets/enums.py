from enum import Enum


class SecretKind(str, Enum):
    PROVIDER_KEY = "provider_key"
    CUSTOM_PROVIDER = "custom_provider"
    SSO_PROVIDER = "sso_provider"
    WEBHOOK_PROVIDER = "webhook_provider"
    CUSTOM_SECRET = "custom_secret"
    CHANNEL_SECRET = "channel_secret"
    SUBSCRIPTION_PROVIDER = "subscription_provider"
    OAUTH_PROVIDER = "oauth_provider"
    OAUTH_GRANT = "oauth_grant"
    # A person's pasted token for a project's MCP server, at `token_slug(server id)`. It
    # has the custom secret data shape, and its own kind keeps it out of the person's
    # custom secret lists and the secret picker.
    MCP_TOKEN = "mcp_token"


# Kinds whose credential material may NEVER be read back through a response, whatever a
# caller asked for on create and whatever a stored row happens to say.
#
# `write_only` is otherwise the creator's choice, and for most kinds that is right: a
# provider key someone pasted in is theirs to read back. An OAuth grant is not. Nobody typed
# it, its access and refresh tokens are minted by the provider for this installation, and the
# refresh token in particular buys new access tokens for as long as the grant lives. So the
# one caller that legitimately needs the real value is the broker, which reads it server-side
# and never through the redacted projection.
#
# Enforced in three places, because each answers a different question: `CreateSecretDTO`
# refuses the caller's `False`, the update mapping refuses to carry an old `False` forward,
# and `_SecretResponseBaseDTO` forces it on the way out so a row stored before this rule —
# or any row whose mark went missing — is still redacted. The last one is what makes the
# default fail CLOSED and is why no data migration is needed.
#
# A person's MCP token is the same: only the MCP gateway reads it.
ALWAYS_WRITE_ONLY_KINDS = frozenset({SecretKind.OAUTH_GRANT, SecretKind.MCP_TOKEN})


def is_always_write_only(kind) -> bool:
    """Is this kind one whose credential material is never readable back?

    Takes the enum or its wire string, because the three call sites hold it differently: a
    DTO validator sees whatever the caller sent, and the update mapping reads it off a
    database row as a plain string.
    """
    if isinstance(kind, SecretKind):
        return kind in ALWAYS_WRITE_ONLY_KINDS
    try:
        return SecretKind(kind) in ALWAYS_WRITE_ONLY_KINDS
    except ValueError:
        # An unknown kind is not one of ours to force. It cannot be an OAuth grant.
        return False


# Who owns a stored secret. Storage keeps the typed columns (`project_id`,
# `organization_id`, `user_id`); the DAO maps the kind to the columns. A user owner is a
# person inside one organization.
class SecretOwnerKind(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"
    USER = "user"


# Which projects an organization credential reaches. `selected_projects` with no listed
# project reaches no project; it never means "every project".
class SecretAvailability(str, Enum):
    ALL_PROJECTS = "all_projects"
    SELECTED_PROJECTS = "selected_projects"


# The kinds an organization can share with its projects. An agent uses a shared row only
# when it names it. Every other kind stays project-owned (or, for SSO, organization-only).
ORGANIZATION_SECRET_KINDS = frozenset(
    {
        SecretKind.PROVIDER_KEY,
        SecretKind.CUSTOM_PROVIDER,
        SecretKind.SUBSCRIPTION_PROVIDER,
        SecretKind.CUSTOM_SECRET,
    }
)

# The kinds a person may store through the vault routes (`scope=user`). The table also
# allows subscription logins, OAuth grants and MCP tokens; the MCP routes write the last
# two, and no flow creates a person's subscription login yet.
PERSONAL_SECRET_KINDS = frozenset({SecretKind.CUSTOM_SECRET})

# A person's MCP sign-ins: written and read only by the MCP routes and gateway, never
# listed by the vault.
SIGN_IN_SECRET_KINDS = frozenset({SecretKind.OAUTH_GRANT, SecretKind.MCP_TOKEN})
# The organization kinds the LLM gateway serves. Their values never leave the API. An
# organization subscription login is the one kind that does: it reaches the runner of a
# run that named it, which uses it like a project login.
ORGANIZATION_GATEWAY_KINDS = frozenset(
    {SecretKind.PROVIDER_KEY, SecretKind.CUSTOM_PROVIDER}
)


class ChannelSecretKind(str, Enum):
    SLACK = "slack"
    TELEGRAM = "telegram"
    WHATSAPP = "whatsapp"
    AGENTA = "agenta"
    BRIDGE = "bridge"


class SubscriptionProviderKind(str, Enum):
    """The product family behind a hosted subscription connection."""

    CHATGPT = "chatgpt"
    CLAUDE = "claude"


class SubscriptionLoginState(str, Enum):
    """How usable the stored subscription login is right now."""

    # No login has ever been stored, or the last one was removed.
    PENDING_LOGIN = "pending_login"
    READY = "ready"
    # A run reported that the login is dead and no newer login exists.
    NEEDS_LOGIN = "needs_login"


# The models each subscription can drive, and the harnesses that can drive them. Copied
# from `sdks/python/agenta/sdk/agents/capabilities.py` rather than imported: the API must
# not depend on the SDK's agent catalog. ChatGPT follows `PI_SUBSCRIPTION_MODELS
# ["openai-codex"]` and Claude follows `CLAUDE_MODEL_ALIASES`; keep each in agreement when
# the pinned harness changes its model set.
SUBSCRIPTION_PROVIDER_MODELS = {
    SubscriptionProviderKind.CHATGPT: [
        "gpt-6.1-sol",
        "gpt-6-astra",
        "gpt-6-sol",
        "gpt-6-luna",
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.5",
        "gpt-5.3-codex-spark",
    ],
    SubscriptionProviderKind.CLAUDE: [
        "default",
        "sonnet",
        "haiku",
        "opus[1m]",
        "claude-fable-5-1",
    ],
}

SUBSCRIPTION_PROVIDER_HARNESSES = {
    SubscriptionProviderKind.CHATGPT: ["pi_core"],
    SubscriptionProviderKind.CLAUDE: ["claude"],
}

# Every list SUBSCRIPTION_PROVIDER_MODELS has ever held, the current one included, written
# out as literals. A stored row whose list matches one of these (as a set) carries a
# create-time snapshot of the defaults, not a user's narrowing: the create path used to
# write the defaults into the row, so a connection made before a catalog update kept
# offering the old lineup. Such a row is normalized back to "follow the current defaults". Never derive an entry from
# SUBSCRIPTION_PROVIDER_MODELS: when that list changes, the entry would change with it and
# the outgoing lineup would match no snapshot. Add the new list here whenever
# SUBSCRIPTION_PROVIDER_MODELS changes, or connections created under the old one stay pinned.
# Claude has no entry: it arrived after the create path stopped writing the defaults, and a
# default-filled read written back matches the current list, which the validator checks too.
SUBSCRIPTION_PROVIDER_MODEL_SNAPSHOTS = {
    SubscriptionProviderKind.CHATGPT: (
        # Introduced with the subscription_provider kind (pre Pi 0.87.1).
        frozenset(
            {
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna",
                "gpt-5.5",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.3-codex-spark",
            }
        ),
        # After the gpt-6-astra addition.
        frozenset(
            {
                "gpt-6-astra",
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna",
                "gpt-5.5",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.3-codex-spark",
            }
        ),
        # After GPT-6 Sol and Luna, and dropping the models Pi cannot run (578ce12e).
        frozenset(
            {
                "gpt-6-astra",
                "gpt-6-sol",
                "gpt-6-luna",
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna",
                "gpt-5.5",
                "gpt-5.3-codex-spark",
            }
        ),
        # After the GPT-6.1 Sol addition (Pi 0.99.1).
        frozenset(
            {
                "gpt-6.1-sol",
                "gpt-6-astra",
                "gpt-6-sol",
                "gpt-6-luna",
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna",
                "gpt-5.5",
                "gpt-5.3-codex-spark",
            }
        ),
    ),
}

# The display name a new subscription connection takes when the caller sends none.
SUBSCRIPTION_PROVIDER_DISPLAY_NAMES = {
    SubscriptionProviderKind.CHATGPT: "ChatGPT",
    SubscriptionProviderKind.CLAUDE: "Claude",
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
    XAI = "xai"


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
    LLMStandardProviderKind.XAI: "xAI",
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
    XAI = "xai"


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
