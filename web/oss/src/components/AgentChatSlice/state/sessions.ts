import type {UIMessage} from "ai"
import {atom, type Getter} from "jotai"
import {atomFamily, atomWithStorage, selectAtom} from "jotai/utils"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

/**
 * Multi-session model for the agent chat slice. The playground hosts several parallel agent
 * conversations as top-level dynamic tabs (no side rail); this holds the session history, which
 * tabs are open, the active tab, and each session's persisted messages.
 *
 * Two distinct concerns, both app-scoped (the playground is app-scoped, like
 * `selectedVariantsByAppAtom`):
 *   - HISTORY (`sessionsByAppAtom`): every session ever created for the app. A closed tab stays
 *     here so it can be reopened from the history picker; only an explicit delete removes it.
 *   - OPEN TABS (`openIdsByAppAtom`): which history sessions are currently shown as tabs, in tab
 *     order. Closing a tab drops its id here but keeps the session (and its messages).
 * Messages are keyed by the globally-unique session id, so they need no app dimension.
 *
 * Persistence: everything is `atomWithStorage`, so history, tabs, and conversations survive a
 * reload. NOTE: attachments are stored inline as `data:` URLs (see `assets/files.ts`); a
 * conversation with large files can approach the localStorage quota — acceptable for v1.
 */

export interface AgentChatSession {
    id: string
    /** User-set title. When empty, the UI falls back to the first user message / "Chat N". */
    title?: string
    /** Creation time (ms epoch). Orders the history picker; absent on pre-upgrade sessions. */
    createdAt?: number
}

const GLOBAL_APP_KEY = "__global__"

const appKeyAtom = atom((get) => get(routerAppIdAtom) || GLOBAL_APP_KEY)

// One source of truth per concern, keyed by app id. Scoped accessors below derive the
// current app's slice (mirrors the playground's `selectedVariantsByAppAtom` pattern).
//
// `getOnInit: true` — read localStorage synchronously on init. Without it the atom starts as
// the empty default `{}` on every mount and only hydrates afterwards, so the "seed one tab"
// effect sees an empty list in that window and creates a stray session on every reload/HMR.
const STORAGE_OPTS = {getOnInit: true} as const

/** Full per-app session history (open AND closed). */
const sessionsByAppAtom = atomWithStorage<Record<string, AgentChatSession[]>>(
    "agenta:agent-chat:sessions",
    {},
    undefined,
    STORAGE_OPTS,
)

/**
 * Which sessions are open as tabs, per app, in tab order.
 *
 * Migration: before this atom is ever written for an app, the open set defaults to the whole
 * history — every pre-upgrade session was an open tab (see `currentOpenIds`). Once any tab op
 * writes an explicit list, that list is authoritative.
 */
const openIdsByAppAtom = atomWithStorage<Record<string, string[]>>(
    "agenta:agent-chat:open-sessions",
    {},
    undefined,
    STORAGE_OPTS,
)

const activeByAppAtom = atomWithStorage<Record<string, string>>(
    "agenta:agent-chat:active-session",
    {},
    undefined,
    STORAGE_OPTS,
)

/** Persisted messages per session id. Written when a conversation's stream settles. */
export const sessionMessagesAtom = atomWithStorage<Record<string, UIMessage[]>>(
    "agenta:agent-chat:messages",
    {},
    undefined,
    STORAGE_OPTS,
)

/** Open tab ids for an app, with the pre-upgrade fallback (everything open). Pure read helper
 * for the writers below — never mutates. */
const currentOpenIds = (get: Getter, key: string): string[] => {
    const explicit = get(openIdsByAppAtom)[key]
    if (explicit) return explicit
    return (get(sessionsByAppAtom)[key] ?? []).map((s) => s.id)
}

/** All sessions for the current app (history), newest first. Backs the history picker. */
export const sessionHistoryAtom = atom((get) => {
    const list = get(sessionsByAppAtom)[get(appKeyAtom)] ?? []
    // Newest first; pre-upgrade sessions (no createdAt) sort last, preserving their order.
    return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
})

/** Open tab ids for the current app, in tab order (with the migration fallback). */
const openIdsAtom = atom((get) => currentOpenIds(get, get(appKeyAtom)))

/** Sessions shown as tabs, in tab order. */
export const sessionsListAtom = atom((get) => {
    const byId = new Map(
        (get(sessionsByAppAtom)[get(appKeyAtom)] ?? []).map((s) => [s.id, s] as const),
    )
    return get(openIdsAtom)
        .map((id) => byId.get(id))
        .filter((s): s is AgentChatSession => Boolean(s))
})

/** Active session id for the current app (may be stale if that tab was closed — the UI
 * falls back to the first open tab when this id isn't in the open list). */
export const activeSessionIdAtom = atom((get) => get(activeByAppAtom)[get(appKeyAtom)] ?? "")

/** Set of currently-open session ids (used to label the history picker). */
export const openSessionIdsAtom = atom((get) => new Set(get(openIdsAtom)))

/** Create a session and make it the active open tab. Returns the new id. */
export const addSessionAtom = atom(null, (get, set) => {
    const key = get(appKeyAtom)
    const id = crypto.randomUUID()
    // Read open ids BEFORE mutating history, else the fallback would re-count the new id.
    const open = currentOpenIds(get, key)
    const all = get(sessionsByAppAtom)
    set(sessionsByAppAtom, {...all, [key]: [...(all[key] ?? []), {id, createdAt: Date.now()}]})
    set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: [...open, id]})
    set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
    return id
})

/** Close a tab: drop it from the open list (KEEP the session + messages so it can be reopened
 * from the history picker) and re-point the active tab to a neighbour if it was the one closed. */
export const closeSessionAtom = atom(null, (get, set, id: string) => {
    const key = get(appKeyAtom)
    const open = currentOpenIds(get, key)
    const nextOpen = open.filter((x) => x !== id)
    set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: nextOpen})

    const active = get(activeByAppAtom)
    if (active[key] === id) {
        const closedIdx = open.indexOf(id)
        const neighbour = nextOpen[Math.min(closedIdx, nextOpen.length - 1)] ?? ""
        set(activeByAppAtom, {...active, [key]: neighbour})
    }
})

/** Reopen a session as a tab (or just focus it if already open) and make it active. */
export const openSessionAtom = atom(null, (get, set, id: string) => {
    const key = get(appKeyAtom)
    const open = currentOpenIds(get, key)
    if (!open.includes(id)) {
        set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: [...open, id]})
    }
    set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
})

/**
 * Ensure a session with `id` exists in history, is open, and is active — used when opening a
 * session from a deep link / observability trace. Creates the history entry if it's unknown to
 * this browser (its messages come from `sessionMessagesAtom`, hydrated locally or server-side).
 */
export const adoptSessionAtom = atom(
    null,
    (get, set, {id, title}: {id: string; title?: string}) => {
        const key = get(appKeyAtom)
        const all = get(sessionsByAppAtom)
        const list = all[key] ?? []
        if (!list.some((s) => s.id === id)) {
            set(sessionsByAppAtom, {...all, [key]: [...list, {id, title, createdAt: Date.now()}]})
        }
        const open = currentOpenIds(get, key)
        if (!open.includes(id)) {
            set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: [...open, id]})
        }
        set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
    },
)

/** Permanently delete a session: drop it from history, the open tabs, and its messages. */
export const deleteSessionAtom = atom(null, (get, set, id: string) => {
    const key = get(appKeyAtom)
    const all = get(sessionsByAppAtom)
    set(sessionsByAppAtom, {...all, [key]: (all[key] ?? []).filter((s) => s.id !== id)})

    const open = currentOpenIds(get, key)
    if (open.includes(id)) {
        set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: open.filter((x) => x !== id)})
    }

    const active = get(activeByAppAtom)
    if (active[key] === id) {
        set(activeByAppAtom, {...active, [key]: open.filter((x) => x !== id)[0] ?? ""})
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

/** First user message text, used as the tab/history label when the session is untitled. */
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

/**
 * Per-session first-user-text, as a focused selector. Subscribers re-render only when this
 * STRING changes (stable once the first message is sent) — not on every streamed token — so a
 * tab label doesn't churn while its conversation streams. Used instead of subscribing the tab
 * bar to the whole `sessionMessagesAtom` (which changes on every message and would re-render
 * the bar + all mounted panes mid-stream).
 */
export const sessionFirstUserTextAtomFamily = atomFamily((id: string) =>
    selectAtom(sessionMessagesAtom, (all) => firstUserText(all[id])),
)
