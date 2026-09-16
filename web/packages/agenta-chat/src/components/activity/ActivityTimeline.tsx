import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {HeightCollapse} from "@agenta/ui"
import {CaretRight, FileText} from "@phosphor-icons/react"
import type {ToolUIPart} from "ai"
import {useAtomValue, useSetAtom} from "jotai"
import {useReducedMotion} from "motion/react"

import {useHeldFor} from "../../hooks/useHeldFor"
import {useRevealed} from "../../hooks/useRevealed"
import {formatElapsed, useTurnClock} from "../../hooks/useTurnClock"
import {activityFiles, currentStep, hasLiveStep, partToolName, type ActivityStep} from "../../model"
import {resolveToolDisplay} from "../../skin"
import {activityFoldKey, expandedValueAtomFamily, setExpandedAtom} from "../../state"
import {useStartupPhase} from "../../state/turnClock"
import RevealCollapse from "../RevealCollapse"

import {ActivityClientStep} from "./ActivityClientStep"
import {LIVE_TEXT_CLASS, WaitingGlyph, type WaitingKind} from "./activityIcons"
import {ActivityThoughtStep} from "./ActivityThoughtStep"
import {ActivityToolStep} from "./ActivityToolStep"

const ROW_PX = 22
const STEP_ENTER_MS = 360

const SWAP_MS = 150
const SWAP_EASE = "ease-in-out"
const SWAP_Y = 4
const SWAP_BLUR = 2

/** The live line: a verb change lifts the old words out (up, fade, blur), swaps, then settles the
 * new ones in from just below while the box eases to their width. A change that lands mid-swap
 * waits for it, so the outgoing words always finish leaving. */
const SwapLabel = ({
    text,
    suffix = "",
    shimmer,
}: {
    text: string
    /** The clock, riding inside the eased box; tabular digits keep a tick from moving anything. */
    suffix?: string
    shimmer: boolean
}) => {
    const reduced = useReducedMotion()
    const [shown, setShown] = useState(text)
    // Bumped per swap so the enter runs even when the words end up the same as before.
    const [swapCount, setSwapCount] = useState(0)
    const targetRef = useRef(text)
    const busyRef = useRef(false)
    const boxRef = useRef<HTMLSpanElement>(null)
    const wordsRef = useRef<HTMLSpanElement>(null)
    const enterRef = useRef(false)
    const exitRef = useRef<Animation | null>(null)

    // Exit the current words; the enter runs from the layout effect once the new ones are laid out.
    const swap = () => {
        const words = wordsRef.current
        const box = boxRef.current
        if (!words || !box || typeof words.animate !== "function") {
            setShown(targetRef.current)
            return
        }
        busyRef.current = true
        box.style.width = `${box.offsetWidth}px`
        const exit = words.animate(
            [
                {transform: "translateY(0)", opacity: 1, filter: "blur(0)"},
                {transform: `translateY(-${SWAP_Y}px)`, opacity: 0, filter: `blur(${SWAP_BLUR}px)`},
            ],
            {duration: SWAP_MS, easing: SWAP_EASE, fill: "forwards"},
        )
        exitRef.current = exit
        exit.finished
            .then(() => {
                enterRef.current = true
                setShown(targetRef.current)
                setSwapCount((count) => count + 1)
            })
            .catch(() => undefined)
    }

    useLayoutEffect(() => {
        targetRef.current = text
        if (text === shown || busyRef.current) return
        if (reduced) {
            setShown(text)
            return
        }
        swap()
    }, [text, shown, reduced])

    // The new words are in the DOM: ease the box to their width and settle them in from below.
    useLayoutEffect(() => {
        const words = wordsRef.current
        const box = boxRef.current
        if (!enterRef.current || !words || !box) return
        enterRef.current = false
        // The held exit frame hands over to the enter in the same paint.
        exitRef.current?.cancel()
        exitRef.current = null
        const before = parseFloat(box.style.width)
        box.style.width = ""
        const after = box.offsetWidth
        if (before && before !== after) {
            box.style.width = `${after}px`
            box.animate([{width: `${before}px`}, {width: `${after}px`}], {
                duration: SWAP_MS,
                easing: SWAP_EASE,
            })
        }
        const enter = words.animate(
            [
                {transform: `translateY(${SWAP_Y}px)`, opacity: 0, filter: `blur(${SWAP_BLUR}px)`},
                {transform: "translateY(0)", opacity: 1, filter: "blur(0)"},
            ],
            {duration: SWAP_MS, easing: SWAP_EASE},
        )
        enter.finished
            .then(() => {
                box.style.width = ""
                busyRef.current = false
                // Something else arrived while we were swapping: go again.
                if (targetRef.current !== shown) swap()
            })
            .catch(() => undefined)
    }, [shown, swapCount])

    return (
        <span
            ref={boxRef}
            className="flex max-w-[min(60vw,28ch)] shrink-0 items-center overflow-hidden"
            style={{height: ROW_PX}}
            aria-live="polite"
            title={text}
        >
            <span
                ref={wordsRef}
                className={`block min-w-0 truncate ${shimmer ? LIVE_TEXT_CLASS : ""}`}
                style={{height: ROW_PX, lineHeight: `${ROW_PX}px`}}
            >
                {shown}
            </span>
            {/* `pre`: the leading space would otherwise collapse at the flex item's start. */}
            <span className="shrink-0 whitespace-pre text-colorTextTertiary tabular-nums">
                {suffix}
            </span>
        </span>
    )
}

/** A step arriving live unfolds in (height, rise, fade); the gap is its own padding so it unfolds too. */
const StepReveal = ({
    animate,
    first,
    children,
}: {
    animate: boolean
    first: boolean
    children: ReactNode
}) => {
    const shown = useRevealed(animate)
    return (
        <HeightCollapse open={shown} animate={animate} durationMs={STEP_ENTER_MS} slideY={6}>
            <div
                className={`transition-opacity duration-[360ms] ease-out ${first ? "" : "pt-4.5"} ${
                    shown ? "opacity-100" : "opacity-0"
                }`}
            >
                {children}
            </div>
        </HeightCollapse>
    )
}

/** What the run is parked on, by the last step still open: a gate, or a client tool's ask. */
const waitingKind = (steps: ActivityStep[]): WaitingKind => {
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i]
        if (step.kind === "thought") continue
        const state = step.part.state as string
        if (state.startsWith("output-")) continue
        if (step.kind === "client") {
            const {icon} = resolveToolDisplay(partToolName(step.part))
            return icon === "ask" || icon === "connect" || icon === "secret" ? icon : "approval"
        }
        if (state === "approval-requested") return "approval"
    }
    return "approval"
}

/** The last step of the agent's own: a settled ask's verb must not hold the line. */
const lastAgentStep = (steps: ActivityStep[]): ActivityStep | null => {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].kind !== "client") return steps[i]
    return null
}

/** How long a settled step's verb bridges the gap before the line reads "Working". */
const VERB_HOLD_MS = 2500

/** What the collapsed line narrates for a step, or before any step. */
const liveVerb = (
    step: ActivityStep | null,
    startupLabel: string | null,
    firstTurn: boolean,
): string => {
    // Only the session's first turn boots anything worth narrating.
    if (!step) return firstTurn ? startupLabel || "Waking up the agent" : "Working"
    if (step.kind === "thought") return step.source === "text" ? "Writing" : "Thinking"
    const part = step.part
    if ((part.state as string) === "approval-requested") return "Waiting for your approval"
    return resolveToolDisplay(partToolName(part), (part as {input?: unknown}).input).activity
        .running
}

export interface ActivityTimelineProps {
    messageId: string
    /** Keys the clock and the fold's open state; a host passes `runKey` so the placeholder's carry over. */
    clockId?: string
    steps: ActivityStep[]
    /** This turn is the one being generated. */
    streaming: boolean
    /** The answer has begun: the fold settles even though the turn is still streaming. */
    answerStarted: boolean
    /** The session whose startup narration the line reads until the first step. */
    sessionId?: string
    /** The session's first turn, the only one that narrates the startup phases. */
    firstTurn?: boolean
    /** The run is parked on the reader (a question, a connect). */
    waitingOnUser?: boolean
    /** The turn's trace: once settled, its duration outranks the local count. */
    traceId?: string | null
    /** Renders a client tool's widget in its step; absent on a read-only host. */
    renderClientTool?: (part: ToolUIPart) => ReactNode
}

/** The turn's work, folded: a live verb or "Worked for 11s" over a timeline of steps. */
export const ActivityTimeline = ({
    messageId,
    clockId = messageId,
    steps,
    streaming,
    answerStarted,
    sessionId,
    waitingOnUser = false,
    traceId,
    firstTurn = false,
    renderClientTool,
}: ActivityTimelineProps) => {
    const startupLabel = useStartupPhase(streaming && firstTurn && sessionId ? sessionId : "")
    const current = currentStep(steps)
    const awaiting =
        waitingOnUser ||
        (current?.kind === "tool" && (current.part.state as string) === "approval-requested")
    const live = streaming || hasLiveStep(steps)
    // The clock counts the agent's work: from the first step, paused while parked on the reader.
    const counted = useTurnClock(clockId, live && !awaiting && steps.length > 0)
    // A run resumed after a gate traces only its last leg; the longer of the two is the work.
    const trace = useAtomValue(traceDataSummaryAtomFamily(!live && traceId ? traceId : ""))
    const traced = trace.metrics.durationMs ?? null
    const elapsed = live
        ? counted
        : traced === null && counted === null
          ? null
          : Math.max(traced ?? 0, counted ?? 0)
    const files = useMemo(() => activityFiles(steps), [steps])
    // Nothing in flight for a while, before the first step too; each startup phase restarts the wait.
    const idle = useHeldFor(live && !awaiting && !current, VERB_HOLD_MS, startupLabel)
    // The latest step reads live for as long as the run does.
    const liveTail = live && !awaiting
    // Only a step that lands on an already-mounted fold unfolds.
    const mountedRef = useRef(false)
    useEffect(() => {
        mountedRef.current = true
    }, [])

    const key = activityFoldKey(clockId)
    const stored = useAtomValue(expandedValueAtomFamily(key))
    const setExpanded = useSetAtom(setExpandedAtom)
    // Closed by default, even parked on the reader: the header already says what it waits for.
    const open = stored ?? false
    // A fold opened to watch the run folds back once the run ends: the answer is the point now.
    const wasLiveRef = useRef(live)
    useEffect(() => {
        if (wasLiveRef.current && !live && open) setExpanded({key, value: false})
        wasLiveRef.current = live
    }, [live, open, key, setExpanded])

    if (!steps.length && !live) return null

    const count = steps.length
    // No clock before the first step.
    const clock =
        elapsed === null || awaiting || !count ? "" : ` · ${formatElapsed(elapsed, {live: true})}`

    let title: ReactNode
    if (live || awaiting) {
        title = (
            <>
                <SwapLabel
                    shimmer={!awaiting}
                    suffix={clock}
                    text={
                        awaiting
                            ? "Waiting for you"
                            : answerStarted && !current
                              ? "Answering"
                              : idle
                                ? "Working"
                                : liveVerb(current ?? lastAgentStep(steps), startupLabel, firstTurn)
                    }
                />
            </>
        )
    } else {
        title = elapsed === null ? "Worked" : `Worked for ${formatElapsed(elapsed, {live: false})}`
    }

    return (
        <div className="flex min-w-0 flex-col">
            <button
                type="button"
                onClick={() => setExpanded({key, value: !open})}
                aria-expanded={open}
                className="-ml-1.5 flex w-fit max-w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-1.5 py-1.5 text-left text-[13px] text-colorTextSecondary group/row"
            >
                {awaiting ? <WaitingGlyph kind={waitingKind(steps)} /> : null}
                <span className="flex min-w-0 items-center whitespace-nowrap transition-colors group-hover/row:text-colorText">
                    {title}
                </span>
                {!live && files.length ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-colorTextTertiary">
                        <span>·</span>
                        <FileText size={13} />
                        {files.length} {files.length === 1 ? "file" : "files"}
                    </span>
                ) : null}
                {/* Nothing to open before the first step. */}
                {count ? (
                    <CaretRight
                        size={10}
                        weight="bold"
                        className={`shrink-0 text-colorTextDisabled opacity-50 transition-transform ${
                            open ? "rotate-90" : ""
                        }`}
                    />
                ) : null}
            </button>
            <RevealCollapse open={open}>
                <div className="relative mt-3 mb-1.5 flex flex-col">
                    {/* The wire behind the nodes; one node has nothing to join. */}
                    {steps.length > 1 ? (
                        <div
                            aria-hidden
                            className={`absolute bottom-3.5 top-3.5 w-px bg-colorBorderSecondary ${
                                live ? "ag-activity-wire-live" : ""
                            }`}
                            style={{left: 11.5}}
                        />
                    ) : null}
                    {steps.map((step, i) => (
                        <StepReveal
                            key={step.key}
                            animate={live && mountedRef.current}
                            first={i === 0}
                        >
                            {step.kind === "thought" ? (
                                <ActivityThoughtStep
                                    text={step.text}
                                    streaming={step.streaming}
                                    urgent={i !== steps.length - 1}
                                    live={liveTail && i === steps.length - 1}
                                />
                            ) : step.kind === "client" ? (
                                <ActivityClientStep part={step.part} render={renderClientTool} />
                            ) : (
                                <ActivityToolStep
                                    part={step.part}
                                    files={step.files}
                                    live={liveTail && i === steps.length - 1}
                                />
                            )}
                        </StepReveal>
                    ))}
                </div>
            </RevealCollapse>
        </div>
    )
}
