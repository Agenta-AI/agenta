import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

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
