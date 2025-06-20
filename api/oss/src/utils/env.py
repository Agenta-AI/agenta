import os

from pydantic import BaseModel


_TRUTHY = {"true", "1", "t", "y", "yes", "on", "enable", "enabled"}


class EnvironSettings(BaseModel):
    # AGENTA-SPECIFIC (REQUIRED)
    AGENTA_LICENSE: str = "ee" if os.getenv("AGENTA_LICENSE") == "ee" else "oss"
    AGENTA_API_URL: str = os.getenv("AGENTA_API_URL", "http://localhost/api")
    AGENTA_WEB_URL: str = os.getenv("AGENTA_WEB_URL", "")
    AGENTA_SERVICES_URL: str = os.getenv("AGENTA_SERVICES_URL", "")
    AGENTA_AUTH_KEY: str = os.getenv("AGENTA_AUTH_KEY", "")
    AGENTA_CRYPT_KEY: str = os.getenv("AGENTA_CRYPT_KEY", "")

    # AGENTA-SPECIFIC (OPTIONAL)
    AGENTA_AUTO_MIGRATIONS: bool = (
        os.getenv("AGENTA_AUTO_MIGRATIONS", "true").lower() in _TRUTHY
    )
    AGENTA_PRICING: str = os.getenv("AGENTA_PRICING", "{}")
    AGENTA_DEMOS: str = os.getenv("AGENTA_DEMOS", "")
    AGENTA_RUNTIME_PREFIX: str = os.getenv("AGENTA_RUNTIME_PREFIX", "")

    # SUPERTOKENS (REQUIRED)
    SUPERTOKENS_CONNECTION_URI: str = os.getenv("SUPERTOKENS_CONNECTION_URI", "")
    SUPERTOKENS_API_KEY: str = os.getenv("SUPERTOKENS_API_KEY", "")

    # DATABASE (REQUIRED)
    POSTGRES_URI_CORE: str = os.getenv("POSTGRES_URI_CORE", "")
    POSTGRES_URI_TRACING: str = os.getenv("POSTGRES_URI_TRACING", "")
    POSTGRES_URI_SUPERTOKENS: str = os.getenv("POSTGRES_URI_SUPERTOKENS", "")
    ALEMBIC_CFG_PATH_CORE: str = os.getenv("ALEMBIC_CFG_PATH_CORE", "")
    ALEMBIC_CFG_PATH_TRACING: str = os.getenv("ALEMBIC_CFG_PATH_TRACING", "")

    # TASK QUEUE / BROKER (REQUIRED)
    REDIS_URL: str = os.getenv("REDIS_URL", "")
    RABBITMQ_DEFAULT_USER: str = os.getenv("RABBITMQ_DEFAULT_USER", "guest")
    RABBITMQ_DEFAULT_PASS: str = os.getenv("RABBITMQ_DEFAULT_PASS", "guest")
    CELERY_BROKER_URL: str = os.getenv("CELERY_BROKER_URL", "")
    CELERY_RESULT_BACKEND: str = os.getenv("CELERY_RESULT_BACKEND", "")

    # Mail
    SENDGRID_API_KEY: str = os.getenv("SENDGRID_API_KEY", "")
    AGENTA_SEND_EMAIL_FROM_ADDRESS: str = os.getenv(
        "AGENTA_SEND_EMAIL_FROM_ADDRESS", ""
    )

    # Optional integrations
    POSTHOG_API_KEY: str = os.getenv(
        "POSTHOG_API_KEY", "phc_hmVSxIjTW1REBHXgj2aw4HW9X6CXb6FzerBgP9XenC7"
    )
    POSTHOG_HOST: str = os.getenv("POSTHOG_HOST", "https://app.posthog.com")
    GOOGLE_OAUTH_CLIENT_ID: str = os.getenv("GOOGLE_OAUTH_CLIENT_ID", "")
    GOOGLE_OAUTH_CLIENT_SECRET: str = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET", "")
    GITHUB_OAUTH_CLIENT_ID: str = os.getenv("GITHUB_OAUTH_CLIENT_ID", "")
    GITHUB_OAUTH_CLIENT_SECRET: str = os.getenv("GITHUB_OAUTH_CLIENT_SECRET", "")
    NEW_RELIC_LICENSE_KEY: str = os.getenv("NEW_RELIC_LICENSE_KEY", "")
    NRIA_LICENSE_KEY: str = os.getenv("NRIA_LICENSE_KEY", "")
    LOOPS_API_KEY: str = os.getenv("LOOPS_API_KEY", "")
    CRISP_WEBSITE_ID: str = os.getenv("CRISP_WEBSITE_ID", "")
    STRIPE_API_KEY: str = os.getenv("STRIPE_API_KEY", "")
    STRIPE_WEBHOOK_SECRET: str = os.getenv("STRIPE_WEBHOOK_SECRET", "")

    # LLM Providers (optional)
    ALEPHALPHA_API_KEY: str = os.getenv("ALEPHALPHA_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    ANYSCALE_API_KEY: str = os.getenv("ANYSCALE_API_KEY", "")
    COHERE_API_KEY: str = os.getenv("COHERE_API_KEY", "")
    DEEPINFRA_API_KEY: str = os.getenv("DEEPINFRA_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    MISTRAL_API_KEY: str = os.getenv("MISTRAL_API_KEY", "")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENROUTER_API_KEY: str = os.getenv("OPENROUTER_API_KEY", "")
    PERPLEXITYAI_API_KEY: str = os.getenv("PERPLEXITYAI_API_KEY", "")
    TOGETHERAI_API_KEY: str = os.getenv("TOGETHERAI_API_KEY", "")

    AGENTA_BLOCKED_EMAILS: set = {
        e.strip().lower()
        for e in os.getenv("AGENTA_BLOCKED_EMAILS", "").split(",")
        if e.strip()
    }
    AGENTA_BLOCKED_DOMAINS: set = {
        e.strip().lower()
        for e in os.getenv("AGENTA_BLOCKED_DOMAINS", "").split(",")
        if e.strip()
    }

    # AGENTA-SPECIFIC (INTERNAL INFRA)
    DOCKER_NETWORK_MODE: str = os.getenv("DOCKER_NETWORK_MODE", "bridge")

    # AGENTA-SPECIFIC (INTERNAL LOGGING)
    AGENTA_LOG_CONSOLE_ENABLED: bool = (
        os.getenv("AGENTA_LOG_CONSOLE_ENABLED", "true") in _TRUTHY
    )
    AGENTA_LOG_CONSOLE_LEVEL: str = os.getenv(
        "AGENTA_LOG_CONSOLE_LEVEL", "TRACE"
    ).upper()
    AGENTA_LOG_OTLP_ENABLED: bool = (
        os.getenv("AGENTA_LOG_OTLP_ENABLED", "false") in _TRUTHY
    )
    AGENTA_LOG_OTLP_LEVEL: str = os.getenv("AGENTA_LOG_OTLP_LEVEL", "INFO").upper()
    AGENTA_LOG_FILE_ENABLED: bool = (
        os.getenv("AGENTA_LOG_FILE_ENABLED", "true") in _TRUTHY
    )
    AGENTA_LOG_FILE_LEVEL: str = os.getenv("AGENTA_LOG_FILE_LEVEL", "WARNING").upper()
    AGENTA_LOG_FILE_BASE: str = os.getenv("AGENTA_LOG_FILE_PATH", "error")

    # AGENTA-SPECIFIC (OTLP)
    AGENTA_OTLP_MAX_BATCH_BYTES: int = int(
        os.getenv("AGENTA_OTLP_MAX_BATCH_BYTES", str(5 * 1024 * 1024))
    )


env = EnvironSettings()
