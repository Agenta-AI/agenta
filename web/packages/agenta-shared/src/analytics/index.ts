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

export const INSTANCE_GROUP = "instance"

export interface AnalyticsUser {
    id?: string | null
    email?: string | null
    username?: string | null
    instance_id?: string | null
}

/**
 * The analytics person is the user id the backend assigned, the same id the API uses for
 * server events. It is unique per deployment, so one email on two deployments is two people,
 * while one user on two browsers is one person. The email is only a person property.
 * Until the profile loads there is no id and the browser stays anonymous.
 */
export function analyticsIdentity(user: AnalyticsUser | null | undefined) {
    const properties: Record<string, unknown> = {}
    if (user?.email) properties.email = user.email
    if (user?.username) properties.username = user.username
    return {
        id: user?.id || null,
        properties: Object.keys(properties).length ? properties : undefined,
        instanceId: user?.instance_id || null,
    }
}

export {captureFirstAgentIntent, classifyAgentIntent} from "./onboarding"
export type {FirstAgentIntentPayload, FirstAgentIntentSource} from "./onboarding"
export {
    MAINTENANCE_NOTICE_FLAG,
    dismissNotice,
    isNoticeDismissed,
    parseNotice,
    readMaintenanceNotice,
    subscribeMaintenanceNotice,
} from "./maintenanceNotice"
export type {MaintenanceNotice, MaintenanceNoticeFlagClient} from "./maintenanceNotice"
