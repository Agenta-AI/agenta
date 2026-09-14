import {atom, useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomFamily} from "jotai-family"

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

/** The latest observed startup label for a session, or null when no turn is being narrated. */
export const useStartupPhase = (sessionId: string): string | null =>
    useAtomValue(turnStartAtomFamily(sessionId)) ?? null

/**
 * How long each turn worked, measured on this client: the fold's collapsed line counts up while
 * the turn is live and freezes when it settles. Only turns streamed in this session have one — a
 * turn loaded from history never started a clock here.
 */
interface TurnSpan {
    startedAt: number
    endedAt?: number
}

const turnSpanMapAtom = atom<Record<string, TurnSpan>>({})

export const turnSpanAtomFamily = atomFamily((messageId: string) =>
    selectAtom(turnSpanMapAtom, (m): TurnSpan | undefined => m[messageId]),
)

/**
 * Start the clock, or resume a paused one. Resuming shifts the start forward by the pause, so
 * the count is working time only: a gate the reader sat on for a week adds nothing to it.
 */
export const startTurnSpanAtom = atom(null, (get, set, messageId: string) => {
    const current = get(turnSpanMapAtom)
    const span = current[messageId]
    if (span && !span.endedAt) return
    const now = Date.now()
    const startedAt = span?.endedAt ? span.startedAt + (now - span.endedAt) : now
    set(turnSpanMapAtom, {...current, [messageId]: {startedAt}})
})

/** Freeze the clock — on settle, or while the run is parked on the reader. A clock never
 * started stays absent: nothing to freeze. */
export const settleTurnSpanAtom = atom(null, (get, set, messageId: string) => {
    const current = get(turnSpanMapAtom)
    const span = current[messageId]
    if (!span || span.endedAt) return
    set(turnSpanMapAtom, {...current, [messageId]: {...span, endedAt: Date.now()}})
})
