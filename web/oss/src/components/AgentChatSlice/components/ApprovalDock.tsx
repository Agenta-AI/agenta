import {memo, useEffect, useMemo, useRef, useState} from "react"

import {HeightCollapse} from "@agenta/ui"
import {ArrowSquareOut, CaretRight, ShieldCheck} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {Button, Typography} from "antd"
import {useAtomValue} from "jotai"

import {partToolName, resolveToolDisplay} from "../assets/toolDisplay"
import {chatPanelMaximizedAtom} from "../state/panelLayout"

import {resolveApprovalRenderer} from "./approvals/registry"

const {Text} = Typography

export interface PendingApproval {
    approvalId: string
    toolName: string
    input: unknown
}

interface ApprovalRef {
    id: string
}

const isToolPart = (type: string) => type.startsWith("tool-") || type === "dynamic-tool"

/**
 * Approvals the run is currently blocked on. HITL only ever pauses the LAST assistant turn (see
 * `isHitlPending`), so we read pending tool gates off that turn — a turn can request several at
 * once (parallel tool calls), so this returns all of them in order.
 */
export const getPendingApprovals = (messages: UIMessage[]): PendingApproval[] => {
    const last = messages[messages.length - 1]
    if (!last || last.role !== "assistant") return []
    const out: PendingApproval[] = []
    for (const part of last.parts ?? []) {
        const p = part as ToolUIPart
        const approval = (p as {approval?: ApprovalRef}).approval
        if (isToolPart(p.type as string) && p.state === "approval-requested" && approval?.id) {
            out.push({approvalId: approval.id, toolName: partToolName(p), input: p.input})
        }
    }
    return out
}

const formatInput = (input: unknown): string => {
    if (input == null) return ""
    // Keep the exact string — the user must approve the payload the tool actually receives. The
    // one-line preview normalizes whitespace; this expanded view must not alter it.
    if (typeof input === "string") return input
    try {
        return JSON.stringify(input, null, 2)
    } catch {
        return String(input)
    }
}

/** Collapsible exact-payload viewer — the generic approval body, and the fallback (plus the
 * Build-mode raw view) for specialized renderers. Owns its expand state so a specialized body
 * can render it anywhere; hosts key it by approval id to recollapse when the gate changes. */
const PayloadBlock = ({input, label = "Payload"}: {input: unknown; label?: string}) => {
    const [showPayload, setShowPayload] = useState(false)
    const payload = useMemo(() => formatInput(input), [input])
    const payloadPreview = payload.replace(/\s+/g, " ").trim()
    if (!payload) return null
    return (
        <div className="ag-surface-inset overflow-hidden rounded">
            <button
                type="button"
                onClick={() => setShowPayload((s) => !s)}
                aria-expanded={showPayload}
                className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent px-2.5 py-1.5 text-left"
            >
                <CaretRight
                    size={11}
                    weight="bold"
                    className={`shrink-0 text-colorTextTertiary transition-transform ${
                        showPayload ? "rotate-90" : ""
                    }`}
                />
                <span className="shrink-0 text-[11px] font-medium text-colorTextSecondary">
                    {label}
                </span>
                {!showPayload ? (
                    <span className="min-w-0 truncate font-mono text-[11px] text-colorTextTertiary">
                        {payloadPreview}
                    </span>
                ) : null}
            </button>
            <HeightCollapse open={showPayload}>
                <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap break-all px-2.5 pb-2.5 font-mono text-[11px] leading-snug text-colorTextSecondary">
                    {payload}
                </pre>
            </HeightCollapse>
        </div>
    )
}

interface ApprovalDockProps {
    /** Pending gates for the paused turn (index 0 is acted on first). */
    approvals: PendingApproval[]
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
    /** Open the paused turn's trace drawer (full tool input/output). */
    onViewTrace?: () => void
    /** Selected agent revision — enables per-tool friendly bodies (approvals/registry). */
    entityId?: string
    className?: string
}

/**
 * Persistent human-in-the-loop approval band. Lives in the composer region (between the transcript
 * and the input), NOT in the scrolling transcript, so a run paused on a tool gate can't scroll out
 * of reach. It owns the Approve/Deny action (the inline tool row is just an "Awaiting approval"
 * marker) and surfaces the request's context: which tool, its source, and the exact payload.
 *
 * A turn can request several gates at once; we act on the first and let the SDK flip its state,
 * which re-renders us onto the next — so `responding` resets whenever the current id changes.
 */
const ApprovalDock = ({
    approvals,
    onApprovalResponse,
    onViewTrace,
    entityId,
    className,
}: ApprovalDockProps) => {
    const open = approvals.length > 0
    // Latch the last non-empty set so the card stays visible while the dock animates closed — a
    // leave transition needs its content to persist through the height collapse.
    const shownRef = useRef(approvals)
    if (open) shownRef.current = approvals
    const shown = shownRef.current
    const current = shown[0]
    const count = shown.length

    const [responding, setResponding] = useState(false)

    // The current gate changed (we answered one, the next slid in) — re-enable.
    useEffect(() => {
        setResponding(false)
    }, [current?.approvalId])

    // Friendly bodies are Chat-mode (maximized) sugar and need a revision to diff against;
    // Build and the entityId-less host keep the exact-payload card.
    const chatMode = useAtomValue(chatPanelMaximizedAtom)
    const renderer =
        current && entityId && chatMode ? resolveApprovalRenderer(current.toolName) : null

    // Chat-mode display name: raw "scary" names stay Build-only; the shared resolver humanizes
    // gateway/MCP/plain names. Raw name stays reachable via the tooltip and the payload expander.
    const friendly = current ? resolveToolDisplay(current.toolName) : null
    // A source badge we can state factually from the tool name — not a guessed risk level.
    const source = friendly?.kind === "mcp" ? "MCP tool" : null

    const respond = (approved: boolean) => {
        if (responding || !current) return
        setResponding(true)
        onApprovalResponse({id: current.approvalId, approved})
    }
    const approveAll = () => {
        if (responding) return
        setResponding(true)
        shown.forEach((a) => onApprovalResponse({id: a.approvalId, approved: true}))
    }

    // Always mounted; enter + leave animate via the grid-rows 0fr↔1fr height collapse (+ opacity),
    // the same idiom as the reasoning block and composer attachments. `inert` while closed drops the
    // (clipped, latched) card from tab order + a11y so a keyboard user can't reach hidden buttons.
    return (
        <div
            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
            } ${className ?? ""}`}
            inert={!open}
        >
            <div className="min-h-0 overflow-hidden">
                {current ? (
                    // The friendly two-pane body needs more air than the one-line payload card.
                    <div
                        className={`ag-surface-chat mb-2 flex flex-col rounded-lg ${
                            renderer ? "gap-4 p-4" : "gap-2.5 p-3"
                        }`}
                    >
                        {/* Header: a quiet primary cue (not an error tint) + the ask + a count when batched. */}
                        <div className="flex items-center gap-2">
                            <ShieldCheck
                                size={15}
                                weight="fill"
                                className="shrink-0 text-colorPrimary"
                            />
                            <Text className="!text-xs !font-medium">
                                Approval needed to continue
                            </Text>
                            {count > 1 ? (
                                <Text
                                    type="secondary"
                                    className="!text-[11px] ml-auto tabular-nums"
                                >
                                    1 of {count}
                                </Text>
                            ) : null}
                        </div>

                        {/* Identity + ask. Build keeps the raw tool name (debuggers steer by it);
                            Chat folds a humanized name into one sentence — the raw name stays
                            reachable via the tooltip and the payload expander. A friendly body
                            (headline: null) already says what's happening — nothing extra. */}
                        {!renderer && !chatMode ? (
                            <div className="flex min-w-0 items-center gap-2">
                                <Text
                                    className="!text-xs !font-medium min-w-0 truncate"
                                    title={current.toolName}
                                >
                                    {current.toolName}
                                </Text>
                                {source ? (
                                    <span className="shrink-0 rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary px-1.5 py-px text-[11px] text-colorTextSecondary">
                                        {source}
                                    </span>
                                ) : null}
                            </div>
                        ) : null}

                        {renderer?.headline !== null ? (
                            !renderer && chatMode ? (
                                <Text
                                    type="secondary"
                                    className="!text-xs"
                                    title={current.toolName}
                                >
                                    The agent wants to use{" "}
                                    <span className="font-medium text-colorText">
                                        {friendly?.label}
                                    </span>
                                    {friendly?.source ? ` from ${friendly.source}` : ""} before it
                                    can keep going.
                                </Text>
                            ) : (
                                <Text type="secondary" className="!text-xs">
                                    {renderer?.headline ??
                                        "The agent wants to run this tool before it can keep going."}
                                </Text>
                            )
                        ) : null}

                        {/* Body: friendly per-tool preview when registered, else the exact payload.
                            Keyed by approval id so expand state recollapses when the gate changes. */}
                        {renderer && entityId ? (
                            <renderer.Body
                                key={current.approvalId}
                                input={current.input}
                                entityId={entityId}
                                fallback={<PayloadBlock input={current.input} />}
                            />
                        ) : (
                            <PayloadBlock
                                key={current.approvalId}
                                input={current.input}
                                label={chatMode ? "Details" : "Payload"}
                            />
                        )}

                        {/* Actions: trace on the left, decision on the right. Approve is the single primary.
                            The trace link is Build-only chrome — Chat keeps the payload expander instead. */}
                        <div className="flex items-center gap-2">
                            {onViewTrace && !chatMode ? (
                                <button
                                    type="button"
                                    onClick={onViewTrace}
                                    className="flex cursor-pointer items-center gap-1 border-0 bg-transparent px-0 py-0.5 text-xs text-colorPrimary transition-colors hover:underline"
                                >
                                    <ArrowSquareOut size={12} />
                                    View full trace
                                </button>
                            ) : null}
                            <div className="ml-auto flex items-center gap-1.5">
                                {count > 1 ? (
                                    <Button disabled={responding} onClick={approveAll}>
                                        Approve all
                                    </Button>
                                ) : null}
                                <Button disabled={responding} onClick={() => respond(false)}>
                                    Deny
                                </Button>
                                <Button
                                    type="primary"
                                    loading={responding}
                                    onClick={() => respond(true)}
                                >
                                    {renderer?.approveLabel ?? "Approve"}
                                </Button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    )
}

export default memo(ApprovalDock)
