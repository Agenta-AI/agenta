import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {AgentActivityDots, HeightCollapse, type AgentActivityFormat} from "@agenta/ui"
import {CaretRight, FileText} from "@phosphor-icons/react"
import type {ToolUIPart} from "ai"
import {useAtomValue, useSetAtom} from "jotai"
import {useReducedMotion} from "motion/react"

import {stageWords} from "../../assets/startupPhases"
import {useHeldFor} from "../../hooks/useHeldFor"
import {useRevealed} from "../../hooks/useRevealed"
import {useStageWord} from "../../hooks/useStageWord"
import {formatElapsed, useTurnClock} from "../../hooks/useTurnClock"
import {
    activityFiles,
    currentStep,
    hasLiveStep,
    parseTraceTime,
    partToolName,
    type ActivityStep,
} from "../../model"
import {toolHadApproval} from "../../model/approvals"
import {resolveToolDisplay} from "../../skin"
import type {ActivityIcon} from "../../skin/types"
import {activityFoldKey, expandedValueAtomFamily, setExpandedAtom} from "../../state"
import {turnSpanAtomFamily, useTurnStage, useTurnStageSince} from "../../state/turnClock"
import RevealCollapse from "../RevealCollapse"

import {ActivityClientStep} from "./ActivityClientStep"
import {ActivityNode, LIVE_TEXT_CLASS, WaitingGlyph, type WaitingKind} from "./activityIcons"
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

/** A step that paused the run to wait on user input or approval. */
const stepHadGate = (step: ActivityStep): boolean =>
    step.kind === "client" || (step.kind === "tool" && toolHadApproval(step.part))

/** The last step of the agent's own: a settled ask's verb must not hold the line. */
const lastAgentStep = (steps: ActivityStep[]): ActivityStep | null => {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].kind !== "client") return steps[i]
    return null
}

/** How long a settled step's verb bridges the gap before the line reads "Working". */
const VERB_HOLD_MS = 2500

/** The dots' motion for a step's glyph; anything unlisted reads as a plain tool call. */
const ICON_FORMAT: Partial<Record<ActivityIcon, AgentActivityFormat>> = {
    "file-search": "searching",
    "web-search": "searching",
    "web-fetch": "searching",
    "tool-search": "searching",
    subtask: "subagents",
    agent: "subagents",
    "task-list": "planning",
    test: "evaluating",
    runs: "evaluating",
    annotation: "evaluating",
    "file-write": "writing",
}

interface LiveLine {
    text: string
    format: AgentActivityFormat
}

/** What the collapsed line narrates for a step, in words and in the dots' motion. */
const liveStep = (step: ActivityStep): LiveLine => {
    if (step.kind === "thought") return {text: "Thinking", format: "thinking"}
    // Reached only once the wait is over, so a gate still `approval-requested` here was just answered.
    const display = resolveToolDisplay(
        partToolName(step.part),
        (step.part as {input?: unknown}).input,
    )
    return {text: display.activity.running, format: ICON_FORMAT[display.icon] ?? "tool"}
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
    /** The agent is writing a message right now. */
    writing?: boolean
    /** The session whose turn stage the line narrates until the first step. */
    sessionId?: string
    /** The run is parked on the reader (a question, a connect). */
    waitingOnUser?: boolean
    /** The ask was answered here and the transcript still carries it: the line reads as work. */
    resuming?: boolean
    /** Gate history from the full turn, including tools hidden or merged in the activity steps. */
    hadGate?: boolean
    /** When the session turn started (ISO): the start of a run this tab met mid-flight. */
    sessionTurnStartedAt?: string | null
    /** The session turn's duration, from its start to its end: once settled, ungated turns use it. */
    sessionTurnDurationMs?: number
    /** This tab streamed the run itself, so its first step is the start. False for a run found
     * already in progress, whose start has to come from the session turn. Defaults to true: a
     * caller that cannot tell is a caller whose turn began here. */
    streamedHere?: boolean
    /** When the server saved the user message that opened this run (ms). */
    runStartedAt?: number
    /** Renders a client tool's widget in its step; absent on a read-only host. */
    renderClientTool?: (part: ToolUIPart) => ReactNode
    /** The run failed: the header names it and the server's raw text is the fold's last step. */
    failure?: ActivityFailure
}

export interface ActivityFailure {
    /** The short name of what happened, shown in the header: "Run stopped". */
    label: string
    /** The server's text as it came. Absent when the message already shows all of it. */
    detail?: string | null
}

/** The turn's work, folded: a live verb or "Worked for 11s" over a timeline of steps. */
export const ActivityTimeline = ({
    messageId,
    clockId = messageId,
    steps,
    streaming,
    answerStarted,
    writing = false,
    sessionId,
    waitingOnUser = false,
    resuming = false,
    hadGate: recordedGate = false,
    sessionTurnStartedAt,
    sessionTurnDurationMs,
    streamedHere = true,
    runStartedAt,
    renderClientTool,
    failure,
}: ActivityTimelineProps) => {
    // Any turn can cold start: a parked environment outlives an idle gap by minutes at most.
    const stage = useTurnStage(streaming && sessionId ? sessionId : "")
    const stageSince = useTurnStageSince(streaming && sessionId ? sessionId : "")
    const current = currentStep(steps)
    const awaiting =
        !resuming &&
        (waitingOnUser ||
            (current?.kind === "tool" && (current.part.state as string) === "approval-requested"))
    // Without `resuming` a parked client tool (never a live step) would read "Worked for …" here.
    const live = streaming || hasLiveStep(steps) || resuming
    // A run this tab met mid-flight: it was already going when the tab opened, so there is no local
    // span to count from and the clock would report the age of the TAB, not of the run (#6934). The
    // session turn's start is when the run began — the same source the timestamp beside this line
    // already trusts over first-seen-here. A run this tab streamed from the start needs none of
    // this: its own first step IS the start.
    const metMidFlight = live && !streamedHere
    const span = useAtomValue(turnSpanAtomFamily(clockId))
    // An open clock inherited on mount may have missed a gate while this timeline was absent.
    const inheritedRunningClock = useRef(Boolean(span && span.endedAt === undefined))
    const hadGate = Boolean(
        recordedGate || span?.gated || resuming || waitingOnUser || steps.some(stepHadGate),
    )
    // The saved user row is when the run began: before warm-up and before the first step this tab
    // can see. Only a run streamed here may use it with a gate, because only then were all its
    // pauses counted here.
    const fromSend = runStartedAt !== undefined && (streamedHere || !hadGate)
    const startedAt = fromSend
        ? runStartedAt
        : metMidFlight && !hadGate
          ? parseTraceTime(sessionTurnStartedAt)
          : undefined
    // The clock counts the agent's work: from the run's start, paused while parked on the reader.
    const measured = useTurnClock(clockId, live && !awaiting && steps.length > 0, {
        startedAt,
        seenFromSend: fromSend && streamedHere,
        waitingOnReader: awaiting,
    })
    // A tab that joined later cannot account for earlier waits. A clock already anchored to
    // the session turn's start is also unsafe if gate history arrives after that start was applied.
    const counted =
        hadGate && (!streamedHere || span?.anchored || inheritedRunningClock.current)
            ? null
            : measured
    // A gated session turn's start and end cover the whole run, including the time parked on the
    // user (#7445). When a turn had a gate, only the local clock saw the actual work time; an
    // unclocked turn that had a gate falls back to "Worked" rather than reporting the parked time.
    const recorded = live || hadGate ? null : (sessionTurnDurationMs ?? null)
    const elapsed =
        live || hadGate
            ? counted
            : recorded === null && counted === null
              ? null
              : Math.max(recorded ?? 0, counted ?? 0)
    const files = useMemo(() => activityFiles(steps), [steps])
    // A settled step's verb holds for a beat, then the line reads "Working".
    const idle = useHeldFor(live && !awaiting && !current && steps.length > 0, VERB_HOLD_MS)
    const verbStep = current ?? lastAgentStep(steps)
    // Stage words belong only to the wait before the first step or answer.
    const beforeFirstStep = live && !awaiting && steps.length === 0 && !resuming && !answerStarted
    const stageWord = useStageWord(stageWords(stage), beforeFirstStep, stageSince)
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

    // A failure shows only once the run is over: a live line still narrates the work.
    const failed = !live && failure ? failure : null
    // A run parked on the reader still says so, even with no step to fold.
    if (!steps.length && !live && !failed && !awaiting) return null

    const count = steps.length
    const detail = failed?.detail || null
    // Steps, then the failure's own text as the last node on the wire.
    const nodes = count + (detail ? 1 : 0)
    // No clock before the first step.
    const clock =
        elapsed === null || awaiting || !count ? "" : ` · ${formatElapsed(elapsed, {live: true})}`

    let title: ReactNode
    const line: LiveLine | null = !(live || awaiting)
        ? null
        : awaiting
          ? {text: "Waiting for you", format: "working"}
          : beforeFirstStep
            ? {text: stageWord, format: "working"}
            : resuming && !current
              ? {text: "Working", format: "working"}
              : writing && !current
                ? {text: "Answering", format: "writing"}
                : idle || !verbStep
                  ? {text: "Working", format: "working"}
                  : liveStep(verbStep)
    if (line) {
        title = <SwapLabel shimmer suffix={clock} text={line.text} />
    } else if (failed && !count) {
        // Failed before any step: there is no work to name, only the failure.
        title = <span className="text-colorError">{failed.label}</span>
    } else {
        title = elapsed === null ? "Worked" : `Worked for ${formatElapsed(elapsed, {live: false})}`
        if (failed) {
            title = (
                <>
                    {title}
                    <span className="whitespace-pre text-colorTextTertiary"> · </span>
                    <span className="text-colorError">{failed.label}</span>
                </>
            )
        }
    }

    return (
        <div className="flex min-w-0 flex-col">
            <button
                type="button"
                onClick={() => setExpanded({key, value: !open})}
                // Nothing to open yet (no step, no raw failure): a plain line, not a toggle.
                disabled={!nodes}
                aria-expanded={nodes ? open : undefined}
                className="-ml-1.5 flex w-fit max-w-full cursor-pointer disabled:cursor-default items-center gap-2.5 rounded-md border-0 bg-transparent px-1.5 py-1.5 text-left text-[13px] text-colorTextSecondary group/row"
            >
                {awaiting ? (
                    <WaitingGlyph kind={waitingKind(steps)} />
                ) : line ? (
                    <AgentActivityDots format={line.format} />
                ) : null}
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
                {nodes ? (
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
                    {nodes > 1 ? (
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
                    {detail ? (
                        <div
                            className={`flex min-w-0 items-start gap-3.5 ${count ? "pt-4.5" : ""}`}
                        >
                            <ActivityNode icon="platform" state="failed" />
                            <pre className="m-0 max-h-60 min-w-0 flex-1 overflow-auto whitespace-pre-wrap break-words ag-surface-inset rounded-md px-3 py-2 font-mono text-xs leading-relaxed text-colorTextSecondary">
                                {detail}
                            </pre>
                        </div>
                    ) : null}
                </div>
            </RevealCollapse>
        </div>
    )
}
