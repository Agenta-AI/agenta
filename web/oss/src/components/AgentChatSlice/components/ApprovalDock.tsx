import {memo, useEffect, useMemo, useRef, useState} from "react"

import {HeightCollapse} from "@agenta/ui"
import {ArrowSquareOut, CaretRight, ShieldCheck} from "@phosphor-icons/react"
import type {ToolUIPart, UIMessage} from "ai"
import {Button, Typography} from "antd"

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

/** Friendly name for a tool part — mirrors ToolActivity: `dynamic-tool` carries `toolName`, typed
 * parts encode it as `tool-<name>`. */
const partToolName = (part: ToolUIPart): string => {
    const type = part.type as string
    if (type === "dynamic-tool") return (part as {toolName?: string}).toolName || "tool"
    return type.replace(/^tool-/, "")
}

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

/** A source label we can state factually from the tool name — not a guessed risk level. */
const sourceLabel = (name: string): string | null => {
    if (name.startsWith("mcp__")) return "MCP tool"
    return null
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

interface ApprovalDockProps {
    /** Pending gates for the paused turn (index 0 is acted on first). */
    approvals: PendingApproval[]
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
    /** Open the paused turn's trace drawer (full tool input/output). */
    onViewTrace?: () => void
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
    const [showPayload, setShowPayload] = useState(false)

    // The current gate changed (we answered one, the next slid in) — re-enable + recollapse.
    useEffect(() => {
        setResponding(false)
        setShowPayload(false)
    }, [current?.approvalId])

    const payload = useMemo(() => (current ? formatInput(current.input) : ""), [current])
    const payloadPreview = payload.replace(/\s+/g, " ").trim()

    const source = current ? sourceLabel(current.toolName) : null

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
                    <div className="ag-surface-chat mb-2 flex flex-col gap-2.5 rounded-lg p-3">
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

                        {/* Identity: which tool, plus a factual source tag when we can name one. */}
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

                        <Text type="secondary" className="!text-xs">
                            The agent wants to run this tool before it can keep going.
                        </Text>

                        {/* The payload — collapsed to a one-line preview, expandable to the full request. */}
                        {payload ? (
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
                                        Payload
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
                        ) : null}

                        {/* Actions: trace on the left, decision on the right. Approve is the single primary. */}
                        <div className="flex items-center gap-2">
                            {onViewTrace ? (
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
                                    Approve
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
