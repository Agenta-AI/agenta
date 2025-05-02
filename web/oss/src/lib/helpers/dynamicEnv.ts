export const processEnv = {
    NEXT_PUBLIC_AGENTA_API_URL: process.env.NEXT_PUBLIC_AGENTA_API_URL,
    NEXT_PUBLIC_FF: process.env.NEXT_PUBLIC_FF,
    NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED: process.env.NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED,
    NEXT_PUBLIC_POSTHOG_API_KEY: process.env.NEXT_PUBLIC_POSTHOG_API_KEY,
    NEXT_PUBLIC_WEBSITE_URL: process.env.NEXT_PUBLIC_WEBSITE_URL,
}

export const getEnv = (envKey: string) => {
    let envSource: string = ""
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
