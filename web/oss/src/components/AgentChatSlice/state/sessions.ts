import {
    archiveSessionRemote,
    deleteSessionRemote,
    setSessionHeader,
    unarchiveSessionRemote,
} from "@agenta/entities/session"
import {generateId} from "@agenta/shared/utils"
import type {UIMessage} from "ai"
import {atom, type Getter, type Setter} from "jotai"
import {atomFamily, atomWithStorage, selectAtom} from "jotai/utils"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"
import {projectIdAtom} from "@/oss/state/project"

import {clearSessionEphemera, markSessionFresh} from "./sessionEphemera"

/**
 * Multi-session model for the agent chat slice. The playground hosts several parallel agent
 * conversations as top-level dynamic tabs (no side rail); this holds the session history, which
 * tabs are open, the active tab, and each session's persisted messages.
 *
 * Everything is keyed by a **scope key** — a string that isolates one mount surface's sessions
 * from another's. The main playground uses the app scope (`routerAppId`, or `__global__` off an
 * app page); the create/edit drawer uses its own `drawer:<entityId>` scope so it never inherits
 * or overwrites the playground's tabs/history (the drawer mounts OVER the playground, so both
 * surfaces are live at once and a single global "current scope" would clobber). Consumers read
 * their scope from `useChatScopeKey()` (see ./scope) and pass it to the families below.
 *
 * Two distinct concerns, both scope-keyed:
 *   - HISTORY (`sessionsByAppAtom`): every session ever created for the scope. A closed tab stays
 *     here so it can be reopened from the history picker; only an explicit delete removes it.
 *   - OPEN TABS (`openIdsByAppAtom`): which history sessions are currently shown as tabs, in tab
 *     order. Closing a tab drops its id here but keeps the session (and its messages).
 * Messages are keyed by the globally-unique session id, so they need no scope dimension.
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
    /** Set once the server list confirms this session exists. Distinguishes a remotely-deleted
     * session (was true, now absent from the server → drop) from a purely-local optimistic one. */
    serverKnown?: boolean
    /** The durable stream row is soft-deleted (killed/ended) — resumable, shown muted in history.
     * Purely a display hint from the server; a live local session clears it. */
    ended?: boolean
    /** Hidden-but-recoverable (server `archived_at`). Filtered out of the main history/tabs and
     * shown only in the archived view; unarchive clears it. Distinct from `ended` (kill). */
    archived?: boolean
}

export const GLOBAL_APP_KEY = "__global__"

/**
 * Default scope key when a surface provides no override: the current app (or `__global__` off an
 * app page). Kept as the bare app id (no prefix) so sessions persisted before scoping was
 * introduced still resolve under the same storage key.
 *
 * Fallback order matters: `routerAppIdAtom` derives from the app-state snapshot, which updates
 * on routeChangeComplete — AFTER the destination page has rendered. During a client-side nav
 * onto an app playground, a mounted chat panel would briefly scope to `__global__` (wrong/empty
 * session store, stray seeded tab), then swap to the app scope when the snapshot settles —
 * remounting the transcript (the warm re-entry "flash"). The live URL never lags, so parse the
 * app id from it before conceding to the global scope. The non-reactive window read is safe:
 * when the router atom catches up it yields the SAME id, so the scope value never swaps.
 */
export const defaultScopeKeyAtom = atom((get) => {
    const routed = get(routerAppIdAtom)
    if (routed) return routed
    if (typeof window !== "undefined") {
        const fromUrl = window.location.pathname.match(/\/apps\/([^/]+)/)?.[1]
        if (fromUrl) return fromUrl
    }
    return GLOBAL_APP_KEY
})

// One source of truth per concern, keyed by scope key. Scoped accessors below derive a single
// scope's slice (mirrors the playground's `selectedVariantsByAppAtom` pattern).
//
// `getOnInit: true` — read localStorage synchronously on init. Without it the atom starts as
// the empty default `{}` on every mount and only hydrates afterwards, so the "seed one tab"
// effect sees an empty list in that window and creates a stray session on every reload/HMR.
const STORAGE_OPTS = {getOnInit: true} as const

/** Full per-scope session history (open AND closed). */
const sessionsByAppAtom = atomWithStorage<Record<string, AgentChatSession[]>>(
    "agenta:agent-chat:sessions",
    {},
    undefined,
    STORAGE_OPTS,
)

/**
 * Which sessions are open as tabs, per scope, in tab order.
 *
 * Migration: before this atom is ever written for a scope, the open set defaults to the whole
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

/** Persisted messages per session id. Written when a conversation's stream settles. Session ids
 * are globally unique, so this store has no scope dimension. */
export const sessionMessagesAtom = atomWithStorage<Record<string, UIMessage[]>>(
    "agenta:agent-chat:messages",
    {},
    undefined,
    STORAGE_OPTS,
)

/** Open tab ids for a scope, with the pre-upgrade fallback (everything open). Pure read helper
 * for the writers below — never mutates. */
const currentOpenIds = (get: Getter, key: string): string[] => {
    const explicit = get(openIdsByAppAtom)[key]
    if (explicit) return explicit
    return (get(sessionsByAppAtom)[key] ?? []).map((s) => s.id)
}

/**
 * A "husk": a session the user never initiated — no user title AND no messages. It has no backend
 * records and nothing to reopen, so it's only worth keeping while it's an open tab; once closed it's
 * dropped rather than left in history. Reload-proof (reads persisted title + messages), so it also
 * catches never-run sessions whose in-memory "fresh" marker was lost to a reload.
 */
export const isSessionHusk = (
    session: AgentChatSession,
    messages: Record<string, UIMessage[]>,
): boolean => !session.serverKnown && !session.title?.trim() && !messages[session.id]?.length

/** Active (non-archived) sessions for a scope, newest first. Backs the main history picker. */
export const sessionHistoryAtomFamily = atomFamily((key: string) =>
    atom((get) => {
        const list = (get(sessionsByAppAtom)[key] ?? []).filter((s) => !s.archived)
        // Newest first; pre-upgrade sessions (no createdAt) sort last, preserving their order.
        return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    }),
)

/** Archived sessions for a scope, newest first. Backs the archived view. */
export const archivedSessionHistoryAtomFamily = atomFamily((key: string) =>
    atom((get) => {
        const list = (get(sessionsByAppAtom)[key] ?? []).filter((s) => s.archived)
        return [...list].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    }),
)

/** Sessions shown as tabs for a scope, in tab order. Archived sessions are hidden even if a stale
 * open-tab id lingers (e.g. archived on another device — the reconciler flips the flag). */
export const sessionsListAtomFamily = atomFamily((key: string) =>
    atom((get) => {
        const byId = new Map((get(sessionsByAppAtom)[key] ?? []).map((s) => [s.id, s] as const))
        return currentOpenIds(get, key)
            .map((id) => byId.get(id))
            .filter((s): s is AgentChatSession => Boolean(s) && !s!.archived)
    }),
)

/** Active session id for a scope (may be stale if that tab was closed — the UI falls back to the
 * first open tab when this id isn't in the open list). */
export const activeSessionIdAtomFamily = atomFamily((key: string) =>
    atom((get) => get(activeByAppAtom)[key] ?? ""),
)

/** Set of currently-open session ids for a scope (used to label the history picker). */
export const openSessionIdsAtomFamily = atomFamily((key: string) =>
    atom((get) => new Set(currentOpenIds(get, key))),
)

/** Create a session and make it the active open tab. Returns the new id. */
export const addSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set) => {
        const id = generateId()
        // Brand-new, never-run session: no backend records yet, so skip its empty-cache hydration.
        markSessionFresh(id)
        // Read open ids BEFORE mutating history, else the fallback would re-count the new id.
        const open = currentOpenIds(get, key)
        const all = get(sessionsByAppAtom)
        set(sessionsByAppAtom, {
            ...all,
            [key]: [...(all[key] ?? []), {id, createdAt: Date.now()}],
        })
        set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: [...open, id]})
        set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
        return id
    }),
)

/** Close a tab: drop it from the open list (KEEP the session + messages so it can be reopened
 * from the history picker) and re-point the active tab to a neighbour if it was the one closed.
 * A never-run session (fresh, no messages) is the exception — it has no backend records and
 * nothing to reopen, so closing discards it entirely rather than leaving an empty husk that piles
 * up in history each time the user opens and closes a blank tab. */
export const closeSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, id: string) => {
        const open = currentOpenIds(get, key)
        const nextOpen = open.filter((x) => x !== id)
        set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: nextOpen})

        const active = get(activeByAppAtom)
        if (active[key] === id) {
            const closedIdx = open.indexOf(id)
            const neighbour = nextOpen[Math.min(closedIdx, nextOpen.length - 1)] ?? ""
            set(activeByAppAtom, {...active, [key]: neighbour})
        }

        const all = get(sessionsByAppAtom)
        const session = (all[key] ?? []).find((s) => s.id === id)
        if (session && isSessionHusk(session, get(sessionMessagesAtom))) {
            set(sessionsByAppAtom, {...all, [key]: (all[key] ?? []).filter((s) => s.id !== id)})
            clearSessionEphemera(id)
        }
    }),
)

/**
 * Drop every closed husk (never-initiated, untitled, no messages) from a scope's history. Open tabs
 * are never touched, so a blank in-progress tab survives. Run once on panel mount to clear husks
 * accumulated before the close-time cleanup existed, and any that outlived a reload (when the
 * in-memory "fresh" marker is already gone). Idempotent.
 */
export const pruneSessionHusksAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set) => {
        const all = get(sessionsByAppAtom)
        const list = all[key] ?? []
        if (list.length === 0) return
        const open = new Set(currentOpenIds(get, key))
        const messages = get(sessionMessagesAtom)
        const staleIds = new Set(
            list.filter((s) => !open.has(s.id) && isSessionHusk(s, messages)).map((s) => s.id),
        )
        if (staleIds.size === 0) return
        set(sessionsByAppAtom, {...all, [key]: list.filter((s) => !staleIds.has(s.id))})
        const active = get(activeByAppAtom)
        if (active[key] && staleIds.has(active[key])) {
            set(activeByAppAtom, {...active, [key]: currentOpenIds(get, key)[0] ?? ""})
        }
        for (const id of staleIds) clearSessionEphemera(id)
    }),
)

/** Reopen a session as a tab (or just focus it if already open) and make it active. */
export const openSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, id: string) => {
        const open = currentOpenIds(get, key)
        if (!open.includes(id)) {
            set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: [...open, id]})
        }
        set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
    }),
)

/**
 * Ensure a session with `id` exists in history, is open, and is active — used when opening a
 * session from a deep link / observability trace. Creates the history entry if it's unknown to
 * this browser (its messages come from `sessionMessagesAtom`, hydrated locally or server-side).
 */
export const adoptSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, {id, title}: {id: string; title?: string}) => {
        const all = get(sessionsByAppAtom)
        const list = all[key] ?? []
        if (!list.some((s) => s.id === id)) {
            set(sessionsByAppAtom, {
                ...all,
                [key]: [...list, {id, title, createdAt: Date.now()}],
            })
        }
        const open = currentOpenIds(get, key)
        if (!open.includes(id)) {
            set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: [...open, id]})
        }
        set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
    }),
)

/** Permanently delete a session: drop it from history, the open tabs, and its messages. */
export const deleteSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, id: string) => {
        const all = get(sessionsByAppAtom)
        const target = (all[key] ?? []).find((s) => s.id === id)
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

        clearSessionEphemera(id)

        // Propagate a user delete to the server so it disappears everywhere — but only for a
        // server-known session (a purely-local husk has no row; the reconciler's own drop path
        // does its own cleanup and never routes here, so this can't loop).
        const projectId = get(projectIdAtom)
        if (projectId && target?.serverKnown) void deleteSessionRemote({sessionId: id, projectId})
    }),
)

/** Archive a session: flag it hidden (optimistic), close its tab, re-point the active tab if it was
 * the one archived, and propagate to the server so it archives everywhere. Recoverable via unarchive
 * — history + messages are kept. No-op for an unknown id. */
export const archiveSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, id: string) => {
        const all = get(sessionsByAppAtom)
        const target = (all[key] ?? []).find((s) => s.id === id)
        if (!target) return
        set(sessionsByAppAtom, {
            ...all,
            [key]: (all[key] ?? []).map((s) => (s.id === id ? {...s, archived: true} : s)),
        })

        const open = currentOpenIds(get, key)
        if (open.includes(id)) {
            set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: open.filter((x) => x !== id)})
        }
        const active = get(activeByAppAtom)
        if (active[key] === id) {
            set(activeByAppAtom, {...active, [key]: open.filter((x) => x !== id)[0] ?? ""})
        }

        // Server-known sessions archive remotely; a purely-local session just carries the local flag.
        const projectId = get(projectIdAtom)
        if (projectId && target.serverKnown) void archiveSessionRemote({sessionId: id, projectId})
    }),
)

/** Unarchive a session: clear the hidden flag (optimistic) so it returns to the main history, and
 * propagate to the server. The tab stays closed — the user reopens it from history. No-op for an
 * unknown id. */
export const unarchiveSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, id: string) => {
        const all = get(sessionsByAppAtom)
        const target = (all[key] ?? []).find((s) => s.id === id)
        if (!target) return
        set(sessionsByAppAtom, {
            ...all,
            [key]: (all[key] ?? []).map((s) => (s.id === id ? {...s, archived: false} : s)),
        })

        const projectId = get(projectIdAtom)
        if (projectId && target.serverKnown) void unarchiveSessionRemote({sessionId: id, projectId})
    }),
)

/** One session as the server list reports it (mapped from a `SessionStream` by the caller). */
export interface ServerSessionSummary {
    id: string
    title?: string
    createdAt?: number
    ended?: boolean
    archived?: boolean
}

/**
 * Fold the server's durable session list for a scope over the localStorage cache:
 *  - adopt sessions the server knows and we don't (cross-device / post-localStorage-wipe),
 *  - enrich `title`/`createdAt` from the server (a local user title always wins),
 *  - drop a session the server DROPPED — present-before, gone-now = hard-deleted elsewhere —
 *    but never a purely-local optimistic session (one the server never confirmed).
 * Open tabs / active stay per-device. Idempotent: a no-op when already reconciled.
 *
 * MUST be called only with a SUCCESSFUL full server result — an empty list from a failed fetch
 * would wrongly drop everything, so the caller gates on query success (see `useReconcileServerSessions`).
 */
export const reconcileServerSessionsAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, server: ServerSessionSummary[]) => {
        const serverById = new Map(server.map((s) => [s.id, s] as const))
        const existing = get(sessionsByAppAtom)[key] ?? []
        const existingIds = new Set(existing.map((s) => s.id))

        const dropped: string[] = []
        const merged: AgentChatSession[] = []
        for (const s of existing) {
            const remote = serverById.get(s.id)
            if (remote) {
                merged.push({
                    ...s,
                    serverKnown: true,
                    title: s.title?.trim() ? s.title : remote.title,
                    createdAt: s.createdAt ?? remote.createdAt,
                    ended: remote.ended,
                    archived: remote.archived,
                })
            } else if (s.serverKnown) {
                dropped.push(s.id)
            } else {
                merged.push(s)
            }
        }
        for (const s of server) {
            if (existingIds.has(s.id)) continue
            merged.push({
                id: s.id,
                title: s.title,
                createdAt: s.createdAt,
                serverKnown: true,
                ended: s.ended,
                archived: s.archived,
            })
        }

        const changed =
            merged.length !== existing.length ||
            merged.some((m, i) => {
                const e = existing[i]
                return (
                    !e ||
                    e.id !== m.id ||
                    e.title !== m.title ||
                    e.createdAt !== m.createdAt ||
                    e.serverKnown !== m.serverKnown ||
                    e.ended !== m.ended ||
                    e.archived !== m.archived
                )
            })
        if (!changed) return

        set(sessionsByAppAtom, {...get(sessionsByAppAtom), [key]: merged})

        if (dropped.length > 0) {
            const droppedSet = new Set(dropped)
            const open = currentOpenIds(get, key)
            const nextOpen = open.filter((id) => !droppedSet.has(id))
            if (nextOpen.length !== open.length) {
                set(openIdsByAppAtom, {...get(openIdsByAppAtom), [key]: nextOpen})
            }
            const active = get(activeByAppAtom)
            if (active[key] && droppedSet.has(active[key])) {
                set(activeByAppAtom, {...active, [key]: nextOpen[0] ?? ""})
            }
            const messages = {...get(sessionMessagesAtom)}
            let msgsChanged = false
            for (const id of dropped) {
                if (id in messages) {
                    delete messages[id]
                    msgsChanged = true
                }
                clearSessionEphemera(id)
            }
            if (msgsChanged) set(sessionMessagesAtom, messages)
        }
    }),
)

/**
 * Move one scope's session state (history, open tabs, active id) into another scope.
 *
 * Used by the onboarding commit: the founding conversation lives under the fixed `onboarding`
 * scope until the real app exists, then is adopted by the app's own scope in the SAME React
 * update that flips the scope provider — the mounted panel re-reads identical sessions under
 * the new key (so nothing remounts), a reload on the app route finds the conversation, and a
 * later onboarding entry's `resetScopeAtomFamily` wipe can no longer destroy it. Messages are
 * keyed by session id (no scope dimension), so they don't move.
 */
export const adoptScopeSessionsAtom = atom(
    null,
    (get, set, {from, to}: {from: string; to: string}) => {
        if (!from || !to || from === to) return
        const sessions = get(sessionsByAppAtom)
        const moved = sessions[from] ?? []
        if (moved.length === 0) return

        const movedIds = new Set(moved.map((s) => s.id))
        const nextSessions = {...sessions}
        delete nextSessions[from]
        nextSessions[to] = [...moved, ...(sessions[to] ?? []).filter((s) => !movedIds.has(s.id))]
        set(sessionsByAppAtom, nextSessions)

        // Resolve the source's open set through the pre-upgrade fallback (everything open).
        const movedOpen = currentOpenIds(get, from)
        const open = get(openIdsByAppAtom)
        const nextOpen = {...open}
        delete nextOpen[from]
        nextOpen[to] = [...movedOpen, ...(open[to] ?? []).filter((id) => !movedOpen.includes(id))]
        set(openIdsByAppAtom, nextOpen)

        const active = get(activeByAppAtom)
        const nextActive = {...active}
        delete nextActive[from]
        if (active[from]) nextActive[to] = active[from]
        set(activeByAppAtom, nextActive)
    },
)

/**
 * Wipe a whole scope clean: drop its session history, open tabs, active id, and every message
 * belonging to those sessions. Used to guarantee a fresh start for a surface that reuses a FIXED
 * scope key across visits (the onboarding playground) — otherwise a prior visit's stale or failed
 * conversation persists under the same key and gets restored on the next entry. Idempotent: a no-op
 * on an already-empty scope.
 */
export const resetScopeAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set) => {
        const sessions = get(sessionsByAppAtom)
        const ids = (sessions[key] ?? []).map((s) => s.id)

        if (key in sessions) {
            const next = {...sessions}
            delete next[key]
            set(sessionsByAppAtom, next)
        }
        const open = get(openIdsByAppAtom)
        if (key in open) {
            const next = {...open}
            delete next[key]
            set(openIdsByAppAtom, next)
        }
        const active = get(activeByAppAtom)
        if (key in active) {
            const next = {...active}
            delete next[key]
            set(activeByAppAtom, next)
        }
        if (ids.length) {
            const messages = {...get(sessionMessagesAtom)}
            let changed = false
            for (const id of ids) {
                if (id in messages) {
                    delete messages[id]
                    changed = true
                }
                clearSessionEphemera(id)
            }
            if (changed) set(sessionMessagesAtom, messages)
        }
    }),
)

export const renameSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, {id, title}: {id: string; title: string}) => {
        const all = get(sessionsByAppAtom)
        const list = (all[key] ?? []).map((s) =>
            s.id === id ? {...s, title: title.trim() || undefined} : s,
        )
        set(sessionsByAppAtom, {...all, [key]: list})

        // Persist the title to the durable stream header so it syncs across devices and survives a
        // localStorage wipe. Best-effort/optimistic — the local update above already shows it. Send
        // the trimmed string (empty clears the server name too, since the header merge is partial).
        const projectId = get(projectIdAtom)
        if (projectId) void setSessionHeader({sessionId: id, projectId, name: title.trim()})
    }),
)

export const setActiveSessionAtomFamily = atomFamily((key: string) =>
    atom(null, (get, set, id: string) => {
        set(activeByAppAtom, {...get(activeByAppAtom), [key]: id})
    }),
)

/** A localStorage-full error, across browsers (Chrome/Safari code 22, Firefox 1014). */
const isQuotaExceeded = (e: unknown): boolean =>
    e instanceof DOMException &&
    (e.code === 22 ||
        e.code === 1014 ||
        e.name === "QuotaExceededError" ||
        e.name === "NS_ERROR_DOM_QUOTA_REACHED")

/**
 * Persist the messages store, degrading gracefully when it overflows the ~5MB localStorage quota
 * (large inline `data:` attachments make this reachable — see the file header note). On overflow we
 * shed OTHER sessions' persisted messages, oldest-first, and retry, so the active conversation
 * (`keepId`) still persists and the panel never crashes on a full store. Evicted sessions are
 * closed/history and re-hydrate from the server when reopened.
 */
const writeMessagesWithQuotaGuard = (
    set: Setter,
    next: Record<string, UIMessage[]>,
    keepId: string,
): void => {
    let candidate = next
    for (;;) {
        try {
            set(sessionMessagesAtom, candidate)
            return
        } catch (e) {
            if (!isQuotaExceeded(e)) throw e
            // Object keys keep insertion order, so the first non-active id is the oldest.
            const oldest = Object.keys(candidate).find((k) => k !== keepId)
            if (oldest === undefined) {
                // Even the active session alone won't fit — keep it in memory, skip persistence.
                console.warn("[agent-chat] message store over quota; skipping persistence")
                return
            }
            candidate = {...candidate}
            delete candidate[oldest]
        }
    }
}

/** Write a session's messages to the persisted store (called when its stream settles). */
export const persistSessionMessagesAtom = atom(
    null,
    (get, set, {id, messages}: {id: string; messages: UIMessage[]}) => {
        writeMessagesWithQuotaGuard(set, {...get(sessionMessagesAtom), [id]: messages}, id)
    },
)

/** Per-message first-seen timestamp (ms), keyed by message id — an in-memory FALLBACK only. The
 * authoritative time is the turn's trace `start_time`; this just covers turns with no trace yet (e.g.
 * a just-sent user message). Deliberately NOT persisted: it's transient UI state, so keeping it out
 * of localStorage avoids an unbounded, lifecycle-unmanaged store (no per-delete pruning to maintain).
 */
export const messageCreatedAtMapAtom = atom<Record<string, number>>({})

/** One message's stamped timestamp; a row repaints only when ITS id is stamped, not on every stamp. */
export const messageCreatedAtAtomFamily = atomFamily((id: string) =>
    selectAtom(messageCreatedAtMapAtom, (map) => map[id]),
)

/** Stamp `now` on any of the given message ids not yet recorded (their first appearance). */
export const stampMessagesCreatedAtAtom = atom(null, (get, set, ids: string[]) => {
    const map = get(messageCreatedAtMapAtom)
    const missing = ids.filter((id) => !(id in map))
    if (missing.length === 0) return
    const now = Date.now()
    set(messageCreatedAtMapAtom, {
        ...map,
        ...Object.fromEntries(missing.map((id) => [id, now])),
    })
})

/** Compact "just now / 2m / 3h / 5d ago" stamp; empty for pre-upgrade sessions (no createdAt). */
export const timeAgo = (ts?: number): string => {
    if (!ts) return ""
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
    if (s < 60) return "just now"
    const m = Math.round(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.round(m / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.round(h / 24)}d ago`
}

/** A coarse clock that ticks once a minute WHILE subscribed, so relative "Xm ago" stamps refresh
 * on their own. One shared interval (started on first subscribe, cleared on last unsubscribe)
 * instead of one per timestamp. */
export const nowTickAtom = atom(Date.now())
nowTickAtom.onMount = (setSelf) => {
    const id = setInterval(() => setSelf(Date.now()), 60_000)
    return () => clearInterval(id)
}

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

/**
 * Run state of a session's live conversation — the single source of truth for "what is this
 * session doing right now", surfaced as the tab bar's status dot AND the session inspector's
 * live-watcher signal (see `isSessionStreamingAtomFamily`).
 *  - running:  a turn is streaming / submitted
 *  - awaiting: paused on a human-in-the-loop approval
 *  - error:    the last run failed
 *  - idle:     nothing in flight (also the default for unvisited / closed sessions)
 */
export type SessionRunStatus = "idle" | "running" | "awaiting" | "error"

/**
 * Canonical per-session run state, keyed by the globally-unique session id (no scope dimension).
 * Written by the mounted conversation (from its useChat status / approval / error); everything
 * status-related derives from this one record so there's no competing streaming flag to keep in
 * sync. In-memory only (not persisted): it describes the current browser tab, not history.
 */
const sessionStatusByIdAtom = atom<Record<string, SessionRunStatus>>({})

/** A single session's run state. Defaults to "idle" for sessions with no mounted conversation.
 * Backs the tab bar's status dot; reads repaint only when this session's status changes. */
export const sessionStatusAtomFamily = atomFamily((id: string) =>
    atom((get) => get(sessionStatusByIdAtom)[id] ?? "idle"),
)

/**
 * Is THIS browser currently streaming the given session? Derived from the run state (`running`).
 * The session inspector reads it to know THIS client is the live watcher of a session — that's
 * what drives the inspector's Attach/Detach enablement and the `attached` indicator, since an
 * inline chat run streams over the runner NDJSON, not the coordination-plane attach.
 */
export const isSessionStreamingAtomFamily = atomFamily((id: string) =>
    atom((get) => get(sessionStatusByIdAtom)[id] === "running"),
)

/** Set a session's run state. "idle" is the default, so it's stored as ABSENCE: passing "idle"
 * deletes the entry (clear-on-unmount) instead of accumulating idle keys for every closed session. */
export const setSessionStatusAtom = atom(
    null,
    (get, set, {id, status}: {id: string; status: SessionRunStatus}) => {
        const cur = get(sessionStatusByIdAtom)
        if (status === "idle") {
            if (!(id in cur)) return
            const next = {...cur}
            delete next[id]
            set(sessionStatusByIdAtom, next)
            return
        }
        if (cur[id] === status) return
        set(sessionStatusByIdAtom, {...cur, [id]: status})
    },
)
