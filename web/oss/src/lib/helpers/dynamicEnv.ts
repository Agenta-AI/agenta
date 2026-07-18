export const processEnv = {
    NEXT_PUBLIC_AGENTA_LICENSE: process.env.NEXT_PUBLIC_AGENTA_LICENSE,
    NEXT_PUBLIC_AGENTA_WEB_URL: process.env.NEXT_PUBLIC_AGENTA_WEB_URL,
    NEXT_PUBLIC_AGENTA_API_URL: process.env.NEXT_PUBLIC_AGENTA_API_URL,
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
    NEXT_PUBLIC_CRISP_WEBSITE_ID: process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID,
    // Feature flag for the agent chat streaming slice (contract v1) page. On by default; set to
    // "false" to disable.
    NEXT_PUBLIC_AGENT_CHAT_SLICE: process.env.NEXT_PUBLIC_AGENT_CHAT_SLICE,
    // Agent-home template behavior: off by default (config-definition drawer flow). Set to "true" to
    // instead skip the drawer and open the playground seeded with the template's builder instruction
    // (Mahmoud's agent-builder flow). On by default since the build-kit overlay ships as the __ag__build_kit static workflow
    // (docs/design/build-kit-overlay-delivery/); that flow needs the build kit, which the new creation
    // path can't deliver yet.
    NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER: process.env.NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER,
    // Playground-native onboarding: on by default, the project-scoped `/playground` route lands on an
    // ephemeral agent (templates + "what do you want to build?" composer) and commits it in place on
    // send — no redirect. Set to "false" to keep the agent-home + redirect onboarding.
    NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING: process.env.NEXT_PUBLIC_AGENT_PLAYGROUND_ONBOARDING,
    // Agent chat Stop button: when "true", clicking Stop also kills the session (tears down the
    // live sandbox + halts server-side compute) instead of only aborting the client stream. Off by
    // default — kill ends the current run + cancels pending approvals; durable state and the
    // object-store-backed cwd/agent mounts survive and remount on resume (#5197 merged).
    NEXT_PUBLIC_AGENT_CHAT_STOP_KILLS_SESSION:
        process.env.NEXT_PUBLIC_AGENT_CHAT_STOP_KILLS_SESSION,
    // Agent chat message virtualization (react-virtuoso spike): when "true", the playground settings
    // dropdown exposes the Virtualization section and the chat can window its settled history. Gated
    // so it's off everywhere unless explicitly enabled while the approach is evaluated.
    NEXT_PUBLIC_AGENT_CHAT_VIRTUALIZATION: process.env.NEXT_PUBLIC_AGENT_CHAT_VIRTUALIZATION,
    // Template-strip onboarding: when "true", template presentation on Home, playground
    // onboarding, and every agent's empty chat becomes one shared always-visible strip
    // (card click fills the composer + chip instead of creating/opening a drawer). Unset/
    // false keeps the current three separate template UIs untouched.
    NEXT_PUBLIC_AGENT_TEMPLATE_STRIP: process.env.NEXT_PUBLIC_AGENT_TEMPLATE_STRIP,
    NEXT_PUBLIC_AGENTA_AUTHN_EMAIL: process.env.NEXT_PUBLIC_AGENTA_AUTHN_EMAIL,
    NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_WORKSPACES_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_WORKSPACES_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_FACEBOOK_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_FACEBOOK_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_APPLE_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_APPLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_DISCORD_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_DISCORD_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_TWITTER_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_TWITTER_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_GITLAB_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_GITLAB_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_BITBUCKET_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_BITBUCKET_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_LINKEDIN_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_LINKEDIN_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_OKTA_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_OKTA_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_AZURE_AD_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_AZURE_AD_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_BOXY_SAML_OAUTH_CLIENT_ID:
        process.env.NEXT_PUBLIC_AGENTA_AUTH_BOXY_SAML_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED: process.env.NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED,
    NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED: process.env.NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED,
    NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY:
        process.env.NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED: process.env.NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED,
    NEXT_PUBLIC_AGENTA_EMAIL_DELIVERY_ENABLED:
        process.env.NEXT_PUBLIC_AGENTA_EMAIL_DELIVERY_ENABLED,
    NEXT_PUBLIC_AGENTA_TOOLS_ENABLED: process.env.NEXT_PUBLIC_AGENTA_TOOLS_ENABLED,
    NEXT_PUBLIC_AGENTA_BILLING_ENABLED: process.env.NEXT_PUBLIC_AGENTA_BILLING_ENABLED,
    NEXT_PUBLIC_AGENTA_SANDBOX_LOCAL_ENABLED: process.env.NEXT_PUBLIC_AGENTA_SANDBOX_LOCAL_ENABLED,
    NEXT_PUBLIC_AGENTA_ENABLED_SANDBOX_PROVIDERS:
        process.env.NEXT_PUBLIC_AGENTA_ENABLED_SANDBOX_PROVIDERS,
    NEXT_PUBLIC_SUPERTOKENS_PASSWORD_MIN_LENGTH:
        process.env.NEXT_PUBLIC_SUPERTOKENS_PASSWORD_MIN_LENGTH,
    NEXT_PUBLIC_SUPERTOKENS_PASSWORD_MAX_LENGTH:
        process.env.NEXT_PUBLIC_SUPERTOKENS_PASSWORD_MAX_LENGTH,
    NEXT_PUBLIC_SUPERTOKENS_PASSWORD_POLICY: process.env.NEXT_PUBLIC_SUPERTOKENS_PASSWORD_POLICY,
    NEXT_PUBLIC_SUPERTOKENS_PASSWORD_REGEX: process.env.NEXT_PUBLIC_SUPERTOKENS_PASSWORD_REGEX,
    NEXT_PUBLIC_AGENTA_DISPLAY_FONT_URL: process.env.NEXT_PUBLIC_AGENTA_DISPLAY_FONT_URL,
    NEXT_PUBLIC_LOG_APP_ATOMS: "true",
    // process.env.NEXT_PUBLIC_LOG_APP_ATOMS,
    NEXT_PUBLIC_ENABLE_ATOM_LOGS: "true",
    // process.env.NEXT_PUBLIC_ENABLE_ATOM_LOGS,
}

const normalizeBoolean = (value: string | undefined) => {
    return (value || "").toLowerCase() === "true"
}

// Mirror the API `_TRUTHY` rule: unset defaults to enabled, only truthy values enable.
const SANDBOX_LOCAL_TRUTHY = new Set(["true", "1", "t", "y", "yes", "on", "enable", "enabled"])

export const isSandboxLocalEnabled = () => {
    const raw = getEnv("NEXT_PUBLIC_AGENTA_SANDBOX_LOCAL_ENABLED") || "true"
    return SANDBOX_LOCAL_TRUTHY.has(raw.trim().toLowerCase())
}

// The sandbox providers this deployment enabled, normalized to lowercase ids. Unset/empty
// falls back to ["local"] so the picker never hides every option.
export const getEnabledSandboxProviders = (): string[] => {
    const providers = getEnv("NEXT_PUBLIC_AGENTA_ENABLED_SANDBOX_PROVIDERS")
        .split(",")
        .map((provider) => provider.trim().toLowerCase())
        .filter(Boolean)
    return providers.length > 0 ? providers : ["local"]
}

// Optional deploy-time URL for a woff2 display font used on the auth headlines.
// Unset (the default everywhere) means headlines render in Inter.
export const getDisplayFontUrl = (): string => getEnv("NEXT_PUBLIC_AGENTA_DISPLAY_FONT_URL").trim()

export const getEffectiveAuthConfig = () => {
    const googleOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID")
    const googleWorkspacesOAuthClientId = getEnv(
        "NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_WORKSPACES_OAUTH_CLIENT_ID",
    )
    const githubOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID")
    const facebookOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_FACEBOOK_OAUTH_CLIENT_ID")
    const appleOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_APPLE_OAUTH_CLIENT_ID")
    const discordOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_DISCORD_OAUTH_CLIENT_ID")
    const twitterOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_TWITTER_OAUTH_CLIENT_ID")
    const gitlabOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_GITLAB_OAUTH_CLIENT_ID")
    const bitbucketOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_BITBUCKET_OAUTH_CLIENT_ID")
    const linkedinOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_LINKEDIN_OAUTH_CLIENT_ID")
    const oktaOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_OKTA_OAUTH_CLIENT_ID")
    const azureAdOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_AZURE_AD_OAUTH_CLIENT_ID")
    const boxySamlOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_BOXY_SAML_OAUTH_CLIENT_ID")
    const oidcProviders = [
        {id: "google", clientId: googleOAuthClientId},
        {id: "google-workspaces", clientId: googleWorkspacesOAuthClientId},
        {id: "github", clientId: githubOAuthClientId},
        {id: "facebook", clientId: facebookOAuthClientId},
        {id: "apple", clientId: appleOAuthClientId},
        {id: "discord", clientId: discordOAuthClientId},
        {id: "twitter", clientId: twitterOAuthClientId},
        {id: "gitlab", clientId: gitlabOAuthClientId},
        {id: "bitbucket", clientId: bitbucketOAuthClientId},
        {id: "linkedin", clientId: linkedinOAuthClientId},
        {id: "okta", clientId: oktaOAuthClientId},
        {id: "azure-ad", clientId: azureAdOAuthClientId},
        {id: "boxy-saml", clientId: boxySamlOAuthClientId},
    ].filter((provider) => Boolean(provider.clientId))
    const authOidcEnabled =
        normalizeBoolean(getEnv("NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED")) || oidcProviders.length > 0
    const authnEmailRaw = getEnv("NEXT_PUBLIC_AGENTA_AUTHN_EMAIL")
    const authnEmail = authnEmailRaw || (authOidcEnabled ? "" : "password")
    const authEmailEnabled =
        normalizeBoolean(getEnv("NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED")) ||
        authnEmail === "password" ||
        authnEmail === "otp"

    return {
        authnEmail,
        authEmailEnabled,
        authOidcEnabled,
        googleOAuthClientId,
        googleWorkspacesOAuthClientId,
        githubOAuthClientId,
        facebookOAuthClientId,
        appleOAuthClientId,
        discordOAuthClientId,
        twitterOAuthClientId,
        gitlabOAuthClientId,
        bitbucketOAuthClientId,
        linkedinOAuthClientId,
        oktaOAuthClientId,
        azureAdOAuthClientId,
        boxySamlOAuthClientId,
        oidcProviders,
    }
}

export const getEnv = (envKey: string) => {
    let envSource = ""
    // Check for window.__env if in browser
    if (
        typeof window !== "undefined" &&
        Object.keys((window as any).__env || {}).length > 0 &&
        (window as any).__env[envKey]
    ) {
        envSource = (window as any).__env[envKey]
    } else {
        envSource = processEnv[envKey as keyof typeof processEnv] || ""
    }

    return envSource
}
