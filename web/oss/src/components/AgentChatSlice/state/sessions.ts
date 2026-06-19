import type {UIMessage} from "ai"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

/**
 * Multi-session model for the agent chat slice. The playground hosts several parallel agent
 * conversations as top-level dynamic tabs (no side rail); this holds the tab list, the
 * active tab, and each session's persisted messages.
 *
 * Scoping: the session LIST + active tab are app-scoped (the playground is app-scoped, like
 * `selectedVariantsByAppAtom`), so each app keeps its own set of chats. Messages are keyed by
 * the globally-unique session id, so they need no app dimension.
 *
 * Persistence: everything is `atomWithStorage`, so tabs and their conversations survive a
 * reload. NOTE: attachments are stored inline as `data:` URLs (see `assets/files.ts`); a
 * conversation with large files can approach the localStorage quota — acceptable for v1.
 */

export interface AgentChatSession {
    id: string
    /** User-set title. When empty, the UI falls back to the first user message / "Chat N". */
    title?: string
}

const GLOBAL_APP_KEY = "__global__"

const appKeyAtom = atom((get) => get(routerAppIdAtom) || GLOBAL_APP_KEY)

// One source of truth per concern, keyed by app id. Scoped accessors below derive the
// current app's slice (mirrors the playground's `selectedVariantsByAppAtom` pattern).
const sessionsByAppAtom = atomWithStorage<Record<string, AgentChatSession[]>>(
    "agenta:agent-chat:sessions",
    {},
)
const activeByAppAtom = atomWithStorage<Record<string, string>>(
    "agenta:agent-chat:active-session",
    {},
)

/** Persisted messages per session id. Written when a conversation's stream settles. */
export const sessionMessagesAtom = atomWithStorage<Record<string, UIMessage[]>>(
    "agenta:agent-chat:messages",
    {},
)

/** Sessions for the current app, in tab order. */
export const sessionsListAtom = atom((get) => get(sessionsByAppAtom)[get(appKeyAtom)] ?? [])

/** Active session id for the current app (may be stale if that tab was closed — the UI
 * falls back to the first tab when this id isn't in the list). */
export const activeSessionIdAtom = atom((get) => get(activeByAppAtom)[get(appKeyAtom)] ?? "")

/** Create a session and make it active. Returns the new id. */
export const addSessionAtom = atom(null, (get, set) => {
    const key = get(appKeyAtom)
    const all = get(sessionsByAppAtom)
    const list = all[key] ?? []
    const id = crypto.randomUUID()
    set(sessionsByAppAtom, {...all, [key]: [...list, {id}]})
    set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
    return id
})

/** Close a session: drop the tab, its persisted messages, and re-point the active tab to a
 * neighbour if it was the one closed. */
export const closeSessionAtom = atom(null, (get, set, id: string) => {
    const key = get(appKeyAtom)
    const all = get(sessionsByAppAtom)
    const list = all[key] ?? []
    const nextList = list.filter((s) => s.id !== id)
    set(sessionsByAppAtom, {...all, [key]: nextList})

    const active = get(activeByAppAtom)
    if (active[key] === id) {
        const closedIdx = list.findIndex((s) => s.id === id)
        const neighbour = nextList[Math.min(closedIdx, nextList.length - 1)]?.id ?? ""
        set(activeByAppAtom, {...active, [key]: neighbour})
    }

    const messages = {...get(sessionMessagesAtom)}
    if (id in messages) {
        delete messages[id]
        set(sessionMessagesAtom, messages)
    }
})

export const renameSessionAtom = atom(
    null,
    (get, set, {id, title}: {id: string; title: string}) => {
        const key = get(appKeyAtom)
        const all = get(sessionsByAppAtom)
        const list = (all[key] ?? []).map((s) =>
            s.id === id ? {...s, title: title.trim() || undefined} : s,
        )
        set(sessionsByAppAtom, {...all, [key]: list})
    },
)

export const setActiveSessionAtom = atom(null, (get, set, id: string) => {
    const key = get(appKeyAtom)
    set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
})

/** Write a session's messages to the persisted store (called when its stream settles). */
export const persistSessionMessagesAtom = atom(
    null,
    (get, set, {id, messages}: {id: string; messages: UIMessage[]}) => {
        set(sessionMessagesAtom, {...get(sessionMessagesAtom), [id]: messages})
    },
)

/** First user message text, used as the tab label when the session is untitled. */
export const firstUserText = (messages: UIMessage[] | undefined): string => {
    const first = messages?.find((m) => m.role === "user")
    if (!first) return ""
    return first.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as {text: string}).text)
        .join(" ")
        .trim()
}

/** Tab label: explicit title → first user message (truncated) → positional "Chat N". */
export const sessionLabel = (
    session: AgentChatSession,
    messages: UIMessage[] | undefined,
    index: number,
): string => {
    if (session.title) return session.title
    const text = firstUserText(messages)
    if (text) return text.length > 24 ? `${text.slice(0, 24)}…` : text
    return `Chat ${index + 1}`
}
