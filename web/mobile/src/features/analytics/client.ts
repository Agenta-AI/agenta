import {
    CLOUD_CONFIG,
    OSS_CONFIG,
    POSTHOG_CONFIG,
    captureFirstAgentIntent,
    generateOrRetrieveDistinctId,
    type FirstAgentIntentPayload,
} from "@agenta/shared/analytics"
import {isEE} from "@agenta/shared/api/env"
import {atom, getDefaultStore} from "jotai"
import type {PostHog} from "posthog-js"

import {getEnv} from "@/lib/env"

export const posthogAtom = atom<PostHog | null>(null)
let loading: Promise<PostHog | null> | undefined

export const isAnalyticsAuthRoute = (path: string) => {
    const route = path.replace(/^\/m(?=\/|$)/, "").split(/[?#]/)[0]
    return route.startsWith("/auth") && !route.startsWith("/auth/callback")
}

export function loadPostHog(): Promise<PostHog | null> {
    if (!getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) return Promise.resolve(null)
    if (loading) return loading
    loading = (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const posthog = (await import("posthog-js")).default
                const key = getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")
                if (!key) return null
                return await new Promise<PostHog>((resolve) => {
                    posthog.init(key, {
                        ...POSTHOG_CONFIG,
                        ...(isEE() ? CLOUD_CONFIG : OSS_CONFIG),
                        loaded: (client) => {
                            if (process.env.NODE_ENV === "development") client.debug()
                            try {
                                client.identify(generateOrRetrieveDistinctId())
                            } catch {
                                // Identification must not prevent initialization from settling.
                            }
                            resolve(client as PostHog)
                        },
                    })
                })
            } catch {
                // Analytics failures must not interrupt sign-in or a conversation.
            }
        }
        console.warn("PostHog failed to initialize after maximum attempts")
        return null
    })()
    return loading
}

export function capture(event: string, properties?: Record<string, unknown>) {
    if (!getEnv("NEXT_PUBLIC_POSTHOG_API_KEY")) return
    try {
        getDefaultStore().get(posthogAtom)?.capture(event, properties)
    } catch {
        // Analytics must not interrupt the action being measured.
    }
}

export function captureIntent(payload: FirstAgentIntentPayload) {
    captureFirstAgentIntent({capture}, payload)
}

export async function resetAnalytics() {
    try {
        // Also reset an import that was still in flight when the user signed out.
        const client = getDefaultStore().get(posthogAtom) ?? (await loading)
        client?.reset()
    } catch {
        // Sign-out must work when the SDK is blocked.
    }
}
