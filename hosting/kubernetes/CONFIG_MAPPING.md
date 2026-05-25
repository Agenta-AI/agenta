# Config Mapping: env var → env.py → values.yaml

Edit this file. Each row is one config knob. Leave a `?` where you want me to propose,
strike through with ~~old~~ to flag a rename, or write `DROP` to remove entirely.

| Env var | env.py path | values.yaml path |
|---|---|---|
| `AGENTA_LICENSE` | `agenta.license` | `agenta.license` |
| `AGENTA_WEB_URL` | `agenta.web_url` | `agenta.webUrl` |
| `AGENTA_SERVICES_URL` | `agenta.services_url` | `agenta.servicesUrl` |
| `AGENTA_API_URL` | `agenta.api_url` | `agenta.apiUrl` |
| `AGENTA_API_INTERNAL_URL` | `agenta.api_internal_url` | `agenta.apiInternalUrl` |
| `AGENTA_AUTH_KEY` | `agenta.auth_key` | `agenta.authKey` |
| `AGENTA_CRYPT_KEY` | `agenta.crypt_key` | `agenta.cryptKey` |
| | | |
| `AGENTA_ACCESS_ALLOWED_DOMAINS` | `agenta.access.allowed_domains` | `agenta.access.allowedDomains` |
| ~~`AGENTA_ALLOWED_DOMAINS`~~ (legacy alias) | → `agenta.access.allowed_domains` | → `agenta.access.allowedDomains` |
| `AGENTA_ACCESS_ALLOWED_OWNER_EMAILS` | `agenta.access.allowed_owner_emails` | `agenta.access.allowedOwnerEmails` |
| ~~`AGENTA_ACCESS_ALLOWED_ORGANIZATION_OWNERS`~~ (legacy alias) | → `agenta.access.allowed_owner_emails` | → `agenta.access.allowedOwnerEmails` |
| ~~`AGENTA_ACCESS_ORG_CREATION_ALLOWLIST`~~ (legacy alias) | → `agenta.access.allowed_owner_emails` | → `agenta.access.allowedOwnerEmails` |
| ~~`AGENTA_ORG_CREATION_ALLOWLIST`~~ (legacy alias) | → `agenta.access.allowed_owner_emails` | → `agenta.access.allowedOwnerEmails` |
| `AGENTA_ACCESS_BLOCKED_DOMAINS` | `agenta.access.blocked_domains` | `agenta.access.blockedDomains` |
| ~~`AGENTA_BLOCKED_DOMAINS`~~ (legacy alias) | → `agenta.access.blocked_domains` | → `agenta.access.blockedDomains` |
| `AGENTA_ACCESS_BLOCKED_EMAILS` | `agenta.access.blocked_emails` | `agenta.access.blockedEmails` |
| ~~`AGENTA_BLOCKED_EMAILS`~~ (legacy alias) | → `agenta.access.blocked_emails` | → `agenta.access.blockedEmails` |
| `AGENTA_ACCESS_DEFAULT_PLAN` | `agenta.access.default_plan` | `agenta.access.defaultPlan` |
| ~~`AGENTA_DEFAULT_PLAN`~~ (legacy alias) | → `agenta.access.default_plan` | → `agenta.access.defaultPlan` |
| `AGENTA_ACCESS_DEFAULT_PLAN_OVERLAY` | `agenta.access.default_plan_overlay` | `agenta.access.defaultPlanOverlay` |
| `AGENTA_ACCESS_EMAIL_DISABLED` | `agenta.access.email_disabled` | `agenta.access.emailDisabled` |
| ~~`SUPERTOKENS_EMAIL_DISABLED`~~ (legacy alias) | → `agenta.access.email_disabled` | → `agenta.access.emailDisabled` |
| `AGENTA_ACCESS_PLANS` | `agenta.access.plans` | `agenta.access.plans` |
| `AGENTA_ACCESS_ROLES` | `agenta.access.roles` | `agenta.access.roles` |
| `AGENTA_ACCESS_ROLES_OVERLAY` | `agenta.access.roles_overlay` | `agenta.access.rolesOverlay` |
| | | |
| `AGENTA_AI_SERVICES_API_KEY` | `agenta.ai_services.api_key` | `agenta.aiServices.apiKey` |
| `AGENTA_AI_SERVICES_API_URL` | `agenta.ai_services.api_url` | `agenta.aiServices.apiUrl` |
| `AGENTA_AI_SERVICES_ENVIRONMENT_SLUG` | `agenta.ai_services.environment_slug` | `agenta.aiServices.environmentSlug` |
| `AGENTA_AI_SERVICES_REFINE_PROMPT_KEY` | `agenta.ai_services.refine_prompt_key` | `agenta.aiServices.refinePromptKey` |
| | | |
| `AGENTA_BILLING_CATALOG` | `agenta.billing.catalog` | `agenta.billing.catalog` |
| `AGENTA_BILLING_PRICING` | `agenta.billing.pricing` | `agenta.billing.pricing` |
| ~~`AGENTA_PRICING`~~ (legacy alias) | → `agenta.billing.pricing` | → `agenta.billing.pricing` |
| ~~`STRIPE_PRICING`~~ (legacy alias) | → `agenta.billing.pricing` | → `agenta.billing.pricing` |
| | | |
| `AGENTA_API_CACHING_ENABLED` | `agenta.api.caching.enabled` | `agenta.api.caching.enabled` |
| ~~`AGENTA_CACHING_ENABLED`~~ (legacy alias) | → `agenta.api.caching.enabled` | → `agenta.api.caching.enabled` |
| ~~`AGENTA_CACHE_ENABLED`~~ (legacy alias) | → `agenta.api.caching.enabled` | → `agenta.api.caching.enabled` |
| | | |
| `AGENTA_EXTRAS_DEMOS` | `agenta.extras.demos` | `agenta.extras.demos` |
| ~~`AGENTA_DEMOS`~~ (legacy alias) | → `agenta.extras.demos` | → `agenta.extras.demos` |
| | | |
| `AGENTA_LOGGING_CONSOLE_ENABLED` | `agenta.logging.console_enabled` | `agenta.logging.consoleEnabled` |
| ~~`AGENTA_LOG_CONSOLE_ENABLED`~~ (legacy alias) | → `agenta.logging.console_enabled` | → `agenta.logging.consoleEnabled` |
| `AGENTA_LOGGING_CONSOLE_LEVEL` | `agenta.logging.console_level` | `agenta.logging.consoleLevel` |
| ~~`AGENTA_LOG_CONSOLE_LEVEL`~~ (legacy alias) | → `agenta.logging.console_level` | → `agenta.logging.consoleLevel` |
| `AGENTA_LOGGING_FILE_ENABLED` | `agenta.logging.file_enabled` | `agenta.logging.fileEnabled` |
| ~~`AGENTA_LOG_FILE_ENABLED`~~ (legacy alias) | → `agenta.logging.file_enabled` | → `agenta.logging.fileEnabled` |
| `AGENTA_LOGGING_FILE_LEVEL` | `agenta.logging.file_level` | `agenta.logging.fileLevel` |
| ~~`AGENTA_LOG_FILE_LEVEL`~~ (legacy alias) | → `agenta.logging.file_level` | → `agenta.logging.fileLevel` |
| `AGENTA_LOGGING_FILE_PATH` | `agenta.logging.file_path` | `agenta.logging.filePath` |
| ~~`AGENTA_LOG_FILE_PATH`~~ (legacy alias) | → `agenta.logging.file_path` | → `agenta.logging.filePath` |
| `AGENTA_LOGGING_OTLP_ENABLED` | `agenta.logging.otlp_enabled` | `agenta.logging.otlpEnabled` |
| ~~`AGENTA_LOG_OTLP_ENABLED`~~ (legacy alias) | → `agenta.logging.otlp_enabled` | → `agenta.logging.otlpEnabled` |
| `AGENTA_LOGGING_OTLP_LEVEL` | `agenta.logging.otlp_level` | `agenta.logging.otlpLevel` |
| ~~`AGENTA_LOG_OTLP_LEVEL`~~ (legacy alias) | → `agenta.logging.otlp_level` | → `agenta.logging.otlpLevel` |
| | | |
| `AGENTA_OTLP_MAX_BATCH_BYTES` | `agenta.otlp.max_batch_bytes` | `agenta.otlp.maxBatchBytes` |
| | | |
| `AGENTA_SERVICES_CODE_SANDBOX_RUNNER` | `agenta.services.code.sandbox_runner` | `agenta.services.code.sandboxRunner` |
| ~~`AGENTA_SERVICES_SANDBOX_RUNNER`~~ (legacy alias) | → `agenta.services.code.sandbox_runner` | → `agenta.services.code.sandboxRunner` |
| `AGENTA_SERVICES_HOOK_ALLOW_INSECURE` (read by SDK workflow-hooks; ships in pod env) | `agenta.services.hook.allow_insecure` | `agenta.services.hook.allowInsecure` |
| ~~`AGENTA_WEBHOOK_ALLOW_INSECURE`~~ (SDK legacy alias) | → `agenta.services.hook.allow_insecure` | → `agenta.services.hook.allowInsecure` |
| `AGENTA_SERVICES_MIDDLEWARE_CACHING_ENABLED` | `agenta.services.middleware.caching_enabled` | `agenta.services.middleware.cachingEnabled` |
| ~~`AGENTA_SERVICES_MIDDLEWARE_CACHE_ENABLED`~~ (legacy alias) | → `agenta.services.middleware.caching_enabled` | → `agenta.services.middleware.cachingEnabled` |
| | | |
| `AGENTA_WEBHOOKS_ALLOW_INSECURE` | `agenta.webhooks.allow_insecure` | `agenta.webhooks.allowInsecure` |
| ~~`AGENTA_WEBHOOK_ALLOW_INSECURE`~~ (legacy alias) | → `agenta.webhooks.allow_insecure` | → `agenta.webhooks.allowInsecure` |
| | | |
| `ALEMBIC_AUTO_MIGRATIONS` | `alembic.auto_migrations` | `alembic.autoMigrations` |
| ~~`AGENTA_AUTO_MIGRATIONS`~~ (legacy alias) | → `alembic.auto_migrations` | → `alembic.autoMigrations` |
| `ALEMBIC_CFG_PATH_CORE` | `alembic.cfg_path_core` | `alembic.cfgPathCore` |
| `ALEMBIC_CFG_PATH_TRACING` | `alembic.cfg_path_tracing` | `alembic.cfgPathTracing` |
| | | |
| `CLOUDFLARE_TURNSTILE_ALLOWED_HOSTNAMES` | `cloudflare.turnstile.allowed_hostnames` | `cloudflare.turnstile.allowedHostnames` |
| `CLOUDFLARE_TURNSTILE_SECRET_KEY` | `cloudflare.turnstile.secret_key` | `cloudflare.turnstile.secretKey` |
| `CLOUDFLARE_TURNSTILE_SITE_KEY` | `cloudflare.turnstile.site_key` | `cloudflare.turnstile.siteKey` |
| | | |
| `COMPOSIO_API_KEY` | `composio.api_key` | `composio.apiKey` |
| `COMPOSIO_API_URL` | `composio.api_url` | `composio.apiUrl` |
| | | |
| `CRISP_WEBSITE_ID` | `crisp.website_id` | `crisp.websiteId` |
| | | |
| `DAYTONA_API_KEY` | `daytona.api_key` | `daytona.apiKey` |
| `DAYTONA_API_URL` | `daytona.api_url` | `daytona.apiUrl` |
| `DAYTONA_SNAPSHOT` | `daytona.snapshot` | `daytona.snapshot` |
| `DAYTONA_TARGET` | `daytona.target` | `daytona.target` |
| | | |
| `DOCKER_NETWORK_MODE` | `docker.network_mode` | `docker.networkMode` |
| | | |
| `APPLE_OAUTH_CLIENT_ID` | `identity.apple.client_id` | `identity.apple.clientId` |
| `APPLE_OAUTH_CLIENT_SECRET` | `identity.apple.client_secret` | `identity.apple.clientSecret` |
| `APPLE_KEY_ID` | `identity.apple.key_id` | `identity.apple.keyId` |
| `APPLE_PRIVATE_KEY` | `identity.apple.private_key` | `identity.apple.privateKey` |
| `APPLE_TEAM_ID` | `identity.apple.team_id` | `identity.apple.teamId` |
| `AZURE_AD_OAUTH_CLIENT_ID` | `identity.azure_ad.client_id` | `identity.azureAd.clientId` |
| ~~`ACTIVE_DIRECTORY_OAUTH_CLIENT_ID`~~ (legacy alias) | → `identity.azure_ad.client_id` | → `identity.azureAd.clientId` |
| `AZURE_AD_OAUTH_CLIENT_SECRET` | `identity.azure_ad.client_secret` | `identity.azureAd.clientSecret` |
| ~~`ACTIVE_DIRECTORY_OAUTH_CLIENT_SECRET`~~ (legacy alias) | → `identity.azure_ad.client_secret` | → `identity.azureAd.clientSecret` |
| `AZURE_AD_DIRECTORY_ID` | `identity.azure_ad.directory_id` | `identity.azureAd.directoryId` |
| ~~`ACTIVE_DIRECTORY_DIRECTORY_ID`~~ (legacy alias) | → `identity.azure_ad.directory_id` | → `identity.azureAd.directoryId` |
| `BITBUCKET_OAUTH_CLIENT_ID` | `identity.bitbucket.client_id` | `identity.bitbucket.clientId` |
| `BITBUCKET_OAUTH_CLIENT_SECRET` | `identity.bitbucket.client_secret` | `identity.bitbucket.clientSecret` |
| `BOXY_SAML_OAUTH_CLIENT_ID` | `identity.boxy_saml.client_id` | `identity.boxySaml.clientId` |
| `BOXY_SAML_OAUTH_CLIENT_SECRET` | `identity.boxy_saml.client_secret` | `identity.boxySaml.clientSecret` |
| `BOXY_SAML_URL` | `identity.boxy_saml.url` | `identity.boxySaml.url` |
| `DISCORD_OAUTH_CLIENT_ID` | `identity.discord.client_id` | `identity.discord.clientId` |
| `DISCORD_OAUTH_CLIENT_SECRET` | `identity.discord.client_secret` | `identity.discord.clientSecret` |
| `FACEBOOK_OAUTH_CLIENT_ID` | `identity.facebook.client_id` | `identity.facebook.clientId` |
| `FACEBOOK_OAUTH_CLIENT_SECRET` | `identity.facebook.client_secret` | `identity.facebook.clientSecret` |
| `GITHUB_OAUTH_CLIENT_ID` | `identity.github.client_id` | `identity.github.clientId` |
| `GITHUB_OAUTH_CLIENT_SECRET` | `identity.github.client_secret` | `identity.github.clientSecret` |
| `GITLAB_OAUTH_CLIENT_ID` | `identity.gitlab.client_id` | `identity.gitlab.clientId` |
| `GITLAB_OAUTH_CLIENT_SECRET` | `identity.gitlab.client_secret` | `identity.gitlab.clientSecret` |
| `GITLAB_BASE_URL` | `identity.gitlab.base_url` | `identity.gitlab.baseUrl` |
| `GOOGLE_OAUTH_CLIENT_ID` | `identity.google.client_id` | `identity.google.clientId` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | `identity.google.client_secret` | `identity.google.clientSecret` |
| `GOOGLE_WORKSPACES_OAUTH_CLIENT_ID` | `identity.google_workspaces.client_id` | `identity.googleWorkspaces.clientId` |
| `GOOGLE_WORKSPACES_OAUTH_CLIENT_SECRET` | `identity.google_workspaces.client_secret` | `identity.googleWorkspaces.clientSecret` |
| `GOOGLE_WORKSPACES_HD` | `identity.google_workspaces.hd` | `identity.googleWorkspaces.hd` |
| `LINKEDIN_OAUTH_CLIENT_ID` | `identity.linkedin.client_id` | `identity.linkedin.clientId` |
| `LINKEDIN_OAUTH_CLIENT_SECRET` | `identity.linkedin.client_secret` | `identity.linkedin.clientSecret` |
| `OKTA_OAUTH_CLIENT_ID` | `identity.okta.client_id` | `identity.okta.clientId` |
| `OKTA_OAUTH_CLIENT_SECRET` | `identity.okta.client_secret` | `identity.okta.clientSecret` |
| `OKTA_DOMAIN` | `identity.okta.domain` | `identity.okta.domain` |
| `TWITTER_OAUTH_CLIENT_ID` | `identity.twitter.client_id` | `identity.twitter.clientId` |
| `TWITTER_OAUTH_CLIENT_SECRET` | `identity.twitter.client_secret` | `identity.twitter.clientSecret` |
| | | |
| `ALEPHALPHA_API_KEY` | `llm.alephalpha` | `llm.alephalpha` |
| `ANTHROPIC_API_KEY` | `llm.anthropic` | `llm.anthropic` |
| `ANYSCALE_API_KEY` | `llm.anyscale` | `llm.anyscale` |
| `COHERE_API_KEY` | `llm.cohere` | `llm.cohere` |
| `DEEPINFRA_API_KEY` | `llm.deepinfra` | `llm.deepinfra` |
| `GEMINI_API_KEY` | `llm.gemini` | `llm.gemini` |
| `GROQ_API_KEY` | `llm.groq` | `llm.groq` |
| `MINIMAX_API_KEY` | `llm.minimax` | `llm.minimax` |
| `MISTRAL_API_KEY` | `llm.mistral` | `llm.mistral` |
| `OPENAI_API_KEY` | `llm.openai` | `llm.openai` |
| `OPENROUTER_API_KEY` | `llm.openrouter` | `llm.openrouter` |
| `PERPLEXITYAI_API_KEY` | `llm.perplexityai` | `llm.perplexityai` |
| `TOGETHERAI_API_KEY` | `llm.togetherai` | `llm.togetherai` |
| | | |
| `LOOPS_API_KEY` | `loops.api_key` | `loops.apiKey` |
| | | |
| `NEWRELIC_LICENSE_KEY` | `newrelic.license_key` | `newrelic.licenseKey` |
| ~~`NEW_RELIC_LICENSE_KEY`~~ (legacy alias) | → `newrelic.license_key` | → `newrelic.licenseKey` |
| ~~`NRIA_LICENSE_KEY`~~ (legacy alias) | → `newrelic.license_key` | → `newrelic.licenseKey` |
| | | |
| `POSTGRES_USER` | `postgres.user` | `postgres.user` |
| `POSTGRES_PASSWORD` | `postgres.password` | `postgres.password` |
| `POSTGRES_PORT` | `postgres.port` | `postgres.port` |
| `POSTGRES_URI_CORE` | `postgres.uri_core` | `postgres.uriCore` |
| `POSTGRES_URI_SUPERTOKENS` | `postgres.uri_supertokens` | `postgres.uriSupertokens` |
| `POSTGRES_URI_TRACING` | `postgres.uri_tracing` | `postgres.uriTracing` |
| | | |
| `POSTHOG_API_KEY` | `posthog.api_key` | `posthog.apiKey` |
| `POSTHOG_API_URL` | `posthog.api_url` | `posthog.apiUrl` |
| ~~`POSTHOG_HOST`~~ (legacy alias) | → `posthog.api_url` | → `posthog.apiUrl` |
| | | |
| `REDIS_URI` | `redis.uri` | `redis.uri` |
| `REDIS_URI_DURABLE` | `redis.uri_durable` | `redis.uriDurable` |
| `REDIS_URI_VOLATILE` | `redis.uri_volatile` | `redis.uriVolatile` |
| | | |
| `SENDGRID_API_KEY` | `sendgrid.api_key` | `sendgrid.apiKey` |
| `SENDGRID_FROM_ADDRESS` | `sendgrid.from_address` | `sendgrid.fromAddress` |
| ~~`AGENTA_AUTHN_EMAIL_FROM`~~ (legacy alias) | → `sendgrid.from_address` | → `sendgrid.fromAddress` |
| ~~`AGENTA_SEND_EMAIL_FROM_ADDRESS`~~ (legacy alias) | → `sendgrid.from_address` | → `sendgrid.fromAddress` |
| | | |
| `STRIPE_API_KEY` | `stripe.api_key` | `stripe.apiKey` |
| `STRIPE_WEBHOOK_SECRET` | `stripe.webhook_secret` | `stripe.webhookSecret` |
| `STRIPE_WEBHOOK_TARGET` | `stripe.webhook_target` | `stripe.webhookTarget` |
| ~~`STRIPE_TARGET`~~ (legacy alias) | → `stripe.webhook_target` | → `stripe.webhookTarget` |
| | | |
| `SUPERTOKENS_API_KEY` | `supertokens.api_key` | `supertokens.apiKey` |
| `SUPERTOKENS_APPLICATION` | `supertokens.application` | `supertokens.application` |
| `SUPERTOKENS_PASSWORD_MAX_LENGTH` | `supertokens.password_max_length` | `supertokens.passwordMaxLength` |
| `SUPERTOKENS_PASSWORD_MIN_LENGTH` | `supertokens.password_min_length` | `supertokens.passwordMinLength` |
| `SUPERTOKENS_PASSWORD_POLICY` | `supertokens.password_policy` | `supertokens.passwordPolicy` |
| `SUPERTOKENS_PASSWORD_REGEX` | `supertokens.password_regex` | `supertokens.passwordRegex` |
| `SUPERTOKENS_TENANT` | `supertokens.tenant` | `supertokens.tenant` |
| `SUPERTOKENS_URI_CORE` | `supertokens.uri_core` | `supertokens.uriCore` |
| ~~`SUPERTOKENS_CONNECTION_URI`~~ (legacy alias) | → `supertokens.uri_core` | → `supertokens.uriCore` |

## Notes

- `agenta.*` is the namespace for app-controlled config (env vars prefixed `AGENTA_*`).
- Third-party-prefixed env vars (`POSTGRES_*`, `REDIS_*`, `SUPERTOKENS_*`, `STRIPE_*`, …) cluster at top level by provider.
- `identity.*` and `llm.*` are the two exceptions: providers don't share a single env-var prefix, but they cluster by vendor.
- `~~old~~` markers flag legacy aliases — code reads new name first, falls back to the old.
- Blank rows are section separators.
