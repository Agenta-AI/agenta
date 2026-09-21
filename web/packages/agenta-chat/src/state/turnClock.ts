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

/** How long each turn worked, measured on this client; only turns streamed here have one. */
interface TurnSpan {
    startedAt: number
    endedAt?: number
    /** `startedAt` is the run's own start, not when this tab first clocked the turn. */
    anchored?: boolean
}

const turnSpanMapAtom = atom<Record<string, TurnSpan>>({})

export const turnSpanAtomFamily = atomFamily((messageId: string) =>
    selectAtom(turnSpanMapAtom, (m): TurnSpan | undefined => m[messageId]),
)

/**
 * Start the clock, or resume it with the start shifted by the pause: working time only.
 *
 * `startedAtHint` is when the run actually began, for a turn this tab is meeting mid-flight
 * (#6934: open a tab on a response already in progress and the clock counted from the tab, so
 * it under-reported the wait). It seeds a FIRST span only. A resume must keep shifting by the
 * pause, or the parked time the freeze exists to exclude would be counted back in.
 *
 * A hint in the future, or too far in the past to be this run, is ignored rather than trusted:
 * it would render a negative or absurd clock, and `Date.now()` is wrong by at most the age of
 * this tab's view of the turn.
 */
export const startTurnSpanAtom = atom(
    null,
    (get, set, messageId: string, startedAtHint?: number) => {
        const current = get(turnSpanMapAtom)
        const span = current[messageId]
        const now = Date.now()
        const hint = usableStart(startedAtHint, now)

        if (span && !span.endedAt) {
            // The clock has to start before the hint can arrive — the trace it comes from is
            // fetched, and the reader would otherwise watch a blank where the count belongs. So a
            // late hint back-dates the running span, once, and only backwards: a hint that moved
            // the start forward would rewind a clock the reader is already watching.
            if (span.anchored || hint === undefined || hint >= span.startedAt) return
            set(turnSpanMapAtom, {
                ...current,
                [messageId]: {startedAt: hint, anchored: true},
            })
            return
        }

        if (span?.endedAt) {
            // Resume: shift the start by the pause so parked time stays out of the count.
            set(turnSpanMapAtom, {
                ...current,
                [messageId]: {
                    startedAt: span.startedAt + (now - span.endedAt),
                    ...(span.anchored ? {anchored: true} : {}),
                },
            })
            return
        }

        set(turnSpanMapAtom, {
            ...current,
            [messageId]: hint === undefined ? {startedAt: now} : {startedAt: hint, anchored: true},
        })
    },
)

/** A day is far longer than any run, so a stamp older than that is a clock skew, not a start. */
const MAX_HINT_AGE_MS = 24 * 60 * 60 * 1000

/** The hint, or undefined when it cannot be a start for a run happening now. */
const usableStart = (hint: number | undefined, now: number): number | undefined =>
    typeof hint === "number" &&
    Number.isFinite(hint) &&
    hint <= now &&
    now - hint <= MAX_HINT_AGE_MS
        ? hint
        : undefined

/** Freeze the clock on settle or while parked on the reader; one never started stays absent. */
export const settleTurnSpanAtom = atom(null, (get, set, messageId: string) => {
    const current = get(turnSpanMapAtom)
    const span = current[messageId]
    if (!span || span.endedAt) return
    set(turnSpanMapAtom, {...current, [messageId]: {...span, endedAt: Date.now()}})
})
