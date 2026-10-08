/**
 * The maintenance notice: a bar across the top of the app for a planned event, driven
 * entirely by a PostHog feature flag. Both apps (/m and /w) render it from this logic.
 *
 * The words live in the flag's payload, not in the code, so a notice can be put up,
 * reworded and taken down from PostHog without a deploy.
 *
 * Payload shape, all fields optional except `message`:
 *
 *   {
 *     "id": "us-cutover-2026-10",   // changing it makes a dismissed bar come back
 *     "message": "...",
 *     "linkHref": "https://...",
 *     "linkLabel": "Read more",
 *     "tone": "info" | "warning"
 *   }
 */
export const MAINTENANCE_NOTICE_FLAG = "maintenance-notice"

const DISMISSED_KEY = "agenta:dismissed-maintenance-notice"

/** The bar is one line on a laptop. Longer text wraps and pushes the app down. */
const MAX_MESSAGE = 240
const MAX_LABEL = 40

export interface MaintenanceNotice {
    id: string
    message: string
    linkHref?: string
    linkLabel?: string
    tone: "info" | "warning"
}

/** The part of a PostHog client the notice reads. Structural, so this package needs no SDK. */
export interface MaintenanceNoticeFlagClient {
    isFeatureEnabled(key: string): boolean | undefined
    getFeatureFlagPayload(key: string): unknown
    onFeatureFlags(callback: () => void): unknown
}

const asText = (value: unknown, max: number): string | undefined => {
    if (typeof value !== "string") return undefined
    const trimmed = value.trim()
    if (!trimmed) return undefined
    return trimmed.slice(0, max)
}

/** Only an absolute http(s) url with a host. A payload is not a place to run `javascript:`. */
const asLink = (value: unknown): string | undefined => {
    const text = asText(value, 2048)
    if (!text) return undefined
    try {
        const url = new URL(text)
        if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
        if (!url.hostname) return undefined
        return text
    } catch {
        return undefined
    }
}

/**
 * The payload is remote configuration, so treat it as data and not as something
 * well formed. A payload we cannot read is no notice, never a half-rendered bar.
 */
export const parseNotice = (payload: unknown): MaintenanceNotice | null => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
    const raw = payload as Record<string, unknown>

    const message = asText(raw.message, MAX_MESSAGE)
    if (!message) return null

    const linkHref = asLink(raw.linkHref)

    return {
        id: asText(raw.id, 120) ?? message,
        message,
        linkHref,
        linkLabel: linkHref ? (asText(raw.linkLabel, MAX_LABEL) ?? "Read more") : undefined,
        tone: raw.tone === "warning" ? "warning" : "info",
    }
}

/** The notice the client's flags describe now, or null. Never throws. */
export const readMaintenanceNotice = (
    client: MaintenanceNoticeFlagClient,
): MaintenanceNotice | null => {
    try {
        if (!client.isFeatureEnabled(MAINTENANCE_NOTICE_FLAG)) return null
        return parseNotice(client.getFeatureFlagPayload(MAINTENANCE_NOTICE_FLAG))
    } catch {
        return null
    }
}

/**
 * Calls `onChange` with the current notice now and again whenever PostHog refreshes its
 * flags. Returns the unsubscribe.
 */
export const subscribeMaintenanceNotice = (
    client: MaintenanceNoticeFlagClient,
    onChange: (notice: MaintenanceNotice | null) => void,
): (() => void) => {
    const read = () => onChange(readMaintenanceNotice(client))
    read()
    let unsubscribe: unknown
    try {
        unsubscribe = client.onFeatureFlags(read)
    } catch {
        unsubscribe = undefined
    }
    return () => {
        // posthog-js returns its own unsubscribe; older builds return nothing.
        if (typeof unsubscribe === "function") unsubscribe()
    }
}

/** Whether the reader closed this exact notice. Blocked storage counts as not dismissed. */
export const isNoticeDismissed = (notice: MaintenanceNotice): boolean => {
    try {
        return globalThis.localStorage?.getItem(DISMISSED_KEY) === notice.id
    } catch {
        return false
    }
}

/** Remembers the dismissal. Blocked storage is fine: the bar closes for this page anyway. */
export const dismissNotice = (notice: MaintenanceNotice): void => {
    try {
        globalThis.localStorage?.setItem(DISMISSED_KEY, notice.id)
    } catch {
        // Private windows and blocked site data throw here.
    }
}
