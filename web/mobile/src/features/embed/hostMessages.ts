/** Host page messages: only the parent is heard, and only on an allowed origin unless any is allowed. */

import {isPlainObject} from "@agenta/shared/utils"

export type HostContext = Record<string, unknown>

type HostMessage =
    | {type: "init"; visitorKey?: unknown; displayName?: string; context?: HostContext}
    | {type: "context"; context: HostContext}

const originOf = (url: string | undefined | null): string | null => {
    if (!url) return null
    try {
        return new URL(url).origin
    } catch {
        return null
    }
}

/** Whether an origin matches an entry: `*`, the exact origin, or `scheme://*.host[:port]` (subdomains only, as in CSP). */
export const originAllowed = (origin: string, allowedOrigins: readonly string[]): boolean =>
    allowedOrigins.some((entry) => {
        if (entry === "*" || entry === origin) return true
        const [scheme, suffix] = entry.split("://*")
        if (suffix === undefined || !suffix.startsWith(".")) return false
        const host = origin.startsWith(`${scheme}://`) && origin.endsWith(suffix)
        return host && origin.length > scheme.length + 3 + suffix.length
    })

/** The parent's origin when it is allowed, from `ancestorOrigins` or else the referrer. */
export const allowedParentOrigin = (
    {ancestorOrigin, referrer}: {ancestorOrigin?: string | null; referrer?: string | null},
    allowedOrigins: readonly string[],
): string | null => {
    const origin = originOf(ancestorOrigin) ?? originOf(referrer)
    return origin && originAllowed(origin, allowedOrigins) ? origin : null
}

/** The host message an event carries, or null when it is not from the parent on an allowed origin. */
export const readHostMessage = (
    event: Pick<MessageEvent, "data" | "origin" | "source">,
    {parent, allowedOrigins}: {parent: unknown; allowedOrigins: readonly string[]},
): HostMessage | null => {
    if (event.source !== parent || !originAllowed(event.origin, allowedOrigins)) return null
    const data: unknown = event.data
    if (!isPlainObject(data)) return null
    if (data.type === "agenta:init") {
        return {
            type: "init",
            visitorKey: data.visitorKey ?? undefined,
            displayName: typeof data.displayName === "string" ? data.displayName : undefined,
            context: isPlainObject(data.context) ? data.context : undefined,
        }
    }
    if (data.type === "agenta:context" && isPlainObject(data.context)) {
        return {type: "context", context: data.context}
    }
    return null
}
