import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

/**
 * When the in-flight turn started, for the sessions whose startup is being narrated (#6047).
 *
 * An entry existing IS the decision to narrate — the caller starts a clock only for a turn it
 * judged cold, so nothing downstream re-derives that. Which also means a warm turn has to CLEAR
 * rather than merely skip: an entry the previous turn left behind would otherwise narrate this one
 * off a stale start time.
 *
 * In-memory and turn-scoped. Every settle path (answer, error, stop) clears it, which is what stops
 * a failed or cancelled run from stranding a startup label on screen.
 */

/** The map IS the source of truth, and keeps the key set enumerable. */
const turnStartMapAtom = atom<Record<string, number>>({})

/** Scoped read: a session's indicator re-renders only when ITS turn starts or settles. */
export const turnStartAtomFamily = atomFamily((sessionId: string) =>
    selectAtom(turnStartMapAtom, (m): number | undefined => m[sessionId]),
)

/**
 * Start the clock, replacing any entry left over from the last turn.
 *
 * Deliberately unconditional. The caller fires this only on the `submitted` edge — the one status a
 * new send always crosses — so "a turn is beginning" is decided there, not here. An earlier version
 * bailed out when an entry existed, which made a fresh turn inherit the previous turn's start
 * whenever a settle wasn't observed (React batches a resume's ready → submitted into one render),
 * and the new turn opened on its final phase.
 */
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
