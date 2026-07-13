/**
 * Persistent "the agent is waiting for you" band for parked CLIENT-TOOL interactions — the sibling
 * of ApprovalDock with the same placement contract: it lives in the composer region (between the
 * transcript and the input) so a paused run can't scroll out of reach, and it OWNS the actions
 * while the inline transcript row is just a marker.
 *
 * Why it exists (UX): when the runner parks a `request_connection`, the stream genuinely ends —
 * `useChat` reads "ready", so nothing busy-derived (working dots, stop button) signals the pause,
 * while the message queue silently holds every send (`isHitlPending`). This dock makes the paused
 * state visible where the user is typing AND provides the escape hatch a parked connection
 * previously lacked: "Not now" settles the call as a structured decline, so the run resumes and
 * the conversation unfreezes.
 *
 * v1 covers the connect interaction (`request_connection` / render.kind "connect"). Elicitation
 * stays inline — it's a form the user fills in the transcript, and it carries its own
 * Decline/Dismiss actions; the composer's waiting state covers its visibility.
 */
import {memo, useCallback, useRef} from "react"

import {buildRenderMap, isPendingClientToolInteraction} from "@agenta/playground"
import {Plugs, Spinner} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {Button, Typography} from "antd"

import {clientToolMeta, type ClientToolMeta, type ClientToolOutputHandler} from "./clientTools"
import type {SettleClientTool} from "./clientTools/types"
import {useConnectFlow} from "./clientTools/useConnectFlow"

const {Text} = Typography

/** Whether this client-tool meta is the connect interaction (registry's two dispatch axes). */
const isConnectInteraction = (meta: ClientToolMeta): boolean =>
    meta.renderKind === "connect" || meta.toolName === "request_connection"

/**
 * The parked connect interaction the run is currently blocked on, or null. Like
 * `getPendingApprovals`, HITL only ever pauses the LAST assistant turn (see `isHitlPending`), so
 * only that turn is read. The runner parks one interaction per turn — first match wins.
 */
export const getPendingConnectInteraction = (messages: UIMessage[]): ClientToolMeta | null => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return null
    const parts = last.parts ?? []
    const renderMap = buildRenderMap(parts as {type?: string; data?: unknown}[])
    for (const part of parts) {
        if (!isPendingClientToolInteraction(part as {type?: string; state?: string}, renderMap))
            continue
        const meta = clientToolMeta(part as ToolUIPart, renderMap)
        if (isConnectInteraction(meta)) return meta
    }
    return null
}

/** The dock's connect card: header + per-phase body + actions, driven by the shared OAuth flow. */
const ConnectCard = ({
    meta,
    onOutput,
    active,
}: {
    meta: ClientToolMeta
    onOutput: ClientToolOutputHandler
    active: boolean
}) => {
    // Same settle mapping as ClientToolPart — the dock is a second dispatch site for this part.
    const settle = useCallback<SettleClientTool>(
        (args: {output: Record<string, unknown>} | {errorText: string}) => {
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
    const {label, phase, errorText, runConnect, cancel, decline} = useConnectFlow(
        meta,
        settle,
        active,
    )

    return (
        <div className="ag-surface-chat mb-2 flex flex-col gap-2.5 rounded-lg p-3">
            {/* Header: a quiet primary cue, same visual language as the approval dock's header. */}
            <div className="flex items-center gap-2">
                <Plugs size={15} weight="fill" className="shrink-0 text-colorPrimary" />
                <Text className="!text-xs !font-medium">The agent is waiting for you</Text>
            </div>

            {phase === "connecting" ? (
                <div className="flex items-center gap-2">
                    <Spinner size={13} className="shrink-0 animate-spin text-colorPrimary" />
                    <Text type="secondary" className="!text-xs">
                        Connecting {label}… finish signing in from the popup window.
                    </Text>
                </div>
            ) : phase === "error" ? (
                <Text type="danger" className="!text-xs" title={errorText ?? undefined}>
                    {errorText ?? "Connection failed."}
                </Text>
            ) : (
                <Text type="secondary" className="!text-xs">
                    Connect <span className="font-medium text-colorText">{label}</span> to let the
                    agent continue, or continue without the connection.
                </Text>
            )}

            <div className="flex items-center justify-end gap-1.5">
                {phase === "connecting" ? (
                    <Button onClick={cancel}>Cancel</Button>
                ) : (
                    <>
                        <Button onClick={decline}>Not now</Button>
                        <Button type="primary" onClick={() => runConnect(true)}>
                            {phase === "error" ? "Retry" : `Connect ${label}`}
                        </Button>
                    </>
                )}
            </div>
        </div>
    )
}

interface InteractionDockProps {
    /** The parked connect interaction the run is blocked on (from `getPendingConnectInteraction`). */
    pending: ClientToolMeta | null
    /** Settle channel — the panel maps this onto `addToolOutput` (marks the resume as live). */
    onOutput: ClientToolOutputHandler
    className?: string
}

/**
 * Always mounted; enter + leave animate via the grid-rows 0fr↔1fr height collapse (+ opacity), the
 * same idiom as ApprovalDock. `inert` while closed drops the (clipped, latched) card from tab order
 * + a11y so a keyboard user can't reach hidden buttons.
 */
const InteractionDock = ({pending, onOutput, className}: InteractionDockProps) => {
    const open = !!pending
    // Latch the last pending interaction so the card persists through the height collapse.
    const shownRef = useRef(pending)
    if (pending) shownRef.current = pending
    const shown = shownRef.current
    const shownIsActive = !!pending && shown?.toolCallId === pending.toolCallId

    return (
        <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            } ${className ?? ""}`}
            inert={!open}
        >
            <div className="min-h-0 overflow-hidden">
                {shown ? (
                    // Keyed by call id so flow state (phase/popup) resets per parked call.
                    <ConnectCard
                        key={shown.toolCallId}
                        meta={shown}
                        onOutput={onOutput}
                        active={shownIsActive}
                    />
                ) : null}
            </div>
        </div>
    )
}

export default memo(InteractionDock)
