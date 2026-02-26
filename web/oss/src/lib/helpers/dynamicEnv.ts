export const processEnv = {
    NEXT_PUBLIC_AGENTA_LICENSE: process.env.NEXT_PUBLIC_AGENTA_LICENSE,
    NEXT_PUBLIC_AGENTA_WEB_URL: process.env.NEXT_PUBLIC_AGENTA_WEB_URL,
    NEXT_PUBLIC_AGENTA_API_URL: process.env.NEXT_PUBLIC_AGENTA_API_URL,
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
    NEXT_PUBLIC_CRISP_WEBSITE_ID: process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID,
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
    NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED: process.env.NEXT_PUBLIC_AGENTA_SENDGRID_ENABLED,
    NEXT_PUBLIC_AGENTA_TOOLS_ENABLED: process.env.NEXT_PUBLIC_AGENTA_TOOLS_ENABLED,
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
