import {useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {traceDataSummaryAtomFamily} from "@agenta/entities/loadable"
import {HeightCollapse} from "@agenta/ui"
import {CaretRight, FileText} from "@phosphor-icons/react"
import type {ToolUIPart} from "ai"
import {useAtomValue, useSetAtom} from "jotai"
import {useReducedMotion} from "motion/react"

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
const ROLL_MS = 340
const STEP_ENTER_MS = 320

/**
 * The collapsed line's verb while the run is live. A change rolls the old verb up and out and
 * the new one in from below — one row, one slide — rather than swapping in place.
 */
const RollingLabel = ({text, shimmer}: {text: string; shimmer: boolean}) => {
    const reduced = useReducedMotion()
    const [rows, setRows] = useState<string[]>([text])
    const [sliding, setSliding] = useState(false)
    // What the slot currently shows, read by the effect without being one of its dependencies: a
    // dependency on the rows re-ran the effect as soon as it set them, cancelling its own frame
    // and leaving the old verb on screen.
    const shownRef = useRef(text)

    useEffect(() => {
        if (text === shownRef.current) return
        const previous = shownRef.current
        shownRef.current = text
        if (reduced) {
            setRows([text])
            return
        }
        setRows([previous, text])
        setSliding(false)
        // Two frames: paint the pair at rest, then transition to the slid position. The timer
        // settles the pair if `transitionend` never fires (a re-render mid-slide swallows it).
        const id = requestAnimationFrame(() => requestAnimationFrame(() => setSliding(true)))
        const settle = setTimeout(() => {
            setRows([text])
            setSliding(false)
        }, ROLL_MS + 120)
        return () => {
            cancelAnimationFrame(id)
            clearTimeout(settle)
        }
    }, [text, reduced])

    return (
        <span
            className="block shrink-0 overflow-hidden"
            style={{height: ROW_PX}}
            aria-live="polite"
        >
            <span
                className={`block ${sliding ? "transition-transform duration-[340ms] ease-[cubic-bezier(.4,0,.2,1)]" : ""}`}
                style={{transform: sliding ? `translateY(-${ROW_PX}px)` : undefined}}
                onTransitionEnd={() => {
                    setRows([text])
                    setSliding(false)
                }}
            >
                {rows.map((row, i) => (
                    <span
                        key={`${i}-${row}`}
                        className={`block whitespace-nowrap ${shimmer ? LIVE_TEXT_CLASS : ""}`}
                        style={{height: ROW_PX, lineHeight: `${ROW_PX}px`}}
                    >
                        {row}
                    </span>
                ))}
            </span>
        </span>
    )
}

/** Three dots bouncing in the node slot: the run is working. */
const LiveDots = () => (
    <span aria-hidden className="flex size-6 shrink-0 items-center justify-center gap-[3px]">
        {[0, 1, 2].map((i) => (
            <span
                key={i}
                className="size-1 rounded-full bg-colorPrimary motion-safe:animate-bounce"
                style={{animationDuration: "1.25s", animationDelay: `${i * 0.14}s`}}
            />
        ))}
    </span>
)

/**
 * A step arriving live unfolds into the column — height, a short rise and a fade from a quarter,
 * the way the design lights a pending step — instead of popping the rows below it down. A
 * replayed transcript mounts solid. The gap between steps is the entry's own top padding, so it
 * unfolds with the step.
 */
const StepReveal = ({
    animate,
    first,
    children,
}: {
    animate: boolean
    first: boolean
    children: ReactNode
}) => {
    const [shown, setShown] = useState(!animate)
    useEffect(() => {
        if (shown) return
        const id = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(id)
    }, [shown])
    return (
        <HeightCollapse open={shown} animate={animate} durationMs={STEP_ENTER_MS} slideY={6}>
            <div
                className={`transition-opacity duration-300 ${first ? "" : "pt-4.5"} ${
                    shown ? "opacity-100" : "opacity-25"
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
            return icon === "ask" || icon === "connect" ? icon : "approval"
        }
        if (state === "approval-requested") return "approval"
    }
    return "approval"
}

/** The last step of the agent's own — a settled question or connect was the reader's move, and
 * its verb ("Waiting for your answers") must not hold the line once the run moves on. */
const lastAgentStep = (steps: ActivityStep[]): ActivityStep | null => {
    for (let i = steps.length - 1; i >= 0; i--) if (steps[i].kind !== "client") return steps[i]
    return null
}

/** What the collapsed line narrates: the step in flight, or — while the model composes the next
 * one and nothing is in flight — the last step, so the verb holds. Before any step there is only
 * the runner's startup narration, or the warm-up. */
const liveVerb = (step: ActivityStep | null, startupLabel?: string | null): string => {
    if (!step) return startupLabel || "Warming up"
    if (step.kind === "thought") return step.source === "text" ? "Writing" : "Thinking"
    const part = step.part
    if ((part.state as string) === "approval-requested") return "Waiting for your approval"
    return resolveToolDisplay(partToolName(part), (part as {input?: unknown}).input).activity
        .running
}

export interface ActivityTimelineProps {
    messageId: string
    /** Keys the working clock and the fold's open state. Defaults to the message; a host keys
     * them to the run (`runKey`) so a placeholder turn's count and toggle carry to the message. */
    clockId?: string
    steps: ActivityStep[]
    /** This turn is the one being generated. */
    streaming: boolean
    /** The answer has begun: the fold settles even though the turn is still streaming. */
    answerStarted: boolean
    /** The session whose startup narration the line reads until the first step arrives. Only a
     * streaming fold subscribes; settled ones read an empty key. */
    sessionId?: string
    /** The run is parked on the reader (a question, a connect). */
    waitingOnUser?: boolean
    /** The turn's trace. Once settled, the line reads the trace's duration — the run's own
     * time — over the local count, which only ever measured what this client watched. */
    traceId?: string | null
    /** Renders a browser-fulfilled tool's widget in its step. Absent on a read-only host, where
     * the step shows only its node. */
    renderClientTool?: (part: ToolUIPart) => ReactNode
}

/**
 * The turn's work, folded: one line while collapsed — the live verb as it happens, "Worked for
 * 11s" once done — over a timeline of thought and tool steps. Rests closed unless the run is
 * parked on the reader, and stays wherever the reader last put it.
 */
export const ActivityTimeline = ({
    messageId,
    clockId = messageId,
    steps,
    streaming,
    answerStarted,
    sessionId,
    waitingOnUser = false,
    traceId,
    renderClientTool,
}: ActivityTimelineProps) => {
    const startupLabel = useStartupPhase(streaming && sessionId ? sessionId : "")
    const current = currentStep(steps)
    const awaiting =
        waitingOnUser ||
        (current?.kind === "tool" && (current.part.state as string) === "approval-requested")
    // Live for the whole run: a text that looks like the answer can turn out to be an aside with
    // more steps behind it, so the line keeps narrating ("Answering") until the stream ends.
    const running = streaming || hasLiveStep(steps)
    const live = running
    // The clock counts the agent's work, not the reader's: it pauses while parked on them.
    const counted = useTurnClock(clockId, live && !awaiting)
    // Settled: the trace's duration, or the local count when it is longer — a run resumed after
    // a gate traces only its last leg, while the count saw the whole of the work.
    const trace = useAtomValue(traceDataSummaryAtomFamily(!live && traceId ? traceId : ""))
    const traced = trace.metrics.durationMs ?? null
    const elapsed = live
        ? counted
        : traced === null && counted === null
          ? null
          : Math.max(traced ?? 0, counted ?? 0)
    const files = useMemo(() => activityFiles(steps), [steps])
    // The latest step reads live for as long as the run does — most calls settle within the
    // same batch they arrive in, and between steps the model composes in silence; the last row
    // is where that work shows.
    const liveTail = running && !awaiting
    // Only a step that lands on an already-mounted fold unfolds; whatever the fold mounts with
    // (a replay, or a remount mid-run when the message is re-keyed) sits solid.
    const mountedRef = useRef(false)
    useEffect(() => {
        mountedRef.current = true
    }, [])

    const key = activityFoldKey(clockId)
    const stored = useAtomValue(expandedValueAtomFamily(key))
    const setExpanded = useSetAtom(setExpandedAtom)
    // Closed by default, live or settled: the line narrates the run. Parked on the reader it
    // opens itself so what it waits on is in reach; the reader's own toggle wins over that too.
    const open = stored ?? awaiting

    if (!steps.length && !live) return null

    const count = steps.length
    const stepsText = count ? ` · ${count} ${count === 1 ? "step" : "steps"}` : ""
    // No clock before the first step: the warm-up is the runner's time, not the agent's.
    const clock =
        elapsed === null || awaiting || !count ? "" : ` · ${formatElapsed(elapsed, {live: true})}`

    let title: ReactNode
    if (live || awaiting) {
        title = (
            <>
                <RollingLabel
                    // The sweep says "working"; a run parked on the reader is not.
                    shimmer={!awaiting}
                    text={
                        awaiting
                            ? "Waiting for you"
                            : answerStarted && !current
                              ? "Answering"
                              : liveVerb(current ?? lastAgentStep(steps), startupLabel)
                    }
                />
                {/* `pre`: the leading space before the dot would otherwise collapse at the
                    start of the flex item, gluing the dot to the verb. */}
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre text-colorTextTertiary">
                    {clock}
                    {stepsText}
                </span>
            </>
        )
    } else {
        title =
            elapsed === null
                ? `Worked${stepsText}`
                : `Worked for ${formatElapsed(elapsed, {live: false})}`
    }

    return (
        <div className="flex min-w-0 flex-col">
            <button
                type="button"
                onClick={() => setExpanded({key, value: !open})}
                aria-expanded={open}
                className="-ml-1.5 flex w-fit max-w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent px-1.5 py-1.5 text-left text-[13px] text-colorTextSecondary group"
            >
                {awaiting ? <WaitingGlyph kind={waitingKind(steps)} /> : live ? <LiveDots /> : null}
                <span className="flex min-w-0 items-center whitespace-nowrap transition-colors group-hover:text-colorText">
                    {title}
                </span>
                {!live && files.length ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-colorTextTertiary">
                        <span>·</span>
                        <FileText size={13} />
                        {files.length} {files.length === 1 ? "file" : "files"}
                    </span>
                ) : null}
                {/* Nothing to open before the first step: the warm-up line is not a fold yet. */}
                {count ? (
                    <CaretRight
                        size={10}
                        weight="bold"
                        className={`shrink-0 text-colorTextDisabled transition-transform ${
                            open ? "rotate-90" : ""
                        }`}
                    />
                ) : null}
            </button>
            <RevealCollapse open={open}>
                <div className="relative mt-3 mb-1.5 flex flex-col">
                    {/* The wire, behind the nodes: from the first node's centre to the last's.
                        One node has nothing to join. */}
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
