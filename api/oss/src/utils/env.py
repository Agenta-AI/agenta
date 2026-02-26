import os
from uuid import getnode
from json import loads

from pydantic import BaseModel, ConfigDict


_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}
_LICENSE = "ee" if os.getenv("AGENTA_LICENSE") == "ee" else "oss"
MAC_ADDRESS = ":".join(f"{(getnode() >> ele) & 0xFF:02x}" for ele in range(40, -1, -8))


class SuperTokensConfig(BaseModel):
    """SuperTokens provider configuration"""

    uri_core: str = (
        os.getenv("SUPERTOKENS_URI_CORE")
        or os.getenv("SUPERTOKENS_CONNECTION_URI")
        or "http://supertokens:3567"
    )
    api_key: str | None = os.getenv("SUPERTOKENS_API_KEY")

    application: str = os.getenv("SUPERTOKENS_APPLICATION") or "default"
    tenant: str = os.getenv("SUPERTOKENS_TENANT") or "tenant"

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """SuperTokens enabled if both connection URI and API key present"""
        return bool(self.uri_core and self.api_key)

    def validate_config(self) -> None:
        """Validate SuperTokens configuration"""
        if not self.enabled:
            raise ValueError(
                "SuperTokens configuration required:\n"
                "  - SUPERTOKENS_URI_CORE\n"
                "  - SUPERTOKENS_API_KEY\n"
            )


class AuthConfig(BaseModel):
    """Authentication configuration - auto-detects enabled methods from env vars"""

    supertokens_email_disabled: bool = (
        os.getenv("SUPERTOKENS_EMAIL_DISABLED") or "false"
    ).lower() in _TRUTHY

    google_oauth_client_id: str | None = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    google_oauth_client_secret: str | None = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")

    google_workspaces_oauth_client_id: str | None = os.getenv(
        "GOOGLE_WORKSPACES_OAUTH_CLIENT_ID"
    )
    google_workspaces_oauth_client_secret: str | None = os.getenv(
        "GOOGLE_WORKSPACES_OAUTH_CLIENT_SECRET"
    )
    google_workspaces_hd: str | None = os.getenv("GOOGLE_WORKSPACES_HD")

    github_oauth_client_id: str | None = os.getenv("GITHUB_OAUTH_CLIENT_ID")
    github_oauth_client_secret: str | None = os.getenv("GITHUB_OAUTH_CLIENT_SECRET")

    facebook_oauth_client_id: str | None = os.getenv("FACEBOOK_OAUTH_CLIENT_ID")
    facebook_oauth_client_secret: str | None = os.getenv("FACEBOOK_OAUTH_CLIENT_SECRET")

    apple_oauth_client_id: str | None = os.getenv("APPLE_OAUTH_CLIENT_ID")
    apple_oauth_client_secret: str | None = os.getenv("APPLE_OAUTH_CLIENT_SECRET")
    apple_key_id: str | None = os.getenv("APPLE_KEY_ID")
    apple_team_id: str | None = os.getenv("APPLE_TEAM_ID")
    apple_private_key: str | None = os.getenv("APPLE_PRIVATE_KEY")

    discord_oauth_client_id: str | None = os.getenv("DISCORD_OAUTH_CLIENT_ID")
    discord_oauth_client_secret: str | None = os.getenv("DISCORD_OAUTH_CLIENT_SECRET")

    twitter_oauth_client_id: str | None = os.getenv("TWITTER_OAUTH_CLIENT_ID")
    twitter_oauth_client_secret: str | None = os.getenv("TWITTER_OAUTH_CLIENT_SECRET")

    gitlab_oauth_client_id: str | None = os.getenv("GITLAB_OAUTH_CLIENT_ID")
    gitlab_oauth_client_secret: str | None = os.getenv("GITLAB_OAUTH_CLIENT_SECRET")
    gitlab_base_url: str | None = os.getenv("GITLAB_BASE_URL")

    bitbucket_oauth_client_id: str | None = os.getenv("BITBUCKET_OAUTH_CLIENT_ID")
    bitbucket_oauth_client_secret: str | None = os.getenv(
        "BITBUCKET_OAUTH_CLIENT_SECRET"
    )

    linkedin_oauth_client_id: str | None = os.getenv("LINKEDIN_OAUTH_CLIENT_ID")
    linkedin_oauth_client_secret: str | None = os.getenv("LINKEDIN_OAUTH_CLIENT_SECRET")

    okta_oauth_client_id: str | None = os.getenv("OKTA_OAUTH_CLIENT_ID")
    okta_oauth_client_secret: str | None = os.getenv("OKTA_OAUTH_CLIENT_SECRET")
    okta_domain: str | None = os.getenv("OKTA_DOMAIN")

    azure_ad_oauth_client_id: str | None = os.getenv(
        "AZURE_AD_OAUTH_CLIENT_ID"
    ) or os.getenv("ACTIVE_DIRECTORY_OAUTH_CLIENT_ID")
    azure_ad_oauth_client_secret: str | None = os.getenv(
        "AZURE_AD_OAUTH_CLIENT_SECRET"
    ) or os.getenv("ACTIVE_DIRECTORY_OAUTH_CLIENT_SECRET")
    azure_ad_directory_id: str | None = os.getenv("AZURE_AD_DIRECTORY_ID") or os.getenv(
        "ACTIVE_DIRECTORY_DIRECTORY_ID"
    )

    boxy_saml_oauth_client_id: str | None = os.getenv("BOXY_SAML_OAUTH_CLIENT_ID")
    boxy_saml_oauth_client_secret: str | None = os.getenv(
        "BOXY_SAML_OAUTH_CLIENT_SECRET"
    )
    boxy_saml_url: str | None = os.getenv("BOXY_SAML_URL")

    model_config = ConfigDict(extra="ignore")

    def model_post_init(self, _):
        """Keep config normalized without relying on deprecated AGENTA_AUTHN_EMAIL."""
        return

    @property
    def email_method(self) -> str:
        """Returns email auth method: 'password', 'otp', or '' (disabled)"""
        if self.supertokens_email_disabled:
            return ""

        sendgrid_enabled = bool(
            os.getenv("SENDGRID_API_KEY")
            and (
                os.getenv("SENDGRID_FROM_ADDRESS")
                or os.getenv("AGENTA_AUTHN_EMAIL_FROM")
                or os.getenv("AGENTA_SEND_EMAIL_FROM_ADDRESS")
            )
        )
        return "otp" if sendgrid_enabled else "password"

    @property
    def email_enabled(self) -> bool:
        """Email auth enabled if authn_email is 'password' or 'otp'"""
        return self.email_method != ""

    @property
    def google_enabled(self) -> bool:
        """Google OAuth enabled if both credentials present"""
        return bool(self.google_oauth_client_id and self.google_oauth_client_secret)

    @property
    def google_workspaces_enabled(self) -> bool:
        """Google Workspaces OAuth enabled if both credentials present"""
        return bool(
            self.google_workspaces_oauth_client_id
            and self.google_workspaces_oauth_client_secret
        )

    @property
    def github_enabled(self) -> bool:
        """GitHub OAuth enabled if both credentials present"""
        return bool(self.github_oauth_client_id and self.github_oauth_client_secret)

    @property
    def facebook_enabled(self) -> bool:
        """Facebook OAuth enabled if both credentials present"""
        return bool(self.facebook_oauth_client_id and self.facebook_oauth_client_secret)

    @property
    def apple_enabled(self) -> bool:
        """Apple OAuth enabled if client ID present and secret or key data provided"""
        return bool(
            self.apple_oauth_client_id
            and (
                self.apple_oauth_client_secret
                or (self.apple_key_id and self.apple_team_id and self.apple_private_key)
            )
        )

    @property
    def discord_enabled(self) -> bool:
        """Discord OAuth enabled if both credentials present"""
        return bool(self.discord_oauth_client_id and self.discord_oauth_client_secret)

    @property
    def twitter_enabled(self) -> bool:
        """Twitter OAuth enabled if both credentials present"""
        return bool(self.twitter_oauth_client_id and self.twitter_oauth_client_secret)

    @property
    def gitlab_enabled(self) -> bool:
        """GitLab OAuth enabled if both credentials present"""
        return bool(self.gitlab_oauth_client_id and self.gitlab_oauth_client_secret)

    @property
    def bitbucket_enabled(self) -> bool:
        """Bitbucket OAuth enabled if both credentials present"""
        return bool(
            self.bitbucket_oauth_client_id and self.bitbucket_oauth_client_secret
        )

    @property
    def linkedin_enabled(self) -> bool:
        """LinkedIn OAuth enabled if both credentials present"""
        return bool(self.linkedin_oauth_client_id and self.linkedin_oauth_client_secret)

    @property
    def okta_enabled(self) -> bool:
        """Okta OAuth enabled if credentials and domain are present"""
        return bool(
            self.okta_oauth_client_id
            and self.okta_oauth_client_secret
            and self.okta_domain
        )

    @property
    def azure_ad_enabled(self) -> bool:
        """Azure AD OAuth enabled if credentials and directory ID are present"""
        return bool(
            self.azure_ad_oauth_client_id
            and self.azure_ad_oauth_client_secret
            and self.azure_ad_directory_id
        )

    @property
    def boxy_saml_enabled(self) -> bool:
        """BoxySAML OAuth enabled if credentials and Boxy URL are present"""
        return bool(
            self.boxy_saml_oauth_client_id
            and self.boxy_saml_oauth_client_secret
            and self.boxy_saml_url
        )

    @property
    def oidc_enabled(self) -> bool:
        """Any OIDC provider enabled"""
        return (
            self.google_enabled
            or self.google_workspaces_enabled
            or self.github_enabled
            or self.facebook_enabled
            or self.apple_enabled
            or self.discord_enabled
            or self.twitter_enabled
            or self.gitlab_enabled
            or self.bitbucket_enabled
            or self.linkedin_enabled
            or self.okta_enabled
            or self.azure_ad_enabled
            or self.boxy_saml_enabled
        )

    @property
    def any_enabled(self) -> bool:
        """At least one auth method enabled"""
        return self.email_enabled or self.oidc_enabled

    def validate_config(self) -> None:
        """Validate auth configuration"""
        # At least one auth method must be enabled
        if not self.any_enabled:
            raise ValueError(
                "At least one authentication method must be configured:\n"
                "  - SUPERTOKENS_EMAIL_DISABLED must be false (or unset) for email auth\n"
                "  - Any supported OAuth provider credentials, e.g.\n"
                "    GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET\n"
                "    GITHUB_OAUTH_CLIENT_ID + GITHUB_OAUTH_CLIENT_SECRET\n"
                "    FACEBOOK_OAUTH_CLIENT_ID + FACEBOOK_OAUTH_CLIENT_SECRET\n"
                "    APPLE_OAUTH_CLIENT_ID + APPLE_OAUTH_CLIENT_SECRET (or APPLE_KEY_ID/APPLE_TEAM_ID/APPLE_PRIVATE_KEY)\n"
                "    DISCORD_OAUTH_CLIENT_ID + DISCORD_OAUTH_CLIENT_SECRET\n"
                "    TWITTER_OAUTH_CLIENT_ID + TWITTER_OAUTH_CLIENT_SECRET\n"
                "    GITLAB_OAUTH_CLIENT_ID + GITLAB_OAUTH_CLIENT_SECRET\n"
                "    BITBUCKET_OAUTH_CLIENT_ID + BITBUCKET_OAUTH_CLIENT_SECRET\n"
                "    LINKEDIN_OAUTH_CLIENT_ID + LINKEDIN_OAUTH_CLIENT_SECRET\n"
                "    OKTA_OAUTH_CLIENT_ID + OKTA_OAUTH_CLIENT_SECRET + OKTA_DOMAIN\n"
                "    AZURE_AD_OAUTH_CLIENT_ID + AZURE_AD_OAUTH_CLIENT_SECRET + AZURE_AD_DIRECTORY_ID\n"
                "    BOXY_SAML_OAUTH_CLIENT_ID + BOXY_SAML_OAUTH_CLIENT_SECRET + BOXY_SAML_URL\n"
                "    GOOGLE_WORKSPACES_OAUTH_CLIENT_ID + GOOGLE_WORKSPACES_OAUTH_CLIENT_SECRET\n"
            )

        return


class PostHogConfig(BaseModel):
    """PostHog Analytics configuration"""

    api_url: str = (
        os.getenv("POSTHOG_API_URL")
        or os.getenv("POSTHOG_HOST")
        or "https://alef.agenta.ai"
    )
    api_key: str | None = (
        os.getenv("POSTHOG_API_KEY")
        or "phc_hmVSxIjTW1REBHXgj2aw4HW9X6CXb6FzerBgP9XenC7"
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """PostHog enabled if API key present"""
        return bool(self.api_key)


class StripeConfig(BaseModel):
    """Stripe Billing configuration"""

    api_key: str | None = os.getenv("STRIPE_API_KEY")
    webhook_target: str | None = (
        os.getenv("STRIPE_WEBHOOK_TARGET")
        #
        or os.getenv("STRIPE_TARGET")
        or MAC_ADDRESS
    )
    webhook_secret: str | None = os.getenv("STRIPE_WEBHOOK_SECRET")

    pricing: dict | None = None

    def __init__(self, **data):
        super().__init__(**data)
        try:
            self.pricing = loads(
                os.getenv("STRIPE_PRICING") or os.getenv("AGENTA_PRICING") or "{}"
            )
        except Exception:
            self.pricing = {}

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Stripe enabled if API key present"""
        return bool(self.api_key)


class SendgridConfig(BaseModel):
    """SendGrid Email configuration"""

    api_key: str | None = os.getenv("SENDGRID_API_KEY")
    from_address: str | None = (
        os.getenv("SENDGRID_FROM_ADDRESS")
        #
        or os.getenv("AGENTA_AUTHN_EMAIL_FROM")
        #
        or os.getenv("AGENTA_SEND_EMAIL_FROM_ADDRESS")
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """SendGrid enabled only if API key and from address are present"""
        return bool(self.api_key and self.from_address)


class CrispConfig(BaseModel):
    """Crisp Chat configuration"""

    website_id: str | None = os.getenv("CRISP_WEBSITE_ID")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Crisp enabled if website ID present"""
        return bool(self.website_id)


class LLMConfig(BaseModel):
    """LLM Provider API Keys configuration"""

    alephalpha: str = os.getenv("ALEPHALPHA_API_KEY", "")
    anthropic: str = os.getenv("ANTHROPIC_API_KEY", "")
    anyscale: str = os.getenv("ANYSCALE_API_KEY", "")
    cohere: str = os.getenv("COHERE_API_KEY", "")
    deepinfra: str = os.getenv("DEEPINFRA_API_KEY", "")
    gemini: str = os.getenv("GEMINI_API_KEY", "")
    groq: str = os.getenv("GROQ_API_KEY", "")
    mistral: str = os.getenv("MISTRAL_API_KEY", "")
    openai: str = os.getenv("OPENAI_API_KEY", "")
    openrouter: str = os.getenv("OPENROUTER_API_KEY", "")
    perplexityai: str = os.getenv("PERPLEXITYAI_API_KEY", "")
    togetherai: str = os.getenv("TOGETHERAI_API_KEY", "")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled_providers(self) -> list[str]:
        """Return list of enabled LLM providers"""
        return [
            name
            for name in [
                "alephalpha",
                "anthropic",
                "anyscale",
                "cohere",
                "deepinfra",
                "gemini",
                "groq",
                "mistral",
                "openai",
                "openrouter",
                "perplexityai",
                "togetherai",
            ]
            if getattr(self, name)
        ]


class NewRelicConfig(BaseModel):
    """New Relic monitoring configuration"""

    api_key: str | None = (
        os.getenv("NEW_RELIC_LICENSE_KEY")
        #
        or os.getenv("NRIA_LICENSE_KEY")
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """New Relic enabled if license key present"""
        return bool(self.api_key)


class LoopsConfig(BaseModel):
    """Loops email marketing configuration"""

    api_key: str | None = os.getenv("LOOPS_API_KEY")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Loops enabled if API key present"""
        return bool(self.api_key)


class DockerConfig(BaseModel):
    """Docker runtime configuration"""

    network_mode: str = os.getenv("DOCKER_NETWORK_MODE") or "bridge"

    model_config = ConfigDict(extra="ignore")


class LoggingConfig(BaseModel):
    """Logging configuration"""

    console_enabled: bool = (
        os.getenv("AGENTA_LOG_CONSOLE_ENABLED") or "true"
    ).lower() in _TRUTHY
    console_level: str = (os.getenv("AGENTA_LOG_CONSOLE_LEVEL") or "TRACE").upper()

    otlp_enabled: bool = (
        os.getenv("AGENTA_LOG_OTLP_ENABLED") or "false"
    ).lower() in _TRUTHY
    otlp_level: str = (os.getenv("AGENTA_LOG_OTLP_LEVEL") or "INFO").upper()

    file_enabled: bool = (
        os.getenv("AGENTA_LOG_FILE_ENABLED") or "true"
    ).lower() in _TRUTHY
    file_level: str = (os.getenv("AGENTA_LOG_FILE_LEVEL") or "WARNING").upper()
    file_base: str = os.getenv("AGENTA_LOG_FILE_PATH", "error")

    model_config = ConfigDict(extra="ignore")


class OTLPConfig(BaseModel):
    """OpenTelemetry Protocol configuration"""

    max_batch_bytes: int = int(
        os.getenv("AGENTA_OTLP_MAX_BATCH_BYTES") or str(10 * 1024 * 1024)
    )

    model_config = ConfigDict(extra="ignore")


class RedisConfig(BaseModel):
    """Redis/Valkey configuration with precedence-based URI resolution"""

    # Global fallback
    uri_volatile: str | None = (
        os.getenv("REDIS_URI_VOLATILE")
        or os.getenv("REDIS_URI")
        or "redis://redis-volatile:6379/0"
    )
    uri_durable: str | None = (
        os.getenv("REDIS_URI_DURABLE")
        or os.getenv("REDIS_URI")
        or "redis://redis-durable:6381/0"
    )

    # Cache control flag - defaults to true
    cache_enabled: bool = os.getenv("AGENTA_CACHE_ENABLED", "true").lower() in (
        "true",
        "1",
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Redis enabled if URIs are configured"""
        return bool(self.uri_volatile or self.uri_durable)


class AgentaConfig(BaseModel):
    """Agenta core configuration"""

    license: str = _LICENSE

    web_url: str = os.getenv("AGENTA_WEB_URL") or "http://localhost"
    services_url: str = os.getenv("AGENTA_SERVICES_URL") or "http://localhost/services"
    api_url: str = os.getenv("AGENTA_API_URL") or "http://localhost/api"

    auth_key: str = os.getenv("AGENTA_AUTH_KEY") or "replace-me"
    crypt_key: str = os.getenv("AGENTA_CRYPT_KEY") or "replace-me"

    runtime_prefix: str = os.getenv("AGENTA_RUNTIME_PREFIX") or ""

    auto_migrations: bool = (
        os.getenv("ALEMBIC_AUTO_MIGRATIONS")
        or os.getenv("AGENTA_AUTO_MIGRATIONS")
        or "true"
    ).lower() in _TRUTHY

    demos: str = os.getenv("AGENTA_DEMOS") or ""

    blocked_emails: set = {
        e.strip().lower()
        for e in (os.getenv("AGENTA_BLOCKED_EMAILS") or "").split(",")
        if e.strip()
    }
    blocked_domains: set = {
        e.strip().lower()
        for e in (os.getenv("AGENTA_BLOCKED_DOMAINS") or "").split(",")
        if e.strip()
    }
    allowed_domains: set = {
        e.strip().lower()
        for e in (os.getenv("AGENTA_ALLOWED_DOMAINS") or "").split(",")
        if e.strip()
    }

    model_config = ConfigDict(extra="ignore")


class PostgresConfig(BaseModel):
    """PostgreSQL database configuration"""

    uri_core: str = os.getenv("POSTGRES_URI_CORE") or (
        f"postgresql+asyncpg://username:password@postgres:5432/agenta_{_LICENSE}_core"
    )
    uri_tracing: str = os.getenv("POSTGRES_URI_TRACING") or (
        f"postgresql+asyncpg://username:password@postgres:5432/agenta_{_LICENSE}_tracing"
    )
    uri_supertokens: str = os.getenv("POSTGRES_URI_SUPERTOKENS") or (
        f"postgresql://username:password@postgres:5432/agenta_{_LICENSE}_supertokens"
    )

    username: str = os.getenv("POSTGRES_USER") or "username"
    password: str = os.getenv("POSTGRES_PASSWORD") or "password"

    model_config = ConfigDict(extra="ignore")


class ComposioConfig(BaseModel):
    """Composio integration configuration"""

    api_key: str | None = os.getenv("COMPOSIO_API_KEY")
    api_url: str = os.getenv("COMPOSIO_API_URL", "https://backend.composio.dev/api/v3")

    @property
    def enabled(self) -> bool:
        """Composio enabled if API key is present"""
        return bool(self.api_key)

    model_config = ConfigDict(extra="ignore")


class AlembicConfig(BaseModel):
    """Database migration configuration"""

    cfg_path_core: str = os.getenv("ALEMBIC_CFG_PATH_CORE") or (
        f"/app/{_LICENSE}/databases/postgres/migrations/core/alembic.ini"
    )
    cfg_path_tracing: str = os.getenv("ALEMBIC_CFG_PATH_TRACING") or (
        f"/app/{_LICENSE}/databases/postgres/migrations/tracing/alembic.ini"
    )

    model_config = ConfigDict(extra="ignore")


class AIServicesConfig(BaseModel):
    """AI services configuration.

    Feature is enabled only when all required env vars are present.
    """

    api_key: str | None = os.getenv("AGENTA_AI_SERVICES_API_KEY")
    api_url: str | None = os.getenv("AGENTA_AI_SERVICES_API_URL")
    environment_slug: str | None = os.getenv("AGENTA_AI_SERVICES_ENVIRONMENT_SLUG")
    refine_prompt_key: str | None = os.getenv("AGENTA_AI_SERVICES_REFINE_PROMPT_KEY")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        required = [
            self.api_key,
            self.api_url,
            self.environment_slug,
            self.refine_prompt_key,
        ]
        return all(isinstance(v, str) and v.strip() for v in required)


class EnvironSettings(BaseModel):
    """
    Main environment settings container with nested Pydantic models.

    All configuration is organized into 16 dedicated config classes.
    Each config is a Pydantic BaseModel with typed fields and validation.

    Usage:
        from oss.src.utils.env import env

        # Access auth methods
        if env.auth.email_enabled:
            method = env.auth.email_method  # "password", "otp", or ""

        # Access SuperTokens provider
        if env.supertokens.enabled:
            uri = env.supertokens.uri_core

        # Access service availability
        if env.stripe.enabled:
            process_billing()

        if env.redis.enabled:
            connect_to_redis(env.redis.uri_durable)
    """

    auth: AuthConfig = AuthConfig()
    supertokens: SuperTokensConfig = SuperTokensConfig()
    posthog: PostHogConfig = PostHogConfig()
    stripe: StripeConfig = StripeConfig()
    sendgrid: SendgridConfig = SendgridConfig()
    crisp: CrispConfig = CrispConfig()
    llm: LLMConfig = LLMConfig()
    newrelic: NewRelicConfig = NewRelicConfig()
    loops: LoopsConfig = LoopsConfig()
    docker: DockerConfig = DockerConfig()
    logging: LoggingConfig = LoggingConfig()
    otlp: OTLPConfig = OTLPConfig()
    redis: RedisConfig = RedisConfig()
    agenta: AgentaConfig = AgentaConfig()
    ai_services: AIServicesConfig = AIServicesConfig()
    postgres: PostgresConfig = PostgresConfig()
    alembic: AlembicConfig = AlembicConfig()
    composio: ComposioConfig = ComposioConfig()

    model_config = ConfigDict(extra="ignore")


# Create singleton global env instance
env = EnvironSettings()
