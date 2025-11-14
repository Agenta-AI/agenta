import os

from pydantic import BaseModel


_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}


class EnvironSettings(BaseModel):
    # AGENTA-SPECIFIC (REQUIRED)
    AGENTA_LICENSE: str = "ee" if os.getenv("AGENTA_LICENSE") == "ee" else "oss"
    AGENTA_API_URL: str = os.getenv("AGENTA_API_URL") or "http://localhost/api"
    AGENTA_WEB_URL: str = os.getenv("AGENTA_WEB_URL") or ""
    AGENTA_SERVICES_URL: str = os.getenv("AGENTA_SERVICES_URL") or ""
    AGENTA_AUTH_KEY: str = os.getenv("AGENTA_AUTH_KEY") or ""
    AGENTA_CRYPT_KEY: str = os.getenv("AGENTA_CRYPT_KEY") or ""

    # AGENTA-SPECIFIC (OPTIONAL)
    AGENTA_AUTO_MIGRATIONS: bool = (
        os.getenv("AGENTA_AUTO_MIGRATIONS") or "true"
    ).lower() in _TRUTHY
    AGENTA_PRICING: str = os.getenv("AGENTA_PRICING") or "{}"
    AGENTA_DEMOS: str = os.getenv("AGENTA_DEMOS") or ""
    AGENTA_RUNTIME_PREFIX: str = os.getenv("AGENTA_RUNTIME_PREFIX") or ""

    # SUPERTOKENS (REQUIRED)
    SUPERTOKENS_CONNECTION_URI: str = os.getenv("SUPERTOKENS_CONNECTION_URI") or ""
    SUPERTOKENS_API_KEY: str = os.getenv("SUPERTOKENS_API_KEY") or ""

    # DATABASE (REQUIRED)
    POSTGRES_URI_CORE: str = os.getenv("POSTGRES_URI_CORE") or ""
    POSTGRES_URI_TRACING: str = os.getenv("POSTGRES_URI_TRACING") or ""
    POSTGRES_URI_SUPERTOKENS: str = os.getenv("POSTGRES_URI_SUPERTOKENS") or ""
    ALEMBIC_CFG_PATH_CORE: str = os.getenv("ALEMBIC_CFG_PATH_CORE") or ""
    ALEMBIC_CFG_PATH_TRACING: str = os.getenv("ALEMBIC_CFG_PATH_TRACING") or ""

    # CLICKHOUSE (OPTIONAL)
    CLICKHOUSE_HOST: str = os.getenv("CLICKHOUSE_HOST") or "clickhouse"
    CLICKHOUSE_PORT: int = int(os.getenv("CLICKHOUSE_PORT") or "9000")
    CLICKHOUSE_USER: str = os.getenv("CLICKHOUSE_USER") or "default"
    CLICKHOUSE_PASSWORD: str = os.getenv("CLICKHOUSE_PASSWORD") or ""
    CLICKHOUSE_DATABASE: str = os.getenv("CLICKHOUSE_DATABASE") or "agenta_oss_tracing"
    USE_CLICKHOUSE: bool = (os.getenv("USE_CLICKHOUSE") or "false").lower() in _TRUTHY

    # TASK QUEUE / BROKER (REQUIRED)
    REDIS_URL: str = os.getenv("REDIS_URL") or ""
    RABBITMQ_DEFAULT_USER: str = os.getenv("RABBITMQ_DEFAULT_USER") or "guest"
    RABBITMQ_DEFAULT_PASS: str = os.getenv("RABBITMQ_DEFAULT_PASS") or "guest"
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL") or ""
    CELERY_RESULT_BACKEND: str = os.getenv("CELERY_RESULT_BACKEND") or ""

    # CACHE (REQUIRED)
    REDIS_CACHE_HOST: str = os.getenv("REDIS_CACHE_HOST") or "cache"
    REDIS_CACHE_PORT: int = int(os.getenv("REDIS_CACHE_PORT") or "6378")

    # Mail
    SENDGRID_API_KEY: str = os.getenv("SENDGRID_API_KEY") or ""
    AGENTA_SEND_EMAIL_FROM_ADDRESS: str = (
        os.getenv("AGENTA_SEND_EMAIL_FROM_ADDRESS") or ""
    )

    # Optional integrations
    POSTHOG_API_KEY: str = os.getenv("POSTHOG_API_KEY") or ""
    POSTHOG_HOST: str = os.getenv("POSTHOG_HOST", "https://app.posthog.com") or ""
    GOOGLE_OAUTH_CLIENT_ID: str = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "") or ""
    GOOGLE_OAUTH_CLIENT_SECRET: str = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "") or ""
    GITHUB_OAUTH_CLIENT_ID: str = os.getenv("GITHUB_OAUTH_CLIENT_ID", "") or ""
    GITHUB_OAUTH_CLIENT_SECRET: str = os.getenv("GITHUB_OAUTH_CLIENT_SECRET", "") or ""
    NEW_RELIC_LICENSE_KEY: str = os.getenv("NEW_RELIC_LICENSE_KEY", "") or ""
    NRIA_LICENSE_KEY: str = os.getenv("NRIA_LICENSE_KEY", "") or ""
    LOOPS_API_KEY: str = os.getenv("LOOPS_API_KEY", "") or ""
    CRISP_WEBSITE_ID: str = os.getenv("CRISP_WEBSITE_ID", "") or ""
    STRIPE_API_KEY: str = os.getenv("STRIPE_API_KEY", "") or ""
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "") or ""

    # LLM Providers (optional)
    ALEPHALPHA_API_KEY: str = os.getenv("ALEPHALPHA_API_KEY", "") or ""
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "") or ""
    ANYSCALE_API_KEY: str = os.getenv("ANYSCALE_API_KEY", "") or ""
    COHERE_API_KEY: str = os.getenv("COHERE_API_KEY", "") or ""
    DEEPINFRA_API_KEY: str = os.getenv("DEEPINFRA_API_KEY", "") or ""
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "") or ""
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "") or ""
    MISTRAL_API_KEY: str = os.getenv("MISTRAL_API_KEY", "") or ""
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "") or ""
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "") or ""
    PERPLEXITYAI_API_KEY: str = os.getenv("PERPLEXITYAI_API_KEY", "") or ""
    TOGETHERAI_API_KEY: str = os.getenv("TOGETHERAI_API_KEY", "") or ""

    AGENTA_BLOCKED_EMAILS: set = {
        e.strip().lower()
        for e in (os.getenv("AGENTA_BLOCKED_EMAILS") or "").split(",")
        if e.strip()
    }
    AGENTA_BLOCKED_DOMAINS: set = {
        e.strip().lower()
        for e in (os.getenv("AGENTA_BLOCKED_DOMAINS") or "").split(",")
        if e.strip()
    }
    AGENTA_ALLOWED_DOMAINS: set = {
        e.strip().lower()
        for e in (os.getenv("AGENTA_ALLOWED_DOMAINS") or "").split(",")
        if e.strip()
    }

    # AGENTA-SPECIFIC (INTERNAL INFRA)
    DOCKER_NETWORK_MODE: str = os.getenv("DOCKER_NETWORK_MODE") or "bridge"

    # AGENTA-SPECIFIC (INTERNAL LOGGING)
    AGENTA_LOG_CONSOLE_ENABLED: bool = (
        os.getenv("AGENTA_LOG_CONSOLE_ENABLED") or "true"
    ) in _TRUTHY
    AGENTA_LOG_CONSOLE_LEVEL: str = (
        os.getenv("AGENTA_LOG_CONSOLE_LEVEL") or "TRACE"
    ).upper()
    AGENTA_LOG_OTLP_ENABLED: bool = (
        os.getenv("AGENTA_LOG_OTLP_ENABLED") or "false"
    ) in _TRUTHY
    AGENTA_LOG_OTLP_LEVEL: str = (os.getenv("AGENTA_LOG_OTLP_LEVEL") or "INFO").upper()
    AGENTA_LOG_FILE_ENABLED: bool = (
        os.getenv("AGENTA_LOG_FILE_ENABLED") or "true"
    ) in _TRUTHY
    AGENTA_LOG_FILE_LEVEL: str = (
        os.getenv("AGENTA_LOG_FILE_LEVEL") or "WARNING"
    ).upper()
    AGENTA_LOG_FILE_BASE: str = os.getenv("AGENTA_LOG_FILE_PATH") or "error"

    # AGENTA-SPECIFIC (OTLP)
    AGENTA_OTLP_MAX_BATCH_BYTES: int = int(
        os.getenv("AGENTA_OTLP_MAX_BATCH_BYTES") or str(10 * 1024 * 1024)
    )


env = EnvironSettings()
