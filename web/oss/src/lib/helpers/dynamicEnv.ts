export const processEnv = {
    NEXT_PUBLIC_AGENTA_LICENSE: process.env.NEXT_PUBLIC_AGENTA_LICENSE,
    NEXT_PUBLIC_AGENTA_WEB_URL: process.env.NEXT_PUBLIC_AGENTA_WEB_URL,
    NEXT_PUBLIC_AGENTA_API_URL: process.env.NEXT_PUBLIC_AGENTA_API_URL,
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
    NEXT_PUBLIC_CRISP_WEBSITE_ID: process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID,
    NEXT_PUBLIC_AGENTA_AUTHN_EMAIL: process.env.NEXT_PUBLIC_AGENTA_AUTHN_EMAIL,
    NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_AGENTA_AUTH_GOOGLE_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID: process.env.NEXT_PUBLIC_AGENTA_AUTH_GITHUB_OAUTH_CLIENT_ID,
    NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED: process.env.NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED,
    NEXT_PUBLIC_LOG_APP_ATOMS: "true",
    // process.env.NEXT_PUBLIC_LOG_APP_ATOMS,
    NEXT_PUBLIC_ENABLE_ATOM_LOGS: "true",
    // process.env.NEXT_PUBLIC_ENABLE_ATOM_LOGS,
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
