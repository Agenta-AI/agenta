import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

/**
 * When the in-flight turn started, for the sessions whose startup is being narrated (#6047).
 *
 * An entry existing IS the decision to narrate, so a warm turn must CLEAR rather than merely skip:
 * an entry the last turn left behind would otherwise narrate this one off a stale start.
 */

/** The map IS the source of truth, and keeps the key set enumerable. */
const turnStartMapAtom = atom<Record<string, number>>({})

/** Scoped read: a session's indicator re-renders only when ITS turn starts or settles. */
export const turnStartAtomFamily = atomFamily((sessionId: string) =>
    selectAtom(turnStartMapAtom, (m): number | undefined => m[sessionId]),
)

/** Always replaces — the caller fires it only on the `submitted` edge, so a new turn can never
 * inherit the last one's start (React batches a resume's ready → submitted into one render). */
export const startTurnClockAtom = atom(null, (get, set, sessionId: string) => {
    set(turnStartMapAtom, {...get(turnStartMapAtom), [sessionId]: Date.now()})
})

/** Stop the clock. Idempotent — every settle path calls it, and several can race. */
export const clearTurnClockAtom = atom(null, (get, set, sessionId: string) => {
    const current = get(turnStartMapAtom)
    if (!(sessionId in current)) return
    const next = {...current}
    delete next[sessionId]
    set(turnStartMapAtom, next)
})
