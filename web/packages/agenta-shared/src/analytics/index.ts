import {v4 as uuidv4} from "uuid"

export const CLOUD_CONFIG = {
    session_recording: {
        maskAllInputs: false,
        maskInputOptions: {password: true, email: true},
    },
}

export const OSS_CONFIG = {persistence: "localStorage+cookie" as const}

export const POSTHOG_CONFIG = {
    api_host: "https://alef.agenta.ai",
    ui_host: "https://us.posthog.com",
    capture_pageview: false as const,
}

let fallbackDistinctId: string | undefined

export const generateOrRetrieveDistinctId = (): string => {
    try {
        if (typeof localStorage !== "undefined") {
            const stored = localStorage.getItem("posthog_distinct_id")
            if (stored) return stored
            const id = uuidv4()
            localStorage.setItem("posthog_distinct_id", id)
            return id
        }
    } catch {
        // Blocked storage must not prevent the app from loading.
    }
    return (fallbackDistinctId ??= uuidv4())
}

export interface AnalyticsUser {
    email?: string | null
    username?: string | null
}

export function analyticsIdentity(
    user: AnalyticsUser | null | undefined,
    cloud: boolean,
    baseId: string,
) {
    const properties: Record<string, unknown> = {}
    if (user?.email) properties.email = user.email
    if (user?.username) properties.username = user.username
    return {
        id: cloud && user?.email ? user.email : baseId,
        properties: Object.keys(properties).length ? properties : undefined,
    }
}

export {captureFirstAgentIntent, classifyAgentIntent} from "./onboarding"
export type {FirstAgentIntentPayload, FirstAgentIntentSource} from "./onboarding"
