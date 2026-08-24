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
 * `useConnectDock`; how a settle actually fires arrives as `onOutput`. Same contract as
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

import type {ClientToolOutputHandler} from "../clientTools/ClientToolPart"
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

const CARD_SURFACE =
    "rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer"

export interface ConnectDockProps {
    /** Parked connections, front card first (from `useConnectDock`). */
    interactions: ClientToolMeta[]
    /** 1-based position of the front card in the batch. */
    position: number
    /** Connections the batch started with; the counter is hidden when it is 1. */
    total: number
    /** Pull one of the cards behind the front one forward. */
    onBringForward: (toolCallId: string) => void
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

export const ConnectDock = ({
    interactions,
    position,
    total,
    onBringForward,
    onOutput,
    touch = false,
    active = true,
    className = "",
}: ConnectDockProps) => {
    const [hovered, setHovered] = useState<string | null>(null)

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
                    onBringForward={onBringForward}
                />
            ))}

            <ConnectCard
                key={front.toolCallId}
                meta={front}
                position={position}
                total={total}
                onOutput={onOutput}
                touch={touch}
                active={active}
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
                onFocus={() => onEnter(meta.toolCallId)}
                onBlur={() => onEnter(null)}
                onClick={() => onBringForward(meta.toolCallId)}
                className="absolute z-30 cursor-pointer border-0 bg-transparent p-0"
                style={{left: inset, right: inset, top: restTop, height: PEEK_STEP}}
            />
        </>
    )
}

/** The front card: header, per-phase body, actions — driven by the shared OAuth flow. */
const ConnectCard = ({
    meta,
    position,
    total,
    onOutput,
    touch,
    active,
}: {
    meta: ClientToolMeta
    position: number
    total: number
    onOutput: ClientToolOutputHandler
    touch: boolean
    active: boolean
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
    const {label, logo, phase, errorText, modeResolving, runConnect, cancel, decline} =
        useConnectFlow(meta, settle, active)

    // Touch must NOT change the chrome — the tap target extends invisibly instead.
    const touchCls = touch
        ? "relative after:absolute after:-inset-x-1 after:-inset-y-2 after:content-['']"
        : ""

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
                    <span className="ml-auto text-xs tabular-nums text-colorTextSecondary">
                        {position} of {total}
                    </span>
                ) : null}
            </div>

            {phase === "connecting" ? (
                <div className="flex items-center gap-2">
                    <Spinner size={13} className="shrink-0 animate-spin text-colorPrimary" />
                    <span className="text-xs text-colorTextSecondary">
                        Connecting {label}… finish signing in from the popup window.
                    </span>
                </div>
            ) : phase === "error" ? (
                <span className="text-xs text-colorError" title={errorText ?? undefined}>
                    {errorText ?? "Connection failed."}
                </span>
            ) : (
                <span className="text-xs text-colorTextSecondary">
                    Connect <span className="font-medium text-colorText">{label}</span> to let the
                    agent continue, or continue without the connection.
                </span>
            )}

            <div className="flex items-center justify-end gap-1.5">
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
        </div>
    )
}
