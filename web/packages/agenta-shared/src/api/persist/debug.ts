import type {PersistedQuery} from "@tanstack/query-persist-client-core"

const DEBUG_FLAG = "agenta:persist:debug"

/** Enable via `localStorage.setItem("agenta:persist:debug", "1")` + reload; disable with removeItem. */
export const isPersistDebugEnabled = (): boolean => {
    try {
        return typeof localStorage !== "undefined" && localStorage.getItem(DEBUG_FLAG) === "1"
    } catch {
        return false
    }
}

const shortKey = (key: string): string => {
    // Key format: `${prefix}-${queryHash}`; the hash is the stringified queryKey.
    const dash = key.indexOf("-[")
    if (dash === -1) return key
    const prefix = key.slice(0, dash)
    const hash = key.slice(dash + 1)
    return `${prefix} ${hash.length > 120 ? `${hash.slice(0, 120)}…` : hash}`
}

const approxSize = (value: PersistedQuery): string => {
    try {
        const bytes = JSON.stringify(value.state.data)?.length ?? 0
        return bytes > 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`
    } catch {
        return "?"
    }
}

const ageOf = (value: PersistedQuery): string => {
    const updatedAt = value.state.dataUpdatedAt
    if (!updatedAt) return "no-timestamp"
    const seconds = Math.round((Date.now() - updatedAt) / 1000)
    return seconds > 120 ? `${Math.round(seconds / 60)}m old` : `${seconds}s old`
}

type PersistEvent = "read-hit" | "read-miss" | "write" | "skip" | "evict" | "clear" | "gc"

/** Console diagnostics for the persistence layer; no-op unless the debug flag is set. */
export const persistLog = (
    event: PersistEvent,
    key?: string,
    value?: PersistedQuery | null,
): void => {
    if (!isPersistDebugEnabled()) return
    const label = key ? shortKey(key) : ""
    switch (event) {
        case "read-hit":
            console.info(
                `[persist] HIT  ${label} (${value ? `${approxSize(value)}, ${ageOf(value)}` : "?"})`,
            )
            break
        case "read-miss":
            console.info(`[persist] MISS ${label}`)
            break
        case "write":
            console.info(`[persist] WRITE ${label}${value ? ` (${approxSize(value)})` : ""}`)
            break
        case "skip":
            console.info(`[persist] SKIP ${label} (nullish data — not persisted)`)
            break
        case "evict":
            console.info(`[persist] EVICT ${label} (expired or buster mismatch)`)
            break
        case "clear":
            console.info("[persist] CLEAR all entries")
            break
        case "gc":
            console.info(`[persist] GC ${label}`)
            break
    }
}
