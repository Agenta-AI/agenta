export const processEnv = {
    NEXT_PUBLIC_AGENTA_LICENSE: process.env.NEXT_PUBLIC_AGENTA_LICENSE,
    NEXT_PUBLIC_AGENTA_WEB_URL: process.env.NEXT_PUBLIC_AGENTA_WEB_URL,
    NEXT_PUBLIC_AGENTA_API_URL: process.env.NEXT_PUBLIC_AGENTA_API_URL,
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
    NEXT_PUBLIC_CRISP_WEBSITE_ID: process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID,
    NEXT_PUBLIC_AGENTA_AUTHN_EMAIL: process.env.NEXT_PUBLIC_AGENTA_AUTHN_EMAIL,
    NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED: process.env.NEXT_PUBLIC_AGENTA_AUTH_EMAIL_ENABLED,
    NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED: process.env.NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED,
    NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED: process.env.NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED,
    NEXT_PUBLIC_LOG_APP_ATOMS: "true",
    // process.env.NEXT_PUBLIC_LOG_APP_ATOMS,
    NEXT_PUBLIC_ENABLE_ATOM_LOGS: "true",
    // process.env.NEXT_PUBLIC_ENABLE_ATOM_LOGS,
}

const normalizeBoolean = (value: string | undefined) => {
    return (value || "").toLowerCase() === "true"
}

export const getEffectiveAuthConfig = () => {
    const googleOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID")
    const githubOAuthClientId = getEnv("NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID")
    const authOidcEnabled =
        normalizeBoolean(getEnv("NEXT_PUBLIC_AGENTA_AUTH_OIDC_ENABLED")) ||
        Boolean(googleOAuthClientId || githubOAuthClientId)
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
        githubOAuthClientId,
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
