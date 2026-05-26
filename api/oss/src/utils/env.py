import os
import hashlib
from uuid import getnode
from json import loads
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict


_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}
_LICENSE = "ee" if os.getenv("AGENTA_LICENSE") == "ee" else "oss"
MAC_ADDRESS = ":".join(f"{(getnode() >> ele) & 0xFF:02x}" for ele in range(40, -1, -8))


# ---------------------------------------------------------------------------
# Helper JSON loaders (used by access + billing configs).
# ---------------------------------------------------------------------------


def _load_json_env_raw(name: str) -> object | None:
    raw = os.getenv(name)
    if raw is None:
        return None
    raw = raw.strip()
    if not raw:
        return None
    try:
        return loads(raw)
    except Exception as e:
        raise ValueError(f"{name} is not valid JSON: {e}") from e


def _load_json_env_dict(name: str) -> dict | None:
    """Parse `name` as a JSON object, or return None if unset/empty."""
    value = _load_json_env_raw(name)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be a JSON object, got {type(value).__name__}")
    return value


def _load_json_env_dict_first(*names: str) -> dict | None:
    """Parse the first set JSON object from `names`, or return None."""
    for name in names:
        value = _load_json_env_dict(name)
        if value is not None:
            return value
    return None


def _load_json_env_list(name: str) -> list | None:
    """Parse `name` as a JSON array, or return None if unset/empty."""
    value = _load_json_env_raw(name)
    if value is None:
        return None
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a JSON array, got {type(value).__name__}")
    return value


def _comma_set(name: str, *legacy_names: str) -> set:
    """Parse `name` (or any legacy alias) as comma-separated lowercase set."""
    raw = os.getenv(name)
    if raw is None:
        for legacy in legacy_names:
            raw = os.getenv(legacy)
            if raw is not None:
                break
    if not raw:
        return set()
    return {e.strip().lower() for e in raw.split(",") if e.strip()}


def _comma_set_optional(name: str, *legacy_names: str) -> set | None:
    s = _comma_set(name, *legacy_names)
    return s or None


# ---------------------------------------------------------------------------
# agenta.access — access controls.
# ---------------------------------------------------------------------------


class AccessConfig(BaseModel):
    """Access controls (allow/block lists, plans + roles, default plan).

    JSON env vars are parsed here at startup. Schema validation happens in
    ``ee.src.core.entitlements.controls``.

    `default_plan` lives here (not under `agenta`) because it's part of the
    access-controls surface: it selects which entry of the effective plan
    map a new organization is onboarded onto, even on Stripe-disabled
    deployments.
    """

    allowed_domains: set = _comma_set(
        "AGENTA_ACCESS_ALLOWED_DOMAINS",
        "AGENTA_ALLOWED_DOMAINS",
    )
    allowed_owner_emails: set | None = _comma_set_optional(
        "AGENTA_ACCESS_ALLOWED_OWNER_EMAILS",
        "AGENTA_ACCESS_ALLOWED_ORGANIZATION_OWNERS",
        "AGENTA_ACCESS_ORG_CREATION_ALLOWLIST",
        "AGENTA_ORG_CREATION_ALLOWLIST",
    )
    blocked_domains: set = _comma_set(
        "AGENTA_ACCESS_BLOCKED_DOMAINS",
        "AGENTA_BLOCKED_DOMAINS",
    )
    blocked_emails: set = _comma_set(
        "AGENTA_ACCESS_BLOCKED_EMAILS",
        "AGENTA_BLOCKED_EMAILS",
    )

    default_plan: str | None = (
        os.getenv("AGENTA_ACCESS_DEFAULT_PLAN")
        or os.getenv("AGENTA_DEFAULT_PLAN")
        or None
    )
    default_plan_overlay: dict | None = _load_json_env_dict(
        "AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY"
    )

    email_disabled: bool = (
        os.getenv("AGENTA_ACCESS_EMAIL_DISABLED")
        or os.getenv("SUPERTOKENS_EMAIL_DISABLED")
        or "false"
    ).lower() in _TRUTHY

    plans: dict | None = _load_json_env_dict("AGENTA_ACCESS_PLANS")
    roles: dict | None = _load_json_env_dict("AGENTA_ACCESS_ROLES")
    roles_overlay: dict | None = _load_json_env_dict("AGENTA_ACCESS_ROLES_OVERLAY")

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# agenta.ai_services
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# agenta.billing
# ---------------------------------------------------------------------------


class BillingConfig(BaseModel):
    """Billing settings (catalog + Stripe pricing).

    JSON env vars are parsed here at startup. Schema validation happens in
    ``ee.src.core.subscriptions.settings``. The free-plan marker and
    reverse-trial duration live per-entry inside ``AGENTA_BILLING_PRICING``
    (`{"free": true}` / `{"trial": N}`).
    """

    catalog: list | None = _load_json_env_list("AGENTA_BILLING_CATALOG")
    pricing: dict | None = _load_json_env_dict_first(
        "AGENTA_BILLING_PRICING",
        "AGENTA_PRICING",
        "STRIPE_PRICING",
    )

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# agenta.api — API-specific sub-namespace (caching, etc.)
# ---------------------------------------------------------------------------


class ApiCachingConfig(BaseModel):
    """API response caching feature flag."""

    enabled: bool = (
        os.getenv("AGENTA_API_CACHING_ENABLED")
        or os.getenv("AGENTA_CACHING_ENABLED")
        or os.getenv("AGENTA_CACHE_ENABLED")
        or "true"
    ).lower() in _TRUTHY

    model_config = ConfigDict(extra="ignore")


class ApiConfig(BaseModel):
    """Agenta API sub-namespace."""

    caching: ApiCachingConfig = ApiCachingConfig()

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# agenta.extras
# ---------------------------------------------------------------------------


class ExtrasConfig(BaseModel):
    """Extras and feature toggles (demos, etc.)."""

    demos: str = os.getenv("AGENTA_EXTRAS_DEMOS") or os.getenv("AGENTA_DEMOS") or ""

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# agenta.logging
# ---------------------------------------------------------------------------


class LoggingConfig(BaseModel):
    """Logging configuration"""

    console_enabled: bool = (
        os.getenv("AGENTA_LOGGING_CONSOLE_ENABLED")
        or os.getenv("AGENTA_LOG_CONSOLE_ENABLED")
        or "true"
    ).lower() in _TRUTHY
    console_level: str = (
        os.getenv("AGENTA_LOGGING_CONSOLE_LEVEL")
        or os.getenv("AGENTA_LOG_CONSOLE_LEVEL")
        or "TRACE"
    ).upper()

    file_enabled: bool = (
        os.getenv("AGENTA_LOGGING_FILE_ENABLED")
        or os.getenv("AGENTA_LOG_FILE_ENABLED")
        or "true"
    ).lower() in _TRUTHY
    file_level: str = (
        os.getenv("AGENTA_LOGGING_FILE_LEVEL")
        or os.getenv("AGENTA_LOG_FILE_LEVEL")
        or "WARNING"
    ).upper()
    file_path: str = (
        os.getenv("AGENTA_LOGGING_FILE_PATH")
        or os.getenv("AGENTA_LOG_FILE_PATH")
        or "error"
    )

    otlp_enabled: bool = (
        os.getenv("AGENTA_LOGGING_OTLP_ENABLED")
        or os.getenv("AGENTA_LOG_OTLP_ENABLED")
        or "false"
    ).lower() in _TRUTHY
    otlp_level: str = (
        os.getenv("AGENTA_LOGGING_OTLP_LEVEL")
        or os.getenv("AGENTA_LOG_OTLP_LEVEL")
        or "INFO"
    ).upper()

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# agenta.otlp
# ---------------------------------------------------------------------------


class OTLPConfig(BaseModel):
    """OpenTelemetry Protocol configuration"""

    max_batch_bytes: int = int(
        os.getenv("AGENTA_OTLP_MAX_BATCH_BYTES") or str(10 * 1024 * 1024)
    )

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# agenta.services — code, hook, middleware sub-models.
# ---------------------------------------------------------------------------


class ServicesCodeConfig(BaseModel):
    sandbox_runner: str = (
        os.getenv("AGENTA_SERVICES_CODE_SANDBOX_RUNNER")
        or os.getenv("AGENTA_SERVICES_SANDBOX_RUNNER")
        or "local"
    )

    model_config = ConfigDict(extra="ignore")


class ServicesHookConfig(BaseModel):
    allow_insecure: bool = (
        os.getenv("AGENTA_SERVICES_HOOK_ALLOW_INSECURE")
        or os.getenv("AGENTA_WEBHOOK_ALLOW_INSECURE")
        or "true"
    ).lower() in _TRUTHY

    model_config = ConfigDict(extra="ignore")


class ServicesMiddlewareConfig(BaseModel):
    caching_enabled: bool = (
        os.getenv("AGENTA_SERVICES_MIDDLEWARE_CACHING_ENABLED")
        or os.getenv("AGENTA_SERVICES_MIDDLEWARE_CACHE_ENABLED")
        or "true"
    ).lower() in _TRUTHY

    model_config = ConfigDict(extra="ignore")


class ServicesConfig(BaseModel):
    code: ServicesCodeConfig = ServicesCodeConfig()
    hook: ServicesHookConfig = ServicesHookConfig()
    middleware: ServicesMiddlewareConfig = ServicesMiddlewareConfig()

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# agenta.webhooks
# ---------------------------------------------------------------------------


class WebhooksConfig(BaseModel):
    allow_insecure: bool = (
        os.getenv("AGENTA_WEBHOOKS_ALLOW_INSECURE")
        or os.getenv("AGENTA_WEBHOOK_ALLOW_INSECURE")
        or "true"
    ).lower() in _TRUTHY

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# agenta — top-level Agenta core config.
# ---------------------------------------------------------------------------


class AgentaConfig(BaseModel):
    """Agenta core configuration"""

    license: str = _LICENSE

    web_url: str = os.getenv("AGENTA_WEB_URL") or "http://localhost"
    services_url: str = os.getenv("AGENTA_SERVICES_URL") or "http://localhost/services"
    api_url: str = os.getenv("AGENTA_API_URL") or "http://localhost/api"
    api_internal_url: str | None = os.getenv("AGENTA_API_INTERNAL_URL")

    auth_key: str = os.getenv("AGENTA_AUTH_KEY") or "replace-me"
    crypt_key: str = os.getenv("AGENTA_CRYPT_KEY") or "replace-me"

    access: AccessConfig = AccessConfig()
    ai_services: AIServicesConfig = AIServicesConfig()
    api: ApiConfig = ApiConfig()
    billing: BillingConfig = BillingConfig()
    extras: ExtrasConfig = ExtrasConfig()
    logging: LoggingConfig = LoggingConfig()
    otlp: OTLPConfig = OTLPConfig()
    services: ServicesConfig = ServicesConfig()
    webhooks: WebhooksConfig = WebhooksConfig()

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# alembic
# ---------------------------------------------------------------------------


class AlembicConfig(BaseModel):
    """Database migration configuration"""

    auto_migrations: bool = (
        os.getenv("ALEMBIC_AUTO_MIGRATIONS")
        or os.getenv("AGENTA_AUTO_MIGRATIONS")
        or "true"
    ).lower() in _TRUTHY

    cfg_path_core: str = os.getenv("ALEMBIC_CFG_PATH_CORE") or (
        f"/app/{_LICENSE}/databases/postgres/migrations/core/alembic.ini"
    )
    cfg_path_tracing: str = os.getenv("ALEMBIC_CFG_PATH_TRACING") or (
        f"/app/{_LICENSE}/databases/postgres/migrations/tracing/alembic.ini"
    )

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# cloudflare.turnstile
# ---------------------------------------------------------------------------


class CloudflareTurnstileConfig(BaseModel):
    site_key: str | None = os.getenv("CLOUDFLARE_TURNSTILE_SITE_KEY")
    secret_key: str | None = os.getenv("CLOUDFLARE_TURNSTILE_SECRET_KEY")
    allowed_hostnames_raw: str = (
        os.getenv("CLOUDFLARE_TURNSTILE_ALLOWED_HOSTNAMES") or ""
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Turnstile enabled if both site and secret keys are configured."""
        return bool(self.site_key and self.secret_key)

    @property
    def allowed_hostnames(self) -> set[str]:
        """Expected hostnames for successful Turnstile verifications."""
        configured_hostnames = {
            hostname.strip().lower()
            for hostname in self.allowed_hostnames_raw.split(",")
            if hostname.strip()
        }
        if configured_hostnames:
            return configured_hostnames

        derived_hostnames = set()
        for candidate_url in (env.agenta.web_url, env.agenta.api_url):
            try:
                parsed = urlparse(
                    candidate_url
                    if "://" in candidate_url
                    else f"https://{candidate_url}"
                )
            except Exception:
                continue

            hostname = (parsed.hostname or "").strip().lower()
            if hostname and hostname not in {"localhost", "127.0.0.1", "::1"}:
                derived_hostnames.add(hostname)

        return derived_hostnames


class CloudflareConfig(BaseModel):
    turnstile: CloudflareTurnstileConfig = CloudflareTurnstileConfig()

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# composio
# ---------------------------------------------------------------------------


class ComposioConfig(BaseModel):
    """Composio integration configuration"""

    api_key: str | None = os.getenv("COMPOSIO_API_KEY")
    api_url: str = os.getenv("COMPOSIO_API_URL", "https://backend.composio.dev/api/v3")

    @property
    def enabled(self) -> bool:
        """Composio enabled if API key is present"""
        return bool(self.api_key)

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# crisp
# ---------------------------------------------------------------------------


class CrispConfig(BaseModel):
    """Crisp Chat configuration"""

    website_id: str | None = os.getenv("CRISP_WEBSITE_ID")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Crisp enabled if website ID present"""
        return bool(self.website_id)


# ---------------------------------------------------------------------------
# daytona
# ---------------------------------------------------------------------------


class DaytonaConfig(BaseModel):
    api_key: str | None = os.getenv("DAYTONA_API_KEY")
    api_url: str | None = os.getenv("DAYTONA_API_URL")
    snapshot: str | None = os.getenv("DAYTONA_SNAPSHOT")
    target: str | None = os.getenv("DAYTONA_TARGET")

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# docker
# ---------------------------------------------------------------------------


class DockerConfig(BaseModel):
    """Docker runtime configuration"""

    network_mode: str = os.getenv("DOCKER_NETWORK_MODE") or "bridge"

    model_config = ConfigDict(extra="ignore")


# ---------------------------------------------------------------------------
# identity — OIDC providers grouped by vendor.
# ---------------------------------------------------------------------------


class IdentityAppleConfig(BaseModel):
    client_id: str | None = os.getenv("APPLE_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("APPLE_OAUTH_CLIENT_SECRET")
    key_id: str | None = os.getenv("APPLE_KEY_ID")
    private_key: str | None = os.getenv("APPLE_PRIVATE_KEY")
    team_id: str | None = os.getenv("APPLE_TEAM_ID")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(
            self.client_id
            and (
                self.client_secret
                or (self.key_id and self.team_id and self.private_key)
            )
        )


class IdentityAzureADConfig(BaseModel):
    client_id: str | None = os.getenv("AZURE_AD_OAUTH_CLIENT_ID") or os.getenv(
        "ACTIVE_DIRECTORY_OAUTH_CLIENT_ID"
    )
    client_secret: str | None = os.getenv("AZURE_AD_OAUTH_CLIENT_SECRET") or os.getenv(
        "ACTIVE_DIRECTORY_OAUTH_CLIENT_SECRET"
    )
    directory_id: str | None = os.getenv("AZURE_AD_DIRECTORY_ID") or os.getenv(
        "ACTIVE_DIRECTORY_DIRECTORY_ID"
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret and self.directory_id)


class IdentityBitbucketConfig(BaseModel):
    client_id: str | None = os.getenv("BITBUCKET_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("BITBUCKET_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityBoxySamlConfig(BaseModel):
    client_id: str | None = os.getenv("BOXY_SAML_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("BOXY_SAML_OAUTH_CLIENT_SECRET")
    url: str | None = os.getenv("BOXY_SAML_URL")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret and self.url)


class IdentityDiscordConfig(BaseModel):
    client_id: str | None = os.getenv("DISCORD_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("DISCORD_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityFacebookConfig(BaseModel):
    client_id: str | None = os.getenv("FACEBOOK_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("FACEBOOK_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityGithubConfig(BaseModel):
    client_id: str | None = os.getenv("GITHUB_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("GITHUB_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityGitlabConfig(BaseModel):
    base_url: str | None = os.getenv("GITLAB_BASE_URL")
    client_id: str | None = os.getenv("GITLAB_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("GITLAB_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityGoogleConfig(BaseModel):
    client_id: str | None = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityGoogleWorkspacesConfig(BaseModel):
    client_id: str | None = os.getenv("GOOGLE_WORKSPACES_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("GOOGLE_WORKSPACES_OAUTH_CLIENT_SECRET")
    hd: str | None = os.getenv("GOOGLE_WORKSPACES_HD")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityLinkedinConfig(BaseModel):
    client_id: str | None = os.getenv("LINKEDIN_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("LINKEDIN_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityOktaConfig(BaseModel):
    client_id: str | None = os.getenv("OKTA_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("OKTA_OAUTH_CLIENT_SECRET")
    domain: str | None = os.getenv("OKTA_DOMAIN")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret and self.domain)


class IdentityTwitterConfig(BaseModel):
    client_id: str | None = os.getenv("TWITTER_OAUTH_CLIENT_ID")
    client_secret: str | None = os.getenv("TWITTER_OAUTH_CLIENT_SECRET")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        return bool(self.client_id and self.client_secret)


class IdentityConfig(BaseModel):
    apple: IdentityAppleConfig = IdentityAppleConfig()
    azure_ad: IdentityAzureADConfig = IdentityAzureADConfig()
    bitbucket: IdentityBitbucketConfig = IdentityBitbucketConfig()
    boxy_saml: IdentityBoxySamlConfig = IdentityBoxySamlConfig()
    discord: IdentityDiscordConfig = IdentityDiscordConfig()
    facebook: IdentityFacebookConfig = IdentityFacebookConfig()
    github: IdentityGithubConfig = IdentityGithubConfig()
    gitlab: IdentityGitlabConfig = IdentityGitlabConfig()
    google: IdentityGoogleConfig = IdentityGoogleConfig()
    google_workspaces: IdentityGoogleWorkspacesConfig = IdentityGoogleWorkspacesConfig()
    linkedin: IdentityLinkedinConfig = IdentityLinkedinConfig()
    okta: IdentityOktaConfig = IdentityOktaConfig()
    twitter: IdentityTwitterConfig = IdentityTwitterConfig()

    model_config = ConfigDict(extra="ignore")

    @property
    def any_oidc_enabled(self) -> bool:
        return (
            self.apple.enabled
            or self.azure_ad.enabled
            or self.bitbucket.enabled
            or self.boxy_saml.enabled
            or self.discord.enabled
            or self.facebook.enabled
            or self.github.enabled
            or self.gitlab.enabled
            or self.google.enabled
            or self.google_workspaces.enabled
            or self.linkedin.enabled
            or self.okta.enabled
            or self.twitter.enabled
        )


# ---------------------------------------------------------------------------
# llm — provider API keys (top-level by vendor).
# ---------------------------------------------------------------------------


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
    minimax: str = os.getenv("MINIMAX_API_KEY", "")

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
                "minimax",
            ]
            if getattr(self, name)
        ]


# ---------------------------------------------------------------------------
# loops
# ---------------------------------------------------------------------------


class LoopsConfig(BaseModel):
    """Loops email marketing configuration"""

    api_key: str | None = os.getenv("LOOPS_API_KEY")

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Loops enabled if API key present"""
        return bool(self.api_key)


# ---------------------------------------------------------------------------
# newrelic
# ---------------------------------------------------------------------------


class NewRelicConfig(BaseModel):
    """New Relic monitoring configuration"""

    license_key: str | None = (
        os.getenv("NEWRELIC_LICENSE_KEY")
        or os.getenv("NEW_RELIC_LICENSE_KEY")
        or os.getenv("NRIA_LICENSE_KEY")
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """New Relic enabled if license key present"""
        return bool(self.license_key)


# ---------------------------------------------------------------------------
# postgres
# ---------------------------------------------------------------------------


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

    user: str = os.getenv("POSTGRES_USER") or "username"
    password: str = os.getenv("POSTGRES_PASSWORD") or "password"
    port: int = int(os.getenv("POSTGRES_PORT") or "5432")

    # Stable signed-64-bit advisory-lock key for this deployment. We mix
    # AGENTA_AUTH_KEY with the core Postgres URI so two deployments that
    # both forget to set AGENTA_AUTH_KEY (and thus share the literal
    # "replace-me" fallback) still get distinct keys as long as they point
    # at different databases.
    advisory_lock: int = int.from_bytes(
        hashlib.blake2b(
            b"|".join(
                (
                    (os.getenv("AGENTA_AUTH_KEY") or "replace-me").encode(),
                    (
                        os.getenv("POSTGRES_URI_CORE")
                        or f"postgresql+asyncpg://username:password@postgres:5432/agenta_{_LICENSE}_core"
                    ).encode(),
                )
            ),
            digest_size=8,
        ).digest(),
        "big",
        signed=True,
    )

    model_config = ConfigDict(extra="ignore")

    # Backwards-compat property for any code reading `username` instead of `user`.
    @property
    def username(self) -> str:
        return self.user


# ---------------------------------------------------------------------------
# posthog
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# redis
# ---------------------------------------------------------------------------


class RedisConfig(BaseModel):
    """Redis/Valkey configuration with precedence-based URI resolution"""

    uri: str | None = os.getenv("REDIS_URI")

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


# ---------------------------------------------------------------------------
# sendgrid
# ---------------------------------------------------------------------------


class SendgridConfig(BaseModel):
    """SendGrid Email configuration"""

    api_key: str | None = os.getenv("SENDGRID_API_KEY")
    from_address: str | None = (
        os.getenv("SENDGRID_FROM_ADDRESS")
        or os.getenv("AGENTA_AUTHN_EMAIL_FROM")
        or os.getenv("AGENTA_SEND_EMAIL_FROM_ADDRESS")
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """SendGrid enabled only if API key and from address are present"""
        return bool(self.api_key and self.from_address)


# ---------------------------------------------------------------------------
# stripe
# ---------------------------------------------------------------------------


class StripeConfig(BaseModel):
    """Stripe Billing configuration"""

    api_key: str | None = os.getenv("STRIPE_API_KEY")
    webhook_secret: str | None = os.getenv("STRIPE_WEBHOOK_SECRET")
    webhook_target: str | None = (
        os.getenv("STRIPE_WEBHOOK_TARGET") or os.getenv("STRIPE_TARGET") or MAC_ADDRESS
    )

    model_config = ConfigDict(extra="ignore")

    @property
    def enabled(self) -> bool:
        """Stripe enabled if API key present"""
        return bool(self.api_key)


# ---------------------------------------------------------------------------
# supertokens
# ---------------------------------------------------------------------------


class SuperTokensConfig(BaseModel):
    """SuperTokens provider configuration"""

    api_key: str | None = os.getenv("SUPERTOKENS_API_KEY")
    application: str = os.getenv("SUPERTOKENS_APPLICATION") or "default"

    # ---------------------------------------------------------------------------
    # Password policy
    # ---------------------------------------------------------------------------
    password_max_length: int | None = (
        int(os.getenv("SUPERTOKENS_PASSWORD_MAX_LENGTH"))
        if os.getenv("SUPERTOKENS_PASSWORD_MAX_LENGTH")
        else None
    )
    password_min_length: int = int(os.getenv("SUPERTOKENS_PASSWORD_MIN_LENGTH") or "8")
    password_policy: str = os.getenv("SUPERTOKENS_PASSWORD_POLICY") or "strong"
    password_regex: str | None = os.getenv("SUPERTOKENS_PASSWORD_REGEX") or None

    tenant: str = os.getenv("SUPERTOKENS_TENANT") or "tenant"

    uri_core: str = (
        os.getenv("SUPERTOKENS_URI_CORE")
        or os.getenv("SUPERTOKENS_CONNECTION_URI")
        or "http://supertokens:3567"
    )

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


# ---------------------------------------------------------------------------
# Auth — derived flags. Kept as a convenience facade reading from
# identity.* (OIDC) and agenta.access.email_disabled (email).
# ---------------------------------------------------------------------------


class AuthFacade(BaseModel):
    """Derived auth flags.

    This is a thin facade. The source of truth lives in:
      - `env.agenta.access.email_disabled` (email kill switch)
      - `env.identity.<provider>.enabled` (OIDC providers)
      - `env.cloudflare.turnstile.*` (captcha)
    """

    model_config = ConfigDict(extra="ignore")

    @property
    def email_method(self) -> str:
        """Returns email auth method: 'password', 'otp', or '' (disabled)"""
        if env.agenta.access.email_disabled:
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
        return self.email_method != ""

    @property
    def oidc_enabled(self) -> bool:
        return env.identity.any_oidc_enabled

    @property
    def any_enabled(self) -> bool:
        return self.email_enabled or self.oidc_enabled

    def validate_config(self) -> None:
        if not self.any_enabled:
            raise ValueError(
                "At least one authentication method must be configured:\n"
                "  - AGENTA_ACCESS_EMAIL_DISABLED must be false (or unset) for email auth\n"
                "  - Any supported OAuth provider credentials, e.g.\n"
                "    GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET\n"
                "    GITHUB_OAUTH_CLIENT_ID + GITHUB_OAUTH_CLIENT_SECRET\n"
            )


# ---------------------------------------------------------------------------
# EnvironSettings — the singleton container.
# ---------------------------------------------------------------------------


class EnvironSettings(BaseModel):
    """
    Main environment settings container with nested Pydantic models.

    The shape mirrors the canonical mapping documented at
    https://docs.agenta.ai/self-host/configuration — env var name,
    env.py attribute path, and helm values.yaml path all encode the
    same nesting.
    """

    agenta: AgentaConfig = AgentaConfig()
    alembic: AlembicConfig = AlembicConfig()
    auth: AuthFacade = AuthFacade()
    cloudflare: CloudflareConfig = CloudflareConfig()
    composio: ComposioConfig = ComposioConfig()
    crisp: CrispConfig = CrispConfig()
    daytona: DaytonaConfig = DaytonaConfig()
    docker: DockerConfig = DockerConfig()
    identity: IdentityConfig = IdentityConfig()
    llm: LLMConfig = LLMConfig()
    loops: LoopsConfig = LoopsConfig()
    newrelic: NewRelicConfig = NewRelicConfig()
    postgres: PostgresConfig = PostgresConfig()
    posthog: PostHogConfig = PostHogConfig()
    redis: RedisConfig = RedisConfig()
    sendgrid: SendgridConfig = SendgridConfig()
    stripe: StripeConfig = StripeConfig()
    supertokens: SuperTokensConfig = SuperTokensConfig()

    model_config = ConfigDict(extra="ignore")


# Create singleton global env instance
env = EnvironSettings()
