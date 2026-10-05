import {atom, useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"
import {atomFamily} from "jotai-family"

import type {TurnStage} from "../assets/startupPhases"

/**
 * The stage of the turn each session is waiting on (#6047): a send on its way, an admitted turn,
 * or a runner startup phase. The line before the first step narrates it.
 *
 * Each send that opens a turn replaces the entry with `sending`, so a stage the last turn left
 * behind never narrates this one.
 */

/** The map is the source of truth and keeps the key set enumerable. */
const turnStartMapAtom = atom<Record<string, TurnStage>>({})

/** When each session's current stage began, so its words rotate on the clock, not per mount. */
const turnStageSinceMapAtom = atom<Record<string, number>>({})

export const turnStageSinceAtomFamily = atomFamily((sessionId: string) =>
    selectAtom(turnStageSinceMapAtom, (m): number | undefined => m[sessionId]),
)

/** Scoped read: a session's indicator re-renders only when ITS turn starts or settles. */
export const turnStartAtomFamily = atomFamily((sessionId: string) =>
    selectAtom(turnStartMapAtom, (m): TurnStage | undefined => m[sessionId]),
)

/**
 * Always replaces, so a runner event advances the visible words immediately. `started` only
 * advances a `sending` entry: it must never rewind a startup phase that arrived first.
 */
export const startTurnClockAtom = atom(null, (get, set, sessionId: string, stage: TurnStage) => {
    const current = get(turnStartMapAtom)
    if (stage === "started" && current[sessionId] !== "sending") return
    if (current[sessionId] === stage) return
    set(turnStartMapAtom, {...current, [sessionId]: stage})
    set(turnStageSinceMapAtom, {...get(turnStageSinceMapAtom), [sessionId]: Date.now()})
})

/** Clear the label. Every settle path calls this, and several can race. */
export const clearTurnClockAtom = atom(null, (get, set, sessionId: string) => {
    const current = get(turnStartMapAtom)
    if (!(sessionId in current)) return
    const next = {...current}
    delete next[sessionId]
    set(turnStartMapAtom, next)
    const since = {...get(turnStageSinceMapAtom)}
    delete since[sessionId]
    set(turnStageSinceMapAtom, since)
})

/** The stage of the turn a session is waiting on, or null when this tab is narrating none. */
export const useTurnStage = (sessionId: string): TurnStage | null =>
    useAtomValue(turnStartAtomFamily(sessionId)) ?? null

/** When the session's current stage began, or null when this tab is narrating none. */
export const useTurnStageSince = (sessionId: string): number | null =>
    useAtomValue(turnStageSinceAtomFamily(sessionId)) ?? null

/**
 * How long each turn worked, measured on this client; only turns streamed here have one.
 *
 * `startedAt` and `pausedMs` are kept apart on purpose. One says when the work began, the other
 * how long it sat parked on the reader. Folding the pause into the start (as this once did) makes
 * the two inseparable afterwards, so a run start that arrives late — the trace resolves a beat
 * after the clock has to start — cannot be applied without discarding the pauses already counted.
 */
interface TurnSpan {
    /** When the work began: the run's own start once anchored, else when this tab first clocked it. */
    startedAt: number
    /** Total time parked on the reader, excluded from the count. */
    pausedMs: number
    endedAt?: number
    /** `startedAt` is the run's own start, not when this tab first clocked the turn. */
    anchored?: boolean
}

const turnSpanMapAtom = atom<Record<string, TurnSpan>>({})

export const turnSpanAtomFamily = atomFamily((messageId: string) =>
    selectAtom(turnSpanMapAtom, (m): TurnSpan | undefined => m[messageId]),
)

/** The working time a span describes, with parked time taken out. */
export const turnSpanElapsed = (span: TurnSpan, now: number): number =>
    Math.max(0, (span.endedAt ?? now) - span.startedAt - span.pausedMs)

/**
 * Start the clock, resume it after a pause, or anchor it to the run's own start.
 *
 * `startedAtHint` is when the run actually began, for a turn this tab is meeting mid-flight
 * (#6934: open a tab on a response already in progress and the clock counted from the tab, so it
 * under-reported the wait). The hint arrives a beat late, because the trace it comes from is
 * fetched — so it anchors whenever it turns up, running or resuming, and only ever backwards: a
 * hint that moved the start forward would rewind a clock the reader is already watching.
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

        if (!span) {
            set(turnSpanMapAtom, {
                ...current,
                [messageId]:
                    hint === undefined
                        ? {startedAt: now, pausedMs: 0}
                        : {startedAt: hint, pausedMs: 0, anchored: true},
            })
            return
        }

        // Anchoring and resuming are independent now: a span can take the run's start whether it
        // is running or coming back from a pause, and the pause it served is still excluded.
        const anchors = !span.anchored && hint !== undefined && hint < span.startedAt
        const pausedMs = span.endedAt ? span.pausedMs + (now - span.endedAt) : span.pausedMs
        if (!anchors && !span.endedAt) return

        set(turnSpanMapAtom, {
            ...current,
            [messageId]: {
                startedAt: anchors ? hint : span.startedAt,
                pausedMs,
                ...(span.anchored || anchors ? {anchored: true} : {}),
            },
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
