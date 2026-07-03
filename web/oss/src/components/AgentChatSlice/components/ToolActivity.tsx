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
import {Typography} from "antd"

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

/** Strip a surrounding markdown code fence — backends wrap tool output/errors in ```…```. */
const stripFence = (value: string): string => {
    const m = value.trim().match(/^```[\w-]*\n?([\s\S]*?)\n?```$/)
    return m ? m[1].trim() : value
}

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
        const s = stripFence(output).trim().replace(/\s+/g, " ")
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
    // An answered gate whose execution landed on a sibling part (cold-replay fresh id). Usually
    // deduped away in AgentMessage; if it slips through, show it as approved — never a stuck spinner.
    if (state === "approval-responded")
        return <CheckCircle size={13} className="shrink-0 text-colorTextTertiary" />
    return <Spinner size={13} className="shrink-0 animate-spin text-colorPrimary" />
}

/** Pretty-print a tool input/output value for the Build-mode step log: a string as-is, anything
 * else as indented JSON. Never throws — the raw payload also lives in the trace drawer. */
const formatValue = (value: unknown): string => {
    if (typeof value === "string") return value
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

/** One labeled monospace block (input / output / error) in the Build-mode step log. Capped in
 * height with its own scroll so a large payload can't blow up the transcript. */
const IOBlock = ({label, value, danger}: {label: string; value: string; danger?: boolean}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[10px] text-colorTextTertiary">{label}</span>
        <pre
            className={`ag-surface-inset m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-[11px] leading-snug ${
                danger
                    ? "!bg-[var(--ant-color-error-bg)] !border-transparent !text-colorErrorText"
                    : "text-colorTextSecondary"
            }`}
        >
            {value}
        </pre>
    </div>
)

/** One tool's row: name + status, plus (in Build's `detailed` step log) the tool's input and its
 * output/error as monospace blocks. Chat mode keeps the quiet one-line summary. The Approve/Deny
 * action lives in the persistent ApprovalDock, so a gate here is just marked "Awaiting approval". */
const ToolRow = ({
    part,
    live,
    detailed = false,
}: {
    part: ToolUIPart
    live: boolean
    detailed?: boolean
}) => {
    const name = partToolName(part)
    const state = part.state as string
    // `approval-responded` is resolved (the user answered) — not "running". Its execution shows on
    // a sibling part, so this must not spin forever (the cold-replay lingering-gate spinner).
    const running =
        !isSettled(state) && state !== "approval-requested" && state !== "approval-responded"
    // The line after the name: an awaiting-approval marker, a live "running…", the settled one-line
    // summary (Chat), or a short status word (Build shows the full output block below instead).
    const midText =
        state === "approval-requested"
            ? "Awaiting approval"
            : state === "approval-responded"
              ? "approved"
              : live && running
                ? "running…"
                : detailed
                  ? state === "output-error"
                      ? "failed"
                      : state === "output-denied"
                        ? "denied"
                        : null
                  : rowSummary(part)

    const input = (part as {input?: unknown}).input
    const output = (part as {output?: unknown}).output
    const errorText = (part as {errorText?: string}).errorText
    const hasIO =
        detailed && (input != null || state === "output-available" || errorText !== undefined)
    // Each detailed step collapses on its own — Build's step log can get long. Default expanded.
    const [open, setOpen] = useState(true)

    const header = (
        <>
            <StatusIcon state={state} />
            <Text className="!text-xs !font-medium min-w-0 truncate" title={name}>
                {name}
            </Text>
            {midText ? (
                <Text
                    type={state === "output-error" ? "danger" : "secondary"}
                    className="!text-xs min-w-0 truncate"
                    title={typeof midText === "string" ? midText : undefined}
                >
                    {midText}
                </Text>
            ) : null}
        </>
    )

    return (
        <div className="flex min-w-0 flex-col py-1">
            {hasIO ? (
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    className="flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left"
                >
                    <CaretRight
                        size={11}
                        weight="bold"
                        className={`shrink-0 text-colorTextTertiary transition-transform ${
                            open ? "rotate-90" : ""
                        }`}
                    />
                    {header}
                </button>
            ) : (
                <div className="flex min-w-0 items-center gap-2">{header}</div>
            )}

            {hasIO ? (
                <HeightCollapse open={open}>
                    <div className="mt-1 flex min-w-0 flex-col gap-1.5 pl-[21px]">
                        {input != null ? (
                            <IOBlock label="input" value={formatValue(input)} />
                        ) : null}
                        {errorText !== undefined ? (
                            <IOBlock label="error" value={stripFence(errorText)} danger />
                        ) : state === "output-available" && output != null ? (
                            <IOBlock
                                label="output"
                                value={
                                    // Backends wrap tool results in a markdown code fence (```console
                                    // …```) for the model; the IOBlock is already a monospace <pre>, so
                                    // strip the redundant fence instead of printing the backticks.
                                    typeof output === "string"
                                        ? stripFence(output)
                                        : formatValue(output)
                                }
                            />
                        ) : null}
                    </div>
                </HeightCollapse>
            ) : null}
        </div>
    )
}

interface ToolActivityProps {
    /** A run of consecutive tool parts within one assistant turn. */
    parts: ToolUIPart[]
    /** This turn is the one being generated right now. */
    isStreaming?: boolean
    /** Build mode: render the full step log (per-tool input + output/error inline), instead of the
     * calm collapsed "Used N tools" summary Chat mode shows. */
    detailed?: boolean
    /** Open the turn's trace drawer (full input/output). Absent if the turn has no trace yet. */
    onViewTrace?: () => void
}

/**
 * Renders a group of tool calls inside an agent turn. Three modes:
 *  - **Build step log** (`detailed`): a left-gutter timeline of every tool with its input and
 *    output/error as monospace blocks — the power-user view, scoped to Build mode.
 *  - **Live** (streaming + a tool still in flight, Chat mode): the same gutter but one-line rows,
 *    so you watch each tool fire.
 *  - **Chat settled**: a single quiet "Used N tools" line; click to expand a one-line-summary list.
 *
 * An `approval-requested` tool is marked "Awaiting approval" in every mode; the Approve/Deny action
 * lives in the persistent ApprovalDock. The FE only renders tool calls — it never executes them.
 */
const ToolActivity = ({
    parts,
    isStreaming = false,
    detailed = false,
    onViewTrace,
}: ToolActivityProps) => {
    const anyUnsettled = parts.some((p) => !isSettled(p.state as string))
    const live = isStreaming && anyUnsettled
    const approvalPending = parts.some((p) => (p.state as string) === "approval-requested")

    const [open, setOpen] = useState(false)
    // Keep the gate visible in-context: force the list open whenever one is awaiting approval.
    const expanded = open || approvalPending

    // ---- Build step log (detailed) OR live streaming: the gutter timeline, always visible ----
    if (detailed || live) {
        return (
            <div className="flex min-w-0 flex-col border-0 border-l-2 border-solid border-colorBorderSecondary pl-3">
                {parts.map((part, i) => (
                    <ToolRow
                        key={`${part.toolCallId || part.type}-${i}`}
                        part={part}
                        live={live}
                        detailed={detailed}
                    />
                ))}
                {detailed && onViewTrace ? (
                    <button
                        type="button"
                        onClick={onViewTrace}
                        className="mt-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-0 py-0.5 text-xs text-colorPrimary transition-colors hover:underline"
                    >
                        <ArrowSquareOut size={12} />
                        View full trace
                    </button>
                ) : null}
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
