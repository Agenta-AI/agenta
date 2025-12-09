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

    authn_email: str | None = os.getenv("AGENTA_AUTHN_EMAIL")

    google_oauth_client_id: str | None = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    google_oauth_client_secret: str | None = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")

    github_oauth_client_id: str | None = os.getenv("GITHUB_OAUTH_CLIENT_ID")
    github_oauth_client_secret: str | None = os.getenv("GITHUB_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    def model_post_init(self, _):
        """Ensure at least one auth method is enabled; fallback to password email."""
        if not self.authn_email and not self.oidc_enabled:
            self.authn_email = "password"

    @property
    def email_method(self) -> str:
        """Returns email auth method: 'password', 'otp', or '' (disabled)"""
        if self.authn_email in ("password", "otp"):
            return self.authn_email
        return ""

    @property
    def email_enabled(self) -> bool:
        """Email auth enabled if authn_email is 'password' or 'otp'"""
        return self.email_method != ""

    @property
    def google_enabled(self) -> bool:
        """Google OAuth enabled if both credentials present"""
        return bool(self.google_oauth_client_id and self.google_oauth_client_secret)

    @property
    def github_enabled(self) -> bool:
        """GitHub OAuth enabled if both credentials present"""
        return bool(self.github_oauth_client_id and self.github_oauth_client_secret)

    @property
    def oidc_enabled(self) -> bool:
        """Any OIDC provider enabled"""
        return self.google_enabled or self.github_enabled

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
                "  - AGENTA_AUTHN_EMAIL=password or AGENTA_AUTHN_EMAIL=otp\n"
                "  - GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET\n"
                "  - GITHUB_OAUTH_CLIENT_ID + GITHUB_OAUTH_CLIENT_SECRET\n"
            )

        # Email auth value must be valid
        if self.authn_email and self.authn_email not in ("password", "otp"):
            raise ValueError(
                f"Invalid AGENTA_AUTHN_EMAIL value: '{self.authn_email}'. "
                "Must be 'password', 'otp', or empty (disabled)."
            )


class PostHogConfig(BaseModel):
    """PostHog Analytics configuration"""

    api_url: str = (
        os.getenv("POSTHOG_API_URL")
        or os.getenv("POSTHOG_HOST")
        or "https://alef.agenta.ai"
    )
    api_key: str | None = os.getenv("POSTHOG_API_KEY")

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
                os.getenv("STRIPE_PRICING")
                or os.getenv("AGENTA_PRICING")
                or "{}"
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
        or os.getenv("AGENTA_SEND_EMAIL_FROM_ADDRESS")
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """SendGrid enabled if API key present"""
        return bool(self.api_key)


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

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Redis enabled if URIs are configured"""
        return bool(self.uri_volatile or self.uri_durable)


class AgentaConfig(BaseModel):
    """Agenta core configuration"""

    license: str = _LICENSE

    api_url: str = os.getenv("AGENTA_API_URL") or "http://localhost/api"
    web_url: str = os.getenv("AGENTA_WEB_URL") or "http://localhost"
    services_url: str = os.getenv("AGENTA_SERVICES_URL") or "http://localhost/services"

    auth_key: str = os.getenv("AGENTA_AUTH_KEY") or ""
    crypt_key: str = os.getenv("AGENTA_CRYPT_KEY") or ""

    runtime_prefix: str = os.getenv("AGENTA_RUNTIME_PREFIX") or ""

    auto_migrations: bool = (
        os.getenv("AGENTA_AUTO_MIGRATIONS") or "true"
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

    username: str = (
        os.getenv("POSTGRES_USERNAME")
        #
        or os.getenv("POSTGRES_USER")
        or "username"
    )
    password: str = os.getenv("POSTGRES_PASSWORD") or "password"

    username_admin: str = (
        os.getenv("POSTGRES_USERNAME_ADMIN")
        #
        or os.getenv("POSTGRES_USER_ADMIN")
        or "username"
    )
    password_admin: str = os.getenv("POSTGRES_PASSWORD_ADMIN") or "password"

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
    postgres: PostgresConfig = PostgresConfig()
    alembic: AlembicConfig = AlembicConfig()

    model_config = ConfigDict(extra="ignore")


# Create singleton global env instance
env = EnvironSettings()
