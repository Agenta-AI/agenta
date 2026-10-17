/** Host page messages: only the parent on an allowed origin is heard. */

export type HostContext = Record<string, unknown>

export type HostMessage =
    | {type: "init"; visitorKey?: unknown; displayName?: string; context?: HostContext}
    | {type: "context"; context: HostContext}

const isPlainObject = (value: unknown): value is HostContext =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const originOf = (url: string | undefined | null): string | null => {
    if (!url) return null
    try {
        return new URL(url).origin
    } catch {
        return null
    }
}

/** The parent's origin when it is allowed, from `ancestorOrigins` or else the referrer. */
export const allowedParentOrigin = (
    {ancestorOrigin, referrer}: {ancestorOrigin?: string | null; referrer?: string | null},
    allowedOrigins: readonly string[],
): string | null => {
    const origin = originOf(ancestorOrigin) ?? originOf(referrer)
    return origin && allowedOrigins.includes(origin) ? origin : null
}

/** The host message an event carries, or null when it is not from the parent on an allowed origin. */
export const readHostMessage = (
    event: Pick<MessageEvent, "data" | "origin" | "source">,
    {parent, allowedOrigins}: {parent: unknown; allowedOrigins: readonly string[]},
): HostMessage | null => {
    if (event.source !== parent || !allowedOrigins.includes(event.origin)) return null
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
