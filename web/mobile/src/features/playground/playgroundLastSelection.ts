/**
 * The revisions each app's playground showed last, so the next visit opens on them. The key and
 * shape are /w's (`{[appId]: ids}`): a user who moves between the two apps keeps one selection.
 * Storage that is full, blocked or holds bad data reads as "nothing stored".
 */
const KEY = "agenta:playground:last-selection"

const readAll = (): Record<string, unknown> => {
    try {
        const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}")
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : {}
    } catch {
        return {}
    }
}

export const readLastSelection = (appId: string): string[] => {
    const ids = readAll()[appId]
    return Array.isArray(ids)
        ? [...new Set(ids.filter((id): id is string => typeof id === "string" && !!id))]
        : []
}

export const writeLastSelection = (appId: string, ids: readonly string[]) => {
    try {
        window.localStorage.setItem(KEY, JSON.stringify({...readAll(), [appId]: ids}))
    } catch {
        // Full or blocked storage: the next visit opens the latest revision instead.
    }
}
