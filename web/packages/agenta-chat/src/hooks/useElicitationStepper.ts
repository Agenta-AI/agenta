/**
 * The answer state for one docked question form: which step is showing, what has been answered,
 * what blocks the next step, and the auto-advance timer.
 *
 * Deliberately NOT built on antd `Form` / `@rc-component/form`, for three reasons. This package is
 * contract-tested antd-free (tests/unit/package.test.ts) so /m can ship it. The old inline card's
 * two whole-tree `useWatch([])` subscriptions — one in the widget, one in `SchemaForm` — re-rendered
 * everything on every keystroke, which was a named cause of the jitter this redesign exists to fix.
 * And the flat dialect shows one control at a time with one rule set, so the reducer is smaller than
 * the adapter would be.
 *
 * Split from `useElicitationDock` (which owns WHICH call is parked) so the answer logic is testable
 * with `renderHook` and no DOM.
 */
import {useCallback, useEffect, useMemo, useReducer, useRef} from "react"

import {
    collectStepContent,
    initialStepValues,
    isStepAnswered,
    validateStep,
    type ElicitationForm,
    type ElicitationStep,
} from "@agenta/shared/utils"

/** How long a picked option sits visible before the card advances. */
export const AUTO_ADVANCE_MS = 900

const DRAFT_PREFIX = "agenta:elicitation-draft:"
const DRAFT_DEBOUNCE_MS = 400

interface Draft {
    values: Record<string, unknown>
    /** Without this a reload turns a skipped default back into an answer and sends it. */
    skipped?: string[]
    /** Restoring the VALUES but not the place would drop the user back at question one. */
    index: number
}

const readDraft = (toolCallId: string, steps: ElicitationStep[]): Draft | null => {
    try {
        const raw = window.localStorage?.getItem(DRAFT_PREFIX + toolCallId)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<Draft>
        const values = parsed?.values
        if (typeof values !== "object" || values === null || Array.isArray(values)) return null
        // Tolerate a schema that moved on: keep only keys this form still asks about, and clamp the
        // place. A stale draft should degrade to "some answers survived", never to a crash.
        const names = new Set(steps.map((step) => step.name))
        const kept = Object.fromEntries(Object.entries(values).filter(([name]) => names.has(name)))
        const skipped = Array.isArray(parsed.skipped)
            ? parsed.skipped.filter((name): name is string => names.has(name))
            : []
        // Skips count as content: a draft whose only news is "the user declined these" still has
        // something to restore, and dropping it resurrects the defaults they declined.
        if (Object.keys(kept).length === 0 && !skipped.length) return null
        const index = typeof parsed.index === "number" ? parsed.index : 0
        // Clamp to the real last screen, not to `steps.length`: a schema that shrank to one
        // question has no review to land on, and an index past its only step renders neither the
        // question nor the review while `primary()` happily completes.
        const last = steps.length > 1 ? steps.length : Math.max(steps.length - 1, 0)
        return {values: kept, skipped, index: Math.max(0, Math.min(index, last))}
    } catch {
        return null
    }
}

const writeDraft = (toolCallId: string, draft: Draft): void => {
    try {
        window.localStorage?.setItem(DRAFT_PREFIX + toolCallId, JSON.stringify(draft))
    } catch {
        // Private mode, quota, no storage at all — a lost draft must never break the form.
    }
}

const clearDraft = (toolCallId: string): void => {
    try {
        window.localStorage?.removeItem(DRAFT_PREFIX + toolCallId)
    } catch {
        // as above
    }
}

interface State {
    index: number
    values: Record<string, unknown>
    /** Explicitly skipped, which is not the same as "not answered yet" — it clears any default. */
    skipped: string[]
    error: string | null
    /** The "Picked Blue" line shown while the auto-advance timer runs. The sequence restarts the
     * timer when the same option is picked twice — the label alone would not change. */
    hold: {label: string; seq: number} | null
    /** Highlighted row on an enum/boolean step, for ↑ ↓ ↵. */
    cursor: number
}

type Action =
    | {type: "goTo"; index: number}
    | {type: "setValue"; name: string; value: unknown}
    | {type: "setCursor"; cursor: number}
    | {
          type: "pick"
          name: string
          value: unknown
          label: string
          cursor: number
          /** Advance now instead of holding — a digit or Enter. */
          immediate: boolean
          lastIndex: number
      }
    | {type: "cancelHold"}
    | {type: "error"; error: string}
    | {type: "toggle"; name: string; option: string}
    | {type: "skip"; name: string}
    | {type: "restore"; values: Record<string, unknown>; skipped: string[]; index: number}

const reducer = (state: State, action: Action): State => {
    switch (action.type) {
        case "goTo":
            return {...state, index: action.index, error: null, hold: null, cursor: 0}
        case "setValue":
            return {
                ...state,
                values: {...state.values, [action.name]: action.value},
                skipped: state.skipped.filter((name) => name !== action.name),
                error: null,
                hold: null,
            }
        case "setCursor":
            return {...state, cursor: action.cursor, hold: null}
        // ONE action, not a setValue + hold pair: the hold's sequence is what restarts the
        // auto-advance timer, and a separate setValue in between nulls it and freezes the seq at 1.
        case "pick": {
            const picked = {
                ...state,
                values: {...state.values, [action.name]: action.value},
                skipped: state.skipped.filter((name) => name !== action.name),
                cursor: action.cursor,
                error: null,
            }
            if (action.immediate)
                return {
                    ...picked,
                    index: Math.min(state.index + 1, action.lastIndex),
                    hold: null,
                    cursor: 0,
                }
            return {...picked, hold: {label: action.label, seq: (state.hold?.seq ?? 0) + 1}}
        }
        // Multi-select never auto-advances: you are still picking, and moving on mid-selection
        // would be exactly the bug the single-select hold exists to avoid.
        case "toggle": {
            const current = Array.isArray(state.values[action.name])
                ? (state.values[action.name] as string[])
                : []
            const next = current.includes(action.option)
                ? current.filter((item) => item !== action.option)
                : [...current, action.option]
            return {
                ...state,
                values: {...state.values, [action.name]: next},
                skipped: state.skipped.filter((name) => name !== action.name),
                error: null,
                hold: null,
            }
        }
        case "cancelHold":
            return state.hold === null ? state : {...state, hold: null}
        case "error":
            return {...state, error: action.error, hold: null}
        case "skip": {
            const values = {...state.values}
            delete values[action.name]
            return {
                ...state,
                values,
                skipped: state.skipped.includes(action.name)
                    ? state.skipped
                    : [...state.skipped, action.name],
                error: null,
                hold: null,
            }
        }
        case "restore":
            return {
                ...state,
                values: {...state.values, ...action.values},
                skipped: action.skipped,
                index: action.index,
            }
        default:
            return state
    }
}

export interface ElicitationStepperState {
    steps: ElicitationStep[]
    /** The showing step, or null on the review screen. */
    step: ElicitationStep | null
    index: number
    /** 1-based, for the `3/5` counter. Clamped so the review screen reads `5/5`. */
    position: number
    total: number
    isReview: boolean
    /**
     * Whether a review screen exists at all. A one-question form goes straight to `Send answers` —
     * a summary of a single answer is noise.
     */
    hasReview: boolean
    /**
     * Whether the form is a sequence at all. A single question has nothing to step through, so the
     * card drops the counter, the nav arrows, the progress rail and the question number.
     */
    isMultiStep: boolean
    values: Record<string, unknown>
    error: string | null
    hold: string | null
    cursor: number
    canGoBack: boolean
    canGoForward: boolean
    answeredCount: number
    skippedCount: number
    /** `Next` / `Review` / `Send answers`, matching where the user is. */
    primaryLabel: string
    /** Answered values keyed by property name — what `accept` sends. */
    content: Record<string, unknown>
    /** Is this step answered? Drives the progress segments. */
    isAnswered: (step: ElicitationStep) => boolean
    setValue: (name: string, value: unknown) => void
    setCursor: (cursor: number) => void
    moveCursor: (delta: number, rowCount: number) => void
    /**
     * Set a value and move on. `immediate` advances now (a digit or Enter — the user meant it and a
     * pause fights fast entry); otherwise the card holds ~900ms showing what it recorded, which is
     * the affordance a misclick needs.
     */
    pick: (name: string, value: unknown, label: string, cursor: number, immediate?: boolean) => void
    /** Add or remove one option on a multi-select. Never advances. */
    toggle: (name: string, option: string) => void
    cancelHold: () => void
    goTo: (index: number) => void
    back: () => void
    forward: () => void
    /** Validate and advance, or complete on the last screen. */
    primary: () => void
    skip: () => void
    /** Drop the saved draft. The dock calls this on every settle path. */
    discardDraft: () => void
}

/** `Next` until the last question, `Review` into the summary, `Send answers` to settle. */
const primaryLabelFor = ({
    index,
    lastIndex,
    hasReview,
    total,
}: {
    index: number
    lastIndex: number
    hasReview: boolean
    total: number
}): string => {
    if (index >= lastIndex) return "Send answers"
    if (hasReview && index === total - 1) return "Review"
    return "Next"
}

export interface UseElicitationStepperArgs {
    form: ElicitationForm
    /** Draft key, and the identity that resets the whole machine when the agent asks again. */
    toolCallId: string
    /** Called by `primary()` on the last screen, with the answered values. */
    onComplete: (content: Record<string, unknown>) => void
}

export const useElicitationStepper = ({
    form,
    toolCallId,
    onComplete,
}: UseElicitationStepperArgs): ElicitationStepperState => {
    const {steps} = form
    const total = steps.length
    // A single question is not a sequence: nothing to step through, and nothing to compare.
    const isMultiStep = total > 1
    // A review screen is worth a step of its own only when there is something to compare.
    const hasReview = isMultiStep
    const lastIndex = hasReview ? total : Math.max(total - 1, 0)

    // Read by the `pick` callback, which must stay identity-stable across steps: closing over
    // `lastIndex` directly would clamp an immediate advance against a stale end-of-form.
    const lastIndexRef = useRef(lastIndex)
    lastIndexRef.current = lastIndex

    const [state, dispatch] = useReducer(reducer, steps, (initial) => {
        const values = initialStepValues(initial)
        // A form the schema already answered opens on its review screen: walking N questions to
        // press Next N times is the one case where stepping costs the user and gives nothing back.
        // Requires a review screen to open onto, so a single-question form is unaffected.
        const settled =
            initial.length > 1 && initial.every((step) => isStepAnswered(step, values[step.name]))
        return {
            index: settled ? initial.length : 0,
            values,
            skipped: [],
            error: null,
            hold: null,
            cursor: 0,
        }
    })

    // Restore once per parked call. Values merge OVER the schema defaults: what the user typed wins.
    const restoredRef = useRef<string | null>(null)
    useEffect(() => {
        if (restoredRef.current === toolCallId) return
        restoredRef.current = toolCallId
        const draft = readDraft(toolCallId, steps)
        if (draft)
            dispatch({
                type: "restore",
                values: draft.values,
                skipped: draft.skipped ?? [],
                index: draft.index,
            })
    }, [toolCallId, steps])

    // Debounced, not per keystroke: a synchronous JSON.stringify + setItem on every character was a
    // named cause of the jitter. Flushed eagerly on unmount so a reload never loses the last word.
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const pendingRef = useRef<Draft | null>(null)
    const flushDraft = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
        if (pendingRef.current) {
            writeDraft(toolCallId, pendingRef.current)
            pendingRef.current = null
        }
    }, [toolCallId])

    useEffect(() => {
        pendingRef.current = {values: state.values, skipped: state.skipped, index: state.index}
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(flushDraft, DRAFT_DEBOUNCE_MS)
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current)
        }
    }, [state.values, state.skipped, state.index, flushDraft])

    useEffect(() => flushDraft, [flushDraft])

    const discardDraft = useCallback(() => {
        pendingRef.current = null
        if (timerRef.current) clearTimeout(timerRef.current)
        clearDraft(toolCallId)
    }, [toolCallId])

    // Auto-advance. Any interaction that dispatches `cancelHold` clears `state.hold`, which tears
    // this effect down before it fires — the hold IS the timer, so there is no second source of truth.
    const holdTargetRef = useRef(state.index)
    holdTargetRef.current = state.index
    useEffect(() => {
        if (state.hold === null) return undefined
        const timer = setTimeout(
            () => dispatch({type: "goTo", index: Math.min(holdTargetRef.current + 1, lastIndex)}),
            AUTO_ADVANCE_MS,
        )
        return () => clearTimeout(timer)
    }, [state.hold?.seq, lastIndex])

    const isReview = hasReview && state.index >= total
    const step = isReview ? null : (steps[state.index] ?? null)

    const isAnswered = useCallback(
        (candidate: ElicitationStep) =>
            !state.skipped.includes(candidate.name) &&
            isStepAnswered(candidate, state.values[candidate.name]),
        [state.skipped, state.values],
    )

    const content = useMemo(
        () =>
            collectStepContent(
                steps.filter((candidate) => !state.skipped.includes(candidate.name)),
                state.values,
            ),
        [steps, state.skipped, state.values],
    )

    const goTo = useCallback(
        (index: number) => dispatch({type: "goTo", index: Math.max(0, Math.min(index, lastIndex))}),
        [lastIndex],
    )

    const primary = useCallback(() => {
        // A skipped step is not an empty answer, it is a declined one: validating it again traps a
        // one-question required form, whose skip has no next step to move to.
        if (step && !state.skipped.includes(step.name)) {
            const blocked = validateStep(step, state.values[step.name])
            if (blocked) {
                dispatch({type: "error", error: blocked})
                return
            }
        }
        if (state.index >= lastIndex) {
            onComplete(content)
            return
        }
        dispatch({type: "goTo", index: state.index + 1})
    }, [step, state.skipped, state.values, state.index, lastIndex, onComplete, content])

    const skip = useCallback(() => {
        if (step) dispatch({type: "skip", name: step.name})
        dispatch({type: "goTo", index: Math.min(state.index + 1, lastIndex)})
    }, [step, state.index, lastIndex])

    const answeredCount = steps.filter(isAnswered).length

    return {
        steps,
        step,
        index: state.index,
        position: Math.min(state.index + 1, Math.max(total, 1)),
        total,
        isReview,
        hasReview,
        isMultiStep,
        values: state.values,
        error: state.error,
        hold: state.hold?.label ?? null,
        cursor: state.cursor,
        canGoBack: state.index > 0,
        canGoForward: state.index < lastIndex,
        answeredCount,
        skippedCount: steps.length - answeredCount,
        primaryLabel: primaryLabelFor({index: state.index, lastIndex, hasReview, total}),
        content,
        isAnswered,
        setValue: useCallback(
            (name: string, value: unknown) => dispatch({type: "setValue", name, value}),
            [],
        ),
        setCursor: useCallback((cursor: number) => dispatch({type: "setCursor", cursor}), []),
        moveCursor: useCallback(
            (delta: number, rowCount: number) => {
                if (rowCount <= 0) return
                const next = (state.cursor + delta + rowCount) % rowCount
                dispatch({type: "setCursor", cursor: next})
            },
            [state.cursor],
        ),
        pick: useCallback(
            (name: string, value: unknown, label: string, cursor: number, immediate = false) =>
                dispatch({
                    type: "pick",
                    name,
                    value,
                    label,
                    cursor,
                    immediate,
                    lastIndex: lastIndexRef.current,
                }),
            [],
        ),
        toggle: useCallback(
            (name: string, option: string) => dispatch({type: "toggle", name, option}),
            [],
        ),
        cancelHold: useCallback(() => dispatch({type: "cancelHold"}), []),
        goTo,
        back: useCallback(() => goTo(state.index - 1), [goTo, state.index]),
        forward: useCallback(() => goTo(state.index + 1), [goTo, state.index]),
        primary,
        skip,
        discardDraft,
    }
}
