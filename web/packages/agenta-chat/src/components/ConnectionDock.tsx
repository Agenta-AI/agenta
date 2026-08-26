/**
 * The shared connect dock — ONE design for the parked `request_connection` calls a run is blocked
 * on, rendered identically by the desktop dock and mobile.
 *
 * A turn can park several connections at once, so the dock is a SHINGLE STACK: the front card owns
 * the actions, and the rest sit behind it as bottom-aligned edges the user can pull forward. Only
 * the front card runs `useConnectFlow` — a stack of live OAuth flows would race each other's
 * popups, and the cards behind need nothing but a name and a logo to be recognizable.
 *
 * Presentational + flow only: which card is in front, and how many are left, come from
 * `useConnectionDock`; how a settle actually fires arrives as `onOutput`. Same contract as
 * `ApprovalCard`.
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {
    connectIntegrationKey,
    IntegrationTile,
    useConnectFlow,
    useIntegrationIdentity,
} from "@agenta/entity-ui/clientTools"
import {Button} from "@agenta/ui/ui"
import {Spinner} from "@phosphor-icons/react"
import {
    motion,
    useMotionValue,
    useReducedMotion,
    useSpring,
    useTransform,
    useVelocity,
} from "motion/react"

import {CONNECT_PILL_SPRING} from "../assets/motion"
import type {ClientToolOutputHandler} from "../clientTools/ClientToolPart"
import type {ConnectionDockState} from "../hooks/useConnectionDock"
import type {ClientToolMeta, SettleClientTool} from "../skin"

/** How far each card behind the front one peeks above it. */
const PEEK_STEP = 10
/** How far each card behind is inset from the one in front, per level. */
const PEEK_INSET = 14
/** How far the FIRST card behind the front one slides up when pointed at. Deeper cards rise to
 *  that same line rather than further, so every fanned card exposes one consistent band. */
const PEEK_LIFT = 22
/** Cards past this stay in the count but not in the stack — deeper edges are unreadable slivers. */
const MAX_PEEKS = 3
/** Gap between each card's entrance, so the stack deals out instead of appearing whole. */
const DEAL_STAGGER_MS = 70
/** Progress-dot geometry. The pill travels one SLOT per dot, so these must agree with the markup. */
const DOT_SIZE = 5
const DOT_PAD = 3
const DOT_SLOT = DOT_SIZE + DOT_PAD * 2
const DOT_PILL_WIDTH = 12
/** How far the pill stretches at full tilt. Subtle on purpose — past this it reads as a glitch. */
const DOT_PILL_MAX_STRETCH = 0.35
/** Travel speed (px/s) that earns the full stretch; the longest hop in a 5-dot row roughly hits it. */
const DOT_PILL_PEAK_VELOCITY = 420

const CARD_SURFACE =
    "rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer"

export interface ConnectionDockProps {
    /** The whole dock state from `useConnectionDock` — passed as one object so a new field never
     *  means editing every host that renders this. */
    connects: ConnectionDockState
    /** Settle channel — hosts map this onto their `addToolOutput`. */
    onOutput: ClientToolOutputHandler
    /** Touch mode: the actions get an invisibly extended tap area. Chrome is identical. */
    touch?: boolean
    /**
     * False while the dock is latched open purely to animate closed. It stops the front card's
     * flow from settling a run that is already over and tears down any popup still on screen —
     * hosts that unmount the dock instead can leave it alone.
     */
    active?: boolean
    className?: string
}

export const ConnectionDock = ({
    connects,
    onOutput,
    touch = false,
    active = true,
    className = "",
}: ConnectionDockProps) => {
    const {stack: interactions, batch, position, total, shortcutsEnabled} = connects
    const onBringForward = connects.bringForward
    const [hovered, setHovered] = useState<string | null>(null)
    // Picking a card ends the fan: the stack reorders under the pointer, so whatever was lifted is
    // no longer what sits there.
    const pickCard = useCallback(
        (toolCallId: string) => {
            setHovered(null)
            onBringForward(toolCallId)
        },
        [onBringForward],
    )

    const front = interactions[0]
    const peeks = interactions.slice(1, 1 + MAX_PEEKS)
    // Room for a lifted card, reserved unconditionally: `touch` says how big the tap targets are,
    // NOT whether a pointer exists — /m runs in desktop browsers too, and gating the fan on it left
    // the stack dead there. Hover simply never fires where there is no pointer.
    const topBase = peeks.length > 0 ? PEEK_STEP * peeks.length + PEEK_LIFT : 0
    // The one line every fanned card rises to: where the first card behind the front lands. Deeper
    // cards stopping here (instead of lifting by a fixed amount from their own deeper rest) is what
    // keeps the exposed band the same size no matter which card is pointed at.
    const liftedTop = topBase - PEEK_STEP - PEEK_LIFT

    if (!front) return null

    return (
        <div
            className={`relative ${className}`}
            style={{paddingTop: topBase}}
            onMouseLeave={() => setHovered(null)}
        >
            {peeks.map((meta, index) => (
                <PeekCard
                    key={meta.toolCallId}
                    meta={meta}
                    inset={PEEK_INSET * (index + 1)}
                    restTop={topBase - PEEK_STEP * (index + 1)}
                    collapsedTop={topBase}
                    liftedTop={liftedTop}
                    lifted={hovered === meta.toolCallId}
                    zIndex={hovered === meta.toolCallId ? 15 : 10 - index}
                    revealed={hovered === meta.toolCallId}
                    dealDelayMs={index * DEAL_STAGGER_MS}
                    onEnter={setHovered}
                    onBringForward={pickCard}
                />
            ))}

            <ConnectCard
                meta={front}
                batch={batch}
                onBringForward={pickCard}
                position={position}
                total={total}
                onOutput={onOutput}
                touch={touch}
                active={active}
                shortcutsEnabled={shortcutsEnabled}
            />
        </div>
    )
}

/**
 * One card behind the front one: a bottom-aligned edge that deals out on arrival and lifts to
 * reveal its logo and name when pointed at.
 *
 * The deal: the card mounts hidden exactly behind the front card and slides up and outward into its
 * resting shingle, staggered by depth — otherwise the stack pops in fully formed and reads as a
 * static graphic rather than a queue. Each card runs its own, so the one revealed by a settle deals
 * in too, not just the opening set.
 *
 * The hit band is a fixed sibling over the card's sliver — it does NOT move when the card lifts, so
 * running the pointer up the stack switches hover one card at a time.
 */
const PeekCard = ({
    meta,
    inset,
    restTop,
    collapsedTop,
    liftedTop,
    lifted,
    zIndex,
    revealed,
    dealDelayMs,
    onEnter,
    onBringForward,
}: {
    meta: ClientToolMeta
    inset: number
    restTop: number
    /** Where the card starts its deal: the front card's top edge, which hides it completely. */
    collapsedTop: number
    /** The shared line a fanned card rises to (see `liftedTop` in the parent). */
    liftedTop: number
    lifted: boolean
    zIndex: number
    revealed: boolean
    dealDelayMs: number
    onEnter: (toolCallId: string | null) => void
    onBringForward: (toolCallId: string) => void
}) => {
    const {label, logo} = useIntegrationIdentity(connectIntegrationKey(meta))
    const title = `Connect ${label} first`

    const [dealt, setDealt] = useState(false)
    // Read once at mount: the stagger belongs to this card's arrival, and re-running it as the
    // stack shifts would re-deal cards that are already on the table.
    const delayRef = useRef(dealDelayMs)
    useEffect(() => {
        const reduced =
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        // Reduced motion still needs the end state, just not the staggered slide into it.
        if (reduced) return setDealt(true)
        const timer = window.setTimeout(() => setDealt(true), delayRef.current)
        return () => window.clearTimeout(timer)
    }, [])

    // Undealt: squared with the front card, which hides it completely behind it. Lifted: the width
    // of the SECOND card, so every lifted card reads at one consistent width, still visibly behind
    // the front card, and wide enough to cover the shoulders of the deeper cards it sits over.
    // Held at its own inset instead, a deep card reads as a mismatched panel with the shallower
    // ones poking out around it.
    const currentInset = !dealt ? 0 : lifted ? PEEK_INSET : inset
    // `min` so a card already resting above the shared line never travels DOWN to reach it — with
    // MAX_PEEKS at 3 no card does, but the clamp keeps a deeper stack from inverting the gesture.
    const currentTop = !dealt ? collapsedTop : lifted ? Math.min(restTop, liftedTop) : restTop

    return (
        <>
            <div
                aria-hidden
                className={`${CARD_SURFACE} pointer-events-none absolute bottom-0 flex items-start overflow-hidden px-3 pt-1.5 shadow-sm transition-all duration-300 ease-out motion-reduce:transition-none`}
                style={{
                    left: currentInset,
                    right: currentInset,
                    top: currentTop,
                    zIndex,
                }}
            >
                <span
                    className="flex items-center gap-1.5 transition-opacity duration-150 motion-reduce:transition-none"
                    style={{opacity: revealed ? 1 : 0}}
                >
                    <IntegrationTile label={label} logo={logo} size={14} />
                    <span className="whitespace-nowrap text-xs text-colorTextSecondary">
                        {label}
                    </span>
                </span>
            </div>
            {/* No `title`: the card itself reveals the name on hover, so a native tooltip would
                just drop a dark box over the card the user is trying to read. */}
            <button
                type="button"
                aria-label={title}
                onMouseEnter={() => onEnter(meta.toolCallId)}
                // Leaving the band must clear the fan here, not on the dock: the dots and the front
                // card sit INSIDE the dock, so the container's own leave never fires on the way to
                // them and the card stayed fanned open.
                onMouseLeave={() => onEnter(null)}
                onFocus={() => onEnter(meta.toolCallId)}
                onBlur={() => onEnter(null)}
                onClick={() => onBringForward(meta.toolCallId)}
                className="absolute z-30 cursor-pointer border-0 bg-transparent p-0"
                style={{left: inset, right: inset, top: restTop, height: PEEK_STEP}}
            />
        </>
    )
}

/**
 * Batch progress, and the fastest way to pick a connection: one dot per call in the batch, with a
 * single pill that SLIDES to whichever one is on screen. One element travelling reads as the focus
 * moving; growing one dot while shrinking another reads as two unrelated blinks.
 *
 * It walks `batch` — the agent's original order, settled entries included — so a dot always stands
 * for the SAME connection. Walking the pending stack instead would shuffle the dots under the
 * pointer every time a card was pulled forward. Replaces the old "N of M" text, which said less;
 * the count survives for assistive tech as the group label.
 */
const ConnectDots = ({
    batch,
    frontId,
    position,
    total,
    onBringForward,
}: {
    batch: ClientToolMeta[]
    frontId: string
    position: number
    total: number
    onBringForward: (toolCallId: string) => void
}) => {
    const activeIndex = batch.findIndex((meta) => meta.toolCallId === frontId)
    return (
        <div
            className="relative ml-auto flex items-center"
            role="group"
            aria-label={`Connection ${position} of ${total}`}
        >
            {activeIndex >= 0 ? <ConnectPill activeIndex={activeIndex} /> : null}
            {batch.map((meta) => (
                <Dot
                    key={meta.toolCallId}
                    meta={meta}
                    current={meta.toolCallId === frontId}
                    onBringForward={onBringForward}
                />
            ))}
        </div>
    )
}

/**
 * The travelling active marker. Two things make it read as liquid rather than as a box being moved:
 * a spring, so it settles onto its dot instead of stopping dead, and a stretch derived from its own
 * VELOCITY, so it elongates while crossing and relaxes on arrival. Velocity is why the stretch
 * can't be a second CSS transition — one `transform` cannot ease its translate and its scale on
 * different curves.
 */
const ConnectPill = ({activeIndex}: {activeIndex: number}) => {
    const reduced = useReducedMotion()
    // Centre the pill on its slot; it is wider than a dot, hence the half-step.
    const target = activeIndex * DOT_SLOT + (DOT_SLOT - DOT_PILL_WIDTH) / 2

    const x = useMotionValue(target)
    const springX = useSpring(x, CONNECT_PILL_SPRING)
    useEffect(() => {
        x.set(target)
        // Reduced motion still lands on the right dot, it just doesn't travel there.
        if (reduced) springX.jump(target)
    }, [target, reduced, x, springX])

    const velocity = useVelocity(springX)
    const stretch = useTransform(velocity, (v) =>
        reduced ? 1 : 1 + Math.min(Math.abs(v) / DOT_PILL_PEAK_VELOCITY, 1) * DOT_PILL_MAX_STRETCH,
    )
    // Squash the cross-axis by half of what the long axis gains, so the pill keeps its mass.
    const squash = useTransform(stretch, (sx) => 1 - (sx - 1) / 2)
    // The full transform string: Motion's `x`/`scale` shorthands are not hardware-accelerated.
    const transform = useTransform(
        [springX, stretch, squash],
        ([px, sx, sy]: number[]) => `translate(${px}px, -50%) scale(${sx}, ${sy})`,
    )

    return (
        <motion.span
            aria-hidden
            className="pointer-events-none absolute left-0 top-1/2 rounded-full bg-colorText"
            style={{
                width: DOT_PILL_WIDTH,
                height: DOT_SIZE,
                transform,
                transformOrigin: "center",
            }}
        />
    )
}

/**
 * One dot — always the same size, because the travelling pill above carries the active state. Only
 * a QUEUED call is pickable; the one on screen and the settled ones are inert.
 */
const Dot = ({
    meta,
    current,
    onBringForward,
}: {
    meta: ClientToolMeta
    current: boolean
    onBringForward: (toolCallId: string) => void
}) => {
    const {label} = useIntegrationIdentity(connectIntegrationKey(meta))
    const pickable = !meta.settled && !current
    const title = pickable ? `Connect ${label} first` : undefined
    return (
        <button
            type="button"
            title={title}
            aria-label={title}
            aria-hidden={!pickable}
            disabled={!pickable}
            tabIndex={pickable ? undefined : -1}
            onClick={() => onBringForward(meta.toolCallId)}
            className={`inline-flex items-center justify-center border-0 bg-transparent py-2 ${
                pickable ? "cursor-pointer" : "cursor-default"
            }`}
            style={{paddingLeft: DOT_PAD, paddingRight: DOT_PAD}}
        >
            <span
                className={`rounded-full transition-colors duration-200 motion-reduce:transition-none ${
                    meta.settled ? "bg-colorTextQuaternary" : "bg-colorFill"
                }`}
                style={{width: DOT_SIZE, height: DOT_SIZE}}
            />
        </button>
    )
}

/**
 * The front card's frame and header. Deliberately NOT keyed by tool-call id: the header — and the
 * progress pill inside it — has to survive a switch, or the pill mounts as a new node at its
 * destination and never travels. Everything that must reset per parked call lives in the keyed
 * `ConnectBody` below.
 */
const ConnectCard = ({
    meta,
    batch,
    onBringForward,
    position,
    total,
    onOutput,
    touch,
    active,
    shortcutsEnabled,
}: {
    meta: ClientToolMeta
    /** The turn's whole connect batch — the dots walk it, not just the front card. */
    batch: ClientToolMeta[]
    onBringForward: (toolCallId: string) => void
    position: number
    total: number
    onOutput: ClientToolOutputHandler
    touch: boolean
    active: boolean
    shortcutsEnabled: boolean
}) => {
    // Identity only — the header needs a name and a logo, not the OAuth flow.
    const {label, logo} = useIntegrationIdentity(connectIntegrationKey(meta))

    // No shadow on the front card: it sits directly on the composer, where a drop shadow reads as a
    // seam rather than depth. The cards behind it keep theirs — that is what stacks them.
    return (
        <div className={`${CARD_SURFACE} relative z-20 flex flex-col gap-2.5 p-3`}>
            <div className="flex items-center gap-2">
                <IntegrationTile label={label} logo={logo} size={20} />
                <span className="text-xs font-medium text-colorText">
                    The agent is waiting for you
                </span>
                {total > 1 ? (
                    <ConnectDots
                        batch={batch}
                        frontId={meta.toolCallId}
                        position={position}
                        total={total}
                        onBringForward={onBringForward}
                    />
                ) : null}
            </div>

            <ConnectBody
                key={meta.toolCallId}
                meta={meta}
                label={label}
                onOutput={onOutput}
                touch={touch}
                active={active}
                shortcutsEnabled={shortcutsEnabled}
            />
        </div>
    )
}

/** The per-call half: the ask, the phase, the actions, and the flow that settles them. */
const ConnectBody = ({
    meta,
    label: fallbackLabel,
    onOutput,
    touch,
    active,
    shortcutsEnabled,
}: {
    meta: ClientToolMeta
    label: string
    onOutput: ClientToolOutputHandler
    touch: boolean
    active: boolean
    shortcutsEnabled: boolean
}) => {
    // Same settle mapping as ClientToolPart — the dock is a second dispatch site for this part.
    const settle = useCallback<SettleClientTool>(
        (args) => {
            if ("errorText" in args) {
                onOutput({
                    toolName: meta.toolName,
                    toolCallId: meta.toolCallId,
                    errorText: args.errorText,
                })
            } else {
                onOutput({
                    toolName: meta.toolName,
                    toolCallId: meta.toolCallId,
                    output: args.output,
                })
            }
        },
        [onOutput, meta.toolName, meta.toolCallId],
    )
    const {label, phase, errorText, modeResolving, runConnect, cancel, decline} = useConnectFlow(
        meta,
        settle,
        active,
    )
    const name = label || fallbackLabel

    // Same bindings as ApprovalCard, so one gesture answers whichever dock is asking: Cmd/Ctrl+Enter
    // commits (the modifier is required — a bare Enter must never open an OAuth popup) and Escape
    // backs out, settling as a decline or, mid-flow, cancelling the popup. Escape is ignored while
    // the user is typing so it can't fire from the composer. `shortcutsEnabled` is how approvals
    // win when both docks are open; `runConnect` re-checks its own guards, so a double-fire is
    // harmless. No dep array, matching ApprovalCard — every render re-binds with fresh closures.
    useEffect(() => {
        if (!active || !shortcutsEnabled) return
        const onKeyDown = (event: KeyboardEvent) => {
            const commit = (event.metaKey || event.ctrlKey) && event.key === "Enter"
            const back = event.key === "Escape" && !event.metaKey && !event.ctrlKey
            if (!commit && !back) return
            const target = event.target as HTMLElement | null
            const typing =
                !!target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)
            if (back && typing) return
            event.preventDefault()
            if (back) return phase === "connecting" ? cancel() : decline()
            // Mid-flow the popup owns the outcome, and a disabled Connect must stay disabled.
            if (phase !== "connecting" && !modeResolving) runConnect(true)
        }
        window.addEventListener("keydown", onKeyDown)
        return () => window.removeEventListener("keydown", onKeyDown)
    })

    // Touch must NOT change the chrome — the tap target extends invisibly instead.
    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""

    return (
        <>
            {phase === "connecting" ? (
                <div className="flex items-center gap-2">
                    <Spinner size={13} className="shrink-0 animate-spin text-colorPrimary" />
                    <span className="text-xs text-colorTextSecondary">
                        Connecting {name}… finish signing in from the popup window.
                    </span>
                </div>
            ) : phase === "error" ? (
                <span className="text-xs text-colorError" title={errorText ?? undefined}>
                    {errorText ?? "Connection failed."}
                </span>
            ) : (
                <span className="text-xs text-colorTextSecondary">
                    Connect to <span className="font-medium text-colorText">{name}</span> to give
                    your agent access to its tools
                </span>
            )}

            {/* `-mt-1` tightens only the ask→actions gap; the header keeps the column's full gap. */}
            <div className="-mt-1 flex items-center justify-end gap-1.5">
                {phase === "connecting" ? (
                    <Button variant="outline" className={touchCls} onClick={cancel}>
                        Cancel
                    </Button>
                ) : (
                    <>
                        <Button
                            variant="ghost"
                            className={`text-colorTextSecondary ${touchCls}`}
                            onClick={decline}
                        >
                            Not now
                        </Button>
                        {/* Disabled, not spinning: `modeResolving` is true on every mount while the
                            catalog lookup runs, and a spinner there reads as "already connecting". */}
                        <Button
                            disabled={modeResolving}
                            className={touchCls}
                            title={
                                modeResolving ? "Checking how this toolkit connects…" : undefined
                            }
                            onClick={() => runConnect(true)}
                        >
                            {phase === "error" ? "Retry" : "Connect"}
                        </Button>
                    </>
                )}
            </div>
        </>
    )
}
