import {memo, useState} from "react"

import {HeightCollapse} from "@agenta/ui"
import {
    ArrowSquareOut,
    CaretRight,
    CheckCircle,
    Prohibit,
    Spinner,
    Warning,
    Wrench,
} from "@phosphor-icons/react"
import type {ToolUIPart} from "ai"
import {Button, Typography} from "antd"

import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"

const {Text} = Typography

/** Friendly name for a tool part. `dynamic-tool` carries the name on `toolName`; the typed
 * tool parts encode it as `tool-<name>`. */
const partToolName = (part: ToolUIPart): string => {
    // `dynamic-tool` parts (name on `toolName`) reach here via the grouping cast in
    // AgentMessage, but they're outside ToolUIPart's static union — read `type` as a string.
    const type = part.type as string
    if (type === "dynamic-tool") {
        return (part as {toolName?: string}).toolName || "tool"
    }
    return type.replace(/^tool-/, "")
}

// A tool has finished when it produced output, errored, or was denied. Everything else
// (preparing input, running, awaiting/just-answered an approval) is still in flight.
const SETTLED = new Set(["output-available", "output-error", "output-denied"])
const isSettled = (state: string) => SETTLED.has(state)

/**
 * Derive a single human line from a tool's output. Output shape is arbitrary, so this stays
 * conservative: it recognises the common shapes and otherwise returns null (the row then shows
 * just the tool name + status). Never throws — the full payload lives in the trace drawer.
 */
const summarizeOutput = (output: unknown): string | null => {
    if (output == null) return null
    if (Array.isArray(output)) {
        return `${output.length} result${output.length === 1 ? "" : "s"}`
    }
    if (typeof output === "string") {
        const s = output.trim().replace(/\s+/g, " ")
        if (!s) return null
        return s.length > 80 ? `${s.slice(0, 80)}…` : s
    }
    if (typeof output === "object") {
        const o = output as Record<string, unknown>
        for (const k of ["summary", "result", "content", "text", "message", "title"]) {
            const v = o[k]
            if (typeof v === "string" && v.trim()) return summarizeOutput(v)
        }
        const keys = Object.keys(o)
        if (keys.length === 0) return null
        return `${keys.length} field${keys.length === 1 ? "" : "s"}`
    }
    return String(output)
}

const rowSummary = (part: ToolUIPart): string | null => {
    if (part.state === "output-available") return summarizeOutput(part.output)
    if (part.state === "output-error") return "failed"
    if (part.state === "output-denied") return "denied"
    return null
}

/** Per-tool status glyph, shared by the live gutter and the expanded list. */
const StatusIcon = ({state}: {state: string}) => {
    if (state === "output-available")
        return <CheckCircle size={13} weight="fill" className="shrink-0 text-colorSuccess" />
    if (state === "output-error")
        return <Warning size={13} weight="fill" className="shrink-0 text-colorError" />
    if (state === "output-denied")
        return <Prohibit size={13} className="shrink-0 text-colorTextTertiary" />
    if (state === "approval-requested")
        return <Wrench size={13} className="shrink-0 text-colorWarning" />
    return <Spinner size={13} className="shrink-0 animate-spin text-colorPrimary" />
}

interface ApprovalRef {
    id: string
    approved?: boolean
    reason?: string
}

const ApprovalButtons = ({
    approvalId,
    onApprovalResponse,
}: {
    approvalId: string
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
}) => {
    // Guard a double-submit between the click and the SDK flipping the part to
    // `approval-responded` (which removes the buttons). Not tied to conversation `busy` —
    // an approval can only appear mid-stream, so gating on busy would disable it the whole turn.
    const [responding, setResponding] = useState(false)
    const posthog = usePostHogAg()
    const respond = (approved: boolean) => {
        if (responding) return
        setResponding(true)
        posthog?.capture("agent_tool_approval_submitted", {approved})
        onApprovalResponse({id: approvalId, approved})
    }
    return (
        <div className="ml-auto flex items-center gap-1.5">
            <Button type="primary" loading={responding} onClick={() => respond(true)}>
                Approve
            </Button>
            <Button disabled={responding} onClick={() => respond(false)}>
                Deny
            </Button>
        </div>
    )
}

/** One tool's row: name, derived one-line summary, status. Used in both modes. */
const ToolRow = ({
    part,
    live,
    onApprovalResponse,
}: {
    part: ToolUIPart
    live: boolean
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
}) => {
    const name = partToolName(part)
    const state = part.state as string
    const approval = (part as {approval?: ApprovalRef}).approval
    const summary = rowSummary(part)
    const running = !isSettled(state) && state !== "approval-requested"
    // The line between the name and the trailing status/buttons: the prompt for an approval,
    // a live "running…", or the settled one-line output summary.
    const midText =
        state === "approval-requested" ? "Run this tool?" : live && running ? "running…" : summary

    return (
        <div className="flex min-w-0 items-center gap-2 py-1">
            <StatusIcon state={state} />
            <Text className="!text-xs !font-medium shrink-0">{name}</Text>
            {midText ? (
                <Text
                    type={state === "output-error" ? "danger" : "secondary"}
                    className="!text-xs truncate"
                    title={typeof midText === "string" ? midText : undefined}
                >
                    {midText}
                </Text>
            ) : null}

            {state === "approval-requested" && approval?.id ? (
                <ApprovalButtons approvalId={approval.id} onApprovalResponse={onApprovalResponse} />
            ) : null}
        </div>
    )
}

interface ToolActivityProps {
    /** A run of consecutive tool parts within one assistant turn. */
    parts: ToolUIPart[]
    /** This turn is the one being generated right now. */
    isStreaming?: boolean
    onApprovalResponse: (args: {id: string; approved: boolean}) => void
    /** Open the turn's trace drawer (full input/output). Absent if the turn has no trace yet. */
    onViewTrace?: () => void
}

/**
 * Renders a group of tool calls inside an agent turn. Two modes:
 *  - **Live** (streaming + a tool still in flight): a left-gutter timeline, always shown, so
 *    you watch each tool fire. An `approval-requested` tool surfaces Approve/Deny inline.
 *  - **Settled**: a single quiet "Used N tools" line; click to expand the per-tool list with
 *    one-line output summaries and a "View full trace" link.
 *
 * Output is summarised to one line per tool; the raw input/output lives in the trace drawer.
 * The FE only renders tool calls — it never executes them.
 */
const ToolActivity = ({
    parts,
    isStreaming = false,
    onApprovalResponse,
    onViewTrace,
}: ToolActivityProps) => {
    const anyUnsettled = parts.some((p) => !isSettled(p.state as string))
    const live = isStreaming && anyUnsettled
    const approvalPending = parts.some((p) => (p.state as string) === "approval-requested")

    const [open, setOpen] = useState(false)
    // An approval must stay reachable, so force the list open whenever one is pending.
    const expanded = open || approvalPending

    // ---- Live: the gutter timeline (always visible while tools are in flight) ----
    if (live) {
        return (
            <div className="flex min-w-0 flex-col border-0 border-l-2 border-solid border-colorBorderSecondary pl-3">
                {parts.map((part, i) => (
                    <ToolRow
                        key={`${part.toolCallId || part.type}-${i}`}
                        part={part}
                        live
                        onApprovalResponse={onApprovalResponse}
                    />
                ))}
            </div>
        )
    }

    // ---- Settled: the quiet "Used N tools" line + expandable list ----
    const failed = parts.filter((p) => (p.state as string) === "output-error").length
    const count = parts.length
    const label = count === 1 ? `Used ${partToolName(parts[0])}` : `Used ${count} tools`
    const SummaryIcon = failed > 0 ? Warning : CheckCircle

    return (
        <div className="flex min-w-0 flex-col">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-expanded={expanded}
                className="-ml-1 flex w-fit max-w-full cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1 py-0.5 text-left transition-colors hover:bg-colorFillQuaternary"
            >
                <CaretRight
                    size={11}
                    weight="bold"
                    className={`shrink-0 text-colorTextTertiary transition-transform ${
                        expanded ? "rotate-90" : ""
                    }`}
                />
                <SummaryIcon
                    size={13}
                    weight="fill"
                    className={`shrink-0 ${failed > 0 ? "text-colorError" : "text-colorSuccess"}`}
                />
                <Text type="secondary" className="!text-xs">
                    {label}
                    {failed > 0 ? ` · ${failed} failed` : ""}
                </Text>
            </button>

            <HeightCollapse open={expanded}>
                <div className="flex min-w-0 flex-col pt-1 pl-[18px]">
                    {parts.map((part, i) => (
                        <ToolRow
                            key={`${part.toolCallId || part.type}-${i}`}
                            part={part}
                            live={false}
                            onApprovalResponse={onApprovalResponse}
                        />
                    ))}
                    {onViewTrace && (
                        <button
                            type="button"
                            onClick={onViewTrace}
                            className="mt-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-0 py-0.5 text-xs text-colorPrimary transition-colors hover:underline"
                        >
                            <ArrowSquareOut size={12} />
                            View full trace
                        </button>
                    )}
                </div>
            </HeightCollapse>
        </div>
    )
}

export default memo(ToolActivity)
