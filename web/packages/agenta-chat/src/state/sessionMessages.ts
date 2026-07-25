// Copied from web/oss/src/components/AgentChatSlice/state/sessions.ts (2026-07-25) — ONLY the
// self-contained message-persistence and run-status pieces the conversation host needs
// (`sessionMessagesAtom`, the quota-guarded persist writer, and the per-session run-status
// store). The OSS original remains authoritative for the desktop chat until the re-plumb PR
// deletes it; keep byte-parity on the copied blocks if either side changes. The rest of that
// file (scope-keyed history/tabs, server reconciliation, archive/delete remotes, timestamps)
// is app-layer session-LIST state and stays out of the package deliberately.
import type {UIMessage} from "ai"
import {atom, type Setter} from "jotai"
import {atomFamily, atomWithStorage} from "jotai/utils"

import type {SessionRunStatus} from "../model/sessionStatus"

// `getOnInit: true` — read localStorage synchronously on init. Without it the atom starts as
// the empty default `{}` on every mount and only hydrates afterwards, so a mount-time seed
// read would see an empty store on every reload.
const STORAGE_OPTS = {getOnInit: true} as const

/** Persisted messages per session id. Written when a conversation's stream settles. Session ids
 * are globally unique, so this store has no scope dimension. */
export const sessionMessagesAtom = atomWithStorage<Record<string, UIMessage[]>>(
    "agenta:agent-chat:messages",
    {},
    undefined,
    STORAGE_OPTS,
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
 * (large inline `data:` attachments make this reachable). On overflow we shed OTHER sessions'
 * persisted messages, oldest-first, and retry, so the active conversation (`keepId`) still
 * persists and the panel never crashes on a full store. Evicted sessions are closed/history and
 * re-hydrate from the server when reopened.
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

/**
 * Canonical per-session run state, keyed by the globally-unique session id (no scope dimension).
 * Written by the mounted conversation (from its useChat status / approval / error); everything
 * status-related derives from this one record so there's no competing streaming flag to keep in
 * sync. In-memory only (not persisted): it describes the current browser tab, not history.
 */
const sessionStatusByIdAtom = atom<Record<string, SessionRunStatus>>({})

/** A single session's run state. Defaults to "idle" for sessions with no mounted conversation.
 * Backs a session list's status dot; reads repaint only when this session's status changes. */
export const sessionStatusAtomFamily = atomFamily((id: string) =>
    atom((get) => get(sessionStatusByIdAtom)[id] ?? "idle"),
)

/** Is THIS browser currently streaming the given session? Derived from the run state. */
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
