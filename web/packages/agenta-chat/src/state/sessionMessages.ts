// Canonical since the desktop re-plumb: OSS's sessions.ts deleted its copied blocks and both
// apps read/write THIS store (localStorage keys `agenta:agent-chat:{messages,record-counts}:v2`).
// The rest of that OSS file (scope-keyed history/tabs, server reconciliation, archive/delete
// remotes, timestamps) is app-layer session-LIST state and stays out of the package deliberately.
// Deletion is exposed as `dropSessionMessagesAtom` so a consumer that forgets a session cannot
// drop the transcript store without its watermark (the two must never diverge).
import type {UIMessage} from "ai"
import {atom, type Getter, type Setter} from "jotai"
import {atomFamily, atomWithStorage, createJSONStorage} from "jotai/utils"

import type {SessionRunStatus} from "../model/sessionStatus"

// `getOnInit: true` — read localStorage synchronously on init. Without it the atom starts as
// the empty default `{}` on every mount and only hydrates afterwards, so a mount-time seed
// read would see an empty store on every reload.
const STORAGE_OPTS = {getOnInit: true} as const

/**
 * localStorage WITHOUT jotai's cross-browser-tab sync. The default storage subscribes to the
 * `storage` event, so a write in one browser tab replaced these records live in every other one —
 * and since the open-tab list drives the antd `Tabs` items, an incoming replacement UNMOUNTED a
 * streaming conversation, orphaning its `useChat` stream mid-turn (the in-flight transcript is not
 * persisted until the stream settles, so it was lost). Each browser tab now owns its view; storage
 * is still shared, so a reload picks up whatever was last written.
 */
const tabLocalStorage = <T>() => {
    const storage = createJSONStorage<T>()
    delete storage.subscribe
    return storage
}

/** Persisted messages per session id. Written when a conversation's stream settles. Session ids
 * are globally unique, so this store has no scope dimension.
 * v2: caches written by the pre-fix mapper hold duplicated approval parts; the key bump forces
 * one re-sync from records (the watermark otherwise keeps the stale copy authoritative). */
export const sessionMessagesAtom = atomWithStorage<Record<string, UIMessage[]>>(
    "agenta:agent-chat:messages:v2",
    {},
    tabLocalStorage(),
    STORAGE_OPTS,
)

/**
 * Per-session adoption watermark: how many durable records the CACHED transcript above was built
 * from. Absent means "not server-derived" (a locally-streamed turn, or a pre-#5530 cache) and reads
 * as 0, so the next open re-syncs from the server once.
 *
 * Private on purpose — it must only ever move together with `sessionMessagesAtom`, so every write
 * goes through `persistSessionMessagesAtom` and every delete through `dropSessionMessagesAtom`.
 */
const sessionRecordCountsAtom = atomWithStorage<Record<string, number>>(
    "agenta:agent-chat:record-counts:v2",
    {},
    tabLocalStorage(),
    STORAGE_OPTS,
)

/** Read-only view of the watermarks; the guards read one non-reactively via `store.get`. */
export const sessionRecordCountsReadAtom = atom((get) => get(sessionRecordCountsAtom))

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
): {evicted: string[]; persisted: boolean} => {
    let candidate = next
    const evicted: string[] = []
    for (;;) {
        try {
            set(sessionMessagesAtom, candidate)
            return {evicted, persisted: true}
        } catch (e) {
            if (!isQuotaExceeded(e)) throw e
            // Object keys keep insertion order, so the first non-active id is the oldest.
            const oldest = Object.keys(candidate).find((k) => k !== keepId)
            if (oldest === undefined) {
                // Even the active session alone won't fit — keep it in memory, skip persistence.
                console.warn("[agent-chat] message store over quota; skipping persistence")
                return {evicted, persisted: false}
            }
            evicted.push(oldest)
            candidate = {...candidate}
            delete candidate[oldest]
        }
    }
}

/**
 * Drop cached transcripts AND their watermarks for `ids` — the two stores must never diverge, or a
 * re-adopted session would be judged against a watermark belonging to a transcript that's gone.
 * The single deletion path for both; every caller that forgets a session routes through here.
 */
const dropSessionMessages = (get: Getter, set: Setter, ids: string[]): void => {
    if (ids.length === 0) return
    const messages = {...get(sessionMessagesAtom)}
    const counts = {...get(sessionRecordCountsAtom)}
    let messagesChanged = false
    let countsChanged = false
    for (const id of ids) {
        if (id in messages) {
            delete messages[id]
            messagesChanged = true
        }
        if (id in counts) {
            delete counts[id]
            countsChanged = true
        }
    }
    if (messagesChanged) set(sessionMessagesAtom, messages)
    if (countsChanged) set(sessionRecordCountsAtom, counts)
}

/** Forget the given sessions' cached transcripts and watermarks together. */
export const dropSessionMessagesAtom = atom(null, (get, set, ids: string[]) => {
    dropSessionMessages(get, set, ids)
})

/**
 * Write a session's messages to the persisted store (called when its stream settles), together with
 * the record watermark the transcript reflects. Pass `recordCount: undefined` for a locally-streamed
 * transcript — we can't know how many records the server logged for it, and clearing the watermark
 * makes the next open re-sync from the durable log rather than trust a stale number.
 */
export const persistSessionMessagesAtom = atom(
    null,
    (
        get,
        set,
        {id, messages, recordCount}: {id: string; messages: UIMessage[]; recordCount?: number},
    ) => {
        const {evicted, persisted} = writeMessagesWithQuotaGuard(
            set,
            {...get(sessionMessagesAtom), [id]: messages},
            id,
        )
        const counts = {...get(sessionRecordCountsAtom)}
        // If the transcript write itself was skipped (a single session over quota), the persisted
        // store still holds the OLD messages — filing the NEW watermark against them would make
        // `shouldAdoptServerTranscript` reject the complete server log as "not newer" on every
        // future open, freezing the stale cache. The stores must never diverge (see
        // `dropSessionMessages`), so drop the watermark and let the next open re-sync.
        if (!persisted || recordCount === undefined) delete counts[id]
        else counts[id] = recordCount
        // A quota eviction dropped those transcripts, so their watermarks go too.
        for (const evictedId of evicted) delete counts[evictedId]
        set(sessionRecordCountsAtom, counts)
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
