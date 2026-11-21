import type {BuilderChatRow} from "./useBuilderChatList"

/** A chat with activity in the last 2 days opens again (design rule 1.3). */
export const REOPEN_WINDOW_MS = 48 * 60 * 60 * 1000

/**
 * The chat the panel opens for an agent: the newest stored chat when its last activity is less
 * than 48 hours old or it still runs; otherwise none, and the panel opens a new chat. `rows` are
 * the stored chats of this agent as the query returns them, newest activity first.
 */
export const sessionToOpen = (
    rows: readonly BuilderChatRow[],
    now: number,
    isRunning: (sessionId: string) => boolean = () => false,
): string | null => {
    const newest = rows[0]
    if (!newest) return null
    if (newest.flags?.is_running || isRunning(newest.session_id)) return newest.session_id
    const activity = newest.updated_at ? Date.parse(newest.updated_at) : NaN
    return Number.isFinite(activity) && now - activity < REOPEN_WINDOW_MS ? newest.session_id : null
}

/** The age of a chat in whole units, for the "3d" labels of the lists. */
export const chatAge = (
    updatedAt: string | null | undefined,
    now: number,
): {unit: "minute" | "hour" | "day"; count: number} | null => {
    const at = updatedAt ? Date.parse(updatedAt) : NaN
    if (!Number.isFinite(at)) return null
    const minutes = Math.max(1, Math.floor((now - at) / 60_000))
    if (minutes < 60) return {unit: "minute", count: minutes}
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return {unit: "hour", count: hours}
    return {unit: "day", count: Math.floor(hours / 24)}
}
