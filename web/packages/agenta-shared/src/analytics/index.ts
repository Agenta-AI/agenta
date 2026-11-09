import {v4 as uuidv4} from "uuid"

export const CLOUD_CONFIG = {
    session_recording: {
        maskAllInputs: false,
        maskInputOptions: {password: true, email: true},
    },
}

/** Properties posthog-js adds that name the instance's address or the referrer. */
const INSTANCE_URL_PROPERTIES = ["$current_url", "$host", "$referrer", "$referring_domain"]
// `$initial_person_info` holds the first URL and referrer; PostHog expands it into
// `$initial_current_url` and the rest. `$session_entry_*` repeats them per session.
const INSTANCE_URL_PREFIXES = ["$initial_", "$session_entry_"]

const isInstanceUrlProperty = (key: string) =>
    INSTANCE_URL_PROPERTIES.includes(key) ||
    INSTANCE_URL_PREFIXES.some((prefix) => key.startsWith(prefix))

const withoutInstanceUrl = (properties: Record<string, unknown> | undefined) => {
    if (!properties) return properties
    const kept = {...properties}
    for (const key of Object.keys(kept)) if (isInstanceUrlProperty(key)) delete kept[key]
    for (const key of ["$set", "$set_once"]) {
        const nested = kept[key]
        if (nested && typeof nested === "object") {
            kept[key] = withoutInstanceUrl(nested as Record<string, unknown>)
        }
    }
    return kept
}

interface CapturedEvent {
    properties: Record<string, unknown>
    $set?: Record<string, unknown>
    $set_once?: Record<string, unknown>
}

/** Self-hosted events carry no instance address and no GeoIP lookup. */
export const stripInstanceUrl = <T extends CapturedEvent>(event: T | null): T | null =>
    event && {
        ...event,
        properties: {...withoutInstanceUrl(event.properties), $geoip_disable: true},
        $set: withoutInstanceUrl(event.$set),
        $set_once: withoutInstanceUrl(event.$set_once),
    }

/** Self-hosted (both editions): only the named product events and page views; nothing recorded on its own. */
export const SELF_HOSTED_CONFIG = {
    persistence: "localStorage+cookie" as const,
    autocapture: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_performance: false,
    disable_session_recording: true,
    save_referrer: false,
    before_send: stripInstanceUrl,
}

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

/** `GET /instance/telemetry`: whether to send events, and the identity to send them under. */
export interface InstanceTelemetry {
    enabled: boolean
    distinct_id: string | null
    /** Set on self-hosted instances only. */
    groups: {instance: string} | null
}

export const parseInstanceTelemetry = (data: unknown): InstanceTelemetry => {
    const body = (data ?? {}) as {enabled?: unknown; distinct_id?: unknown; groups?: unknown}
    const instance = (body.groups as {instance?: unknown} | null | undefined)?.instance
    return {
        enabled: body.enabled === true,
        distinct_id: typeof body.distinct_id === "string" ? body.distinct_id : null,
        groups: typeof instance === "string" ? {instance} : null,
    }
}

/** Cloud keeps its email identity and settings. Only known when telemetry is on: off, `groups` is null everywhere. */
export const isCloudTelemetry = (telemetry: InstanceTelemetry) =>
    telemetry.enabled && telemetry.groups === null

interface IdentityClient {
    get_distinct_id: () => string
    reset: () => void
    identify: (id: string) => void
    group: (type: string, key: string) => void
}

/**
 * Self-hosted: identify with the API's id before the first event. A browser that holds
 * another id (for example an email from before) starts over, so nothing stored under
 * that id is sent again.
 */
export const adoptInstanceIdentity = (
    client: IdentityClient,
    telemetry: InstanceTelemetry | null,
) => {
    if (!telemetry?.distinct_id) return
    if (client.get_distinct_id() !== telemetry.distinct_id) client.reset()
    client.identify(telemetry.distinct_id)
    if (telemetry.groups) client.group("instance", telemetry.groups.instance)
}

export interface AnalyticsUser {
    email?: string | null
    username?: string | null
}

/**
 * The id and person properties to identify with. `id` is the id the API gives the
 * browser. Cloud identifies by email with email and username properties; self-hosted
 * sends no email or username.
 */
export function analyticsIdentity(
    user: AnalyticsUser | null | undefined,
    cloud: boolean,
    id: string,
) {
    const properties: Record<string, unknown> = {}
    if (cloud && user?.email) properties.email = user.email
    if (cloud && user?.username) properties.username = user.username
    return {
        id: cloud && user?.email ? user.email : id,
        properties: Object.keys(properties).length ? properties : undefined,
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
