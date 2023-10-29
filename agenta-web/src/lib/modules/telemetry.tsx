import posthog from "posthog-js"

// Check if tracking is enabled
const trackingEnabled = process.env.NEXT_PUBLIC_TELEMETRY_TRACKING_ENABLED === "true"

// Initialize the Posthog client
if (typeof window !== "undefined" && trackingEnabled) {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_SECRET_KEY as string, {
        api_host: "https://app.posthog.com",
        // Enable debug mode in development
        loaded: (posthog) => {
            if (process.env.NODE_ENV === "development") posthog.debug()
        },
    })
}

export const eventTracking = posthog
