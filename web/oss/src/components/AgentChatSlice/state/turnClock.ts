import {atom} from "jotai"
import {atomFamily, selectAtom} from "jotai/utils"

/**
 * Current startup label for sessions whose startup is being narrated (#6047).
 *
 * An entry existing IS the decision to narrate, so a warm turn must CLEAR rather than merely skip:
 * an entry the last turn left behind would otherwise narrate this one off a stale start.
 */

/** The map is the source of truth and keeps the key set enumerable. */
const turnStartMapAtom = atom<Record<string, string>>({})

/** Scoped read: a session's indicator re-renders only when ITS turn starts or settles. */
export const turnStartAtomFamily = atomFamily((sessionId: string) =>
    selectAtom(turnStartMapAtom, (m): string | undefined => m[sessionId]),
)

/** Always replaces so a runner event advances the visible label immediately. */
export const startTurnClockAtom = atom(null, (get, set, sessionId: string, label: string) => {
    set(turnStartMapAtom, {...get(turnStartMapAtom), [sessionId]: label})
})

/** Clear the label. Every settle path calls this, and several can race. */
export const clearTurnClockAtom = atom(null, (get, set, sessionId: string) => {
    const current = get(turnStartMapAtom)
    if (!(sessionId in current)) return
    const next = {...current}
    delete next[sessionId]
    set(turnStartMapAtom, next)
})
