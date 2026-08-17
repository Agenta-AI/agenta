import {memo} from "react"

import {formatToolValue, stripFence} from "@agenta/chat/assets"
import {
    APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX,
    DEFERRED_NOT_EXECUTED_PREFIX,
} from "@agenta/chat/assets"
import {partToolName} from "@agenta/chat/model"
import {
    expandedValueAtomFamily,
    setExpandedAtom,
    toolGroupKey,
    toolRowKey,
} from "@agenta/chat/state"
import {detectFileActivity, type FileActivity} from "@agenta/entities/session"
import {DriveFileCard} from "@agenta/entity-ui/drive"
import {HeightCollapse} from "@agenta/ui"
import {
    CaretRight,
    CheckCircle,
    Clock,
    Info,
    Prohibit,
    Spinner,
    Warning,
    Wrench,
} from "@phosphor-icons/react"
import type {ToolUIPart} from "ai"
import {useAtomValue, useSetAtom} from "jotai"

import {extractCallDescription, resolveToolDisplay, type ToolDisplay} from "../assets/toolDisplay"

// A tool has finished when it produced output, errored, or was denied. Everything else
// (preparing input, running, awaiting/just-answered an approval) is still in flight.
const SETTLED = new Set(["output-available", "output-error", "output-denied"])
const isSettled = (state: string) => SETTLED.has(state)

const isDeferredError = (errorText: string | undefined): boolean =>
    !!errorText && errorText.startsWith(DEFERRED_NOT_EXECUTED_PREFIX)
const isUnknownResultError = (errorText: string | undefined): boolean =>
    !!errorText && errorText.startsWith(APPROVED_EXECUTION_RESULT_UNKNOWN_PREFIX)
const isNonFinalRunnerError = (errorText: string | undefined): boolean =>
    isDeferredError(errorText) || isUnknownResultError(errorText)

const isNotHandledOutput = (output: unknown): boolean =>
    !!output &&
    typeof output === "object" &&
    (output as {status?: unknown}).status === "not_handled"

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

const rowSummary = (part: ToolUIPart, display?: ToolDisplay): string | null => {
    if (part.state === "output-available") {
        if (isNotHandledOutput(part.output)) return "not handled by this client"
        // A registered per-tool summary wins; run it through the generic normalizer for the
        // same whitespace/length clamp. Falls back to shape heuristics when it returns null.
        const custom = display?.summary?.((part as {input?: unknown}).input, part.output)
        if (typeof custom === "string" && custom.trim()) {
            return summarizeOutput(custom) ?? summarizeOutput(part.output)
        }
        return summarizeOutput(part.output)
    }
    if (part.state === "output-error") {
        const errorText = (part as {errorText?: string}).errorText
        if (isDeferredError(errorText)) return "waiting on another approval"
        if (isUnknownResultError(errorText)) return "approved, result unknown"
        return "failed"
    }
    if (part.state === "output-denied") return "denied"
    return null
}

/** Per-tool status glyph, shared by the live gutter and the expanded list. */
const StatusIcon = ({part}: {part: ToolUIPart}) => {
    const state = part.state as string
    if (state === "output-available") {
        if (isNotHandledOutput((part as {output?: unknown}).output))
            return <Info size={13} className="shrink-0 text-colorTextTertiary" />
        return <CheckCircle size={13} weight="fill" className="shrink-0 text-colorSuccess" />
    }
    if (state === "output-error") {
        if (isNonFinalRunnerError((part as {errorText?: string}).errorText))
            return <Clock size={13} className="shrink-0 text-colorTextTertiary" />
        return <Warning size={13} weight="fill" className="shrink-0 text-colorError" />
    }
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

/** One labeled monospace block (input / output / error) in the Build-mode step log. Capped in
 * height with its own scroll so a large payload can't blow up the transcript. */
const IOBlock = ({label, value, danger}: {label: string; value: string; danger?: boolean}) => (
    <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-[12px] text-colorTextTertiary">{label}</span>
        <pre
            className={`ag-surface-inset m-0 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded px-2 py-1.5 font-mono text-xs leading-snug ${
                danger
                    ? "!bg-[var(--ant-color-error-bg)] !border-transparent !text-colorErrorText"
                    : "text-colorTextSecondary"
            }`}
        >
            {value}
        </pre>
    </div>
)

/** One tool row: humanized name + status + summary; Build rows expand to input/output blocks. */
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
    // Humanized label in both modes; the raw wire name stays reachable via the tooltip.
    const display = resolveToolDisplay(name)
    const shownName = display.label
    const state = part.state as string
    const input = (part as {input?: unknown}).input
    const output = (part as {output?: unknown}).output
    const errorText = (part as {errorText?: string}).errorText
    const nonFinalError = state === "output-error" && isNonFinalRunnerError(errorText)
    // `approval-responded` is resolved (the user answered) — not "running". Its execution shows on
    // a sibling part, so this must not spin forever (the cold-replay lingering-gate spinner).
    const running =
        !isSettled(state) && state !== "approval-requested" && state !== "approval-responded"
    // Status line: an approval marker, a live "running…", or the settled one-line summary.
    const midText =
        state === "approval-requested"
            ? "Awaiting approval"
            : state === "approval-responded"
              ? (part as {approval?: {approved?: boolean}}).approval?.approved === false
                  ? "denied"
                  : "approved"
              : live && running
                ? "running…"
                : rowSummary(part, display)

    // Track presence explicitly: a legit `null` output is real (don't hide it), and
    // `output-available` with no `output` key must not open an empty expander.
    const hasInput = input !== undefined
    const hasOutput = state === "output-available" && output !== undefined
    const hasError = errorText !== undefined
    const hasIO = detailed && (hasInput || hasOutput || hasError)
    // Default COLLAPSED: the inline Build step log stays a compact name+status timeline; the full
    // per-tool input/output lives in the Turn Inspector. Click a row to expand its I/O in place.
    // Persisted by tool-call id so the expanded state survives a Virtuoso unmount (scroll-off).
    const rowKey = toolRowKey((part as {toolCallId?: string}).toolCallId ?? name)
    const stored = useAtomValue(expandedValueAtomFamily(rowKey))
    const setExpanded = useSetAtom(setExpandedAtom)
    const open = stored ?? false
    // The agent's own note about this call (R12). Always shown: explaining the call is its job.
    const callDescription = extractCallDescription(input)

    const header = (
        <>
            <StatusIcon part={part} />
            <span className="min-w-0 truncate text-xs font-medium text-colorText" title={name}>
                {shownName}
            </span>
            {!detailed && display.source ? (
                <span className="shrink-0 whitespace-nowrap text-xs text-colorTextSecondary">
                    {display.source}
                </span>
            ) : null}
            {midText ? (
                <span
                    className={`min-w-0 truncate text-xs ${
                        state === "output-error" && !nonFinalError
                            ? "text-colorError"
                            : "text-colorTextSecondary"
                    }`}
                    title={typeof midText === "string" ? midText : undefined}
                >
                    {midText}
                </span>
            ) : null}
        </>
    )

    return (
        <div className="flex min-w-0 flex-col py-1">
            {hasIO ? (
                <button
                    type="button"
                    onClick={() => setExpanded({key: rowKey, value: !open})}
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

            {callDescription ? (
                <span
                    className="mt-0.5 pl-[21px] text-xs italic leading-snug text-colorTextSecondary"
                    title={callDescription.text}
                >
                    {callDescription.text}
                    {callDescription.truncated ? "… (shortened)" : ""}
                </span>
            ) : null}

            {hasIO ? (
                <HeightCollapse open={open}>
                    <div className="mt-1 flex min-w-0 flex-col gap-1.5 pl-[21px]">
                        {hasInput ? <IOBlock label="input" value={formatToolValue(input)} /> : null}
                        {hasError ? (
                            <IOBlock
                                label={nonFinalError ? "note" : "error"}
                                value={stripFence(errorText)}
                                danger={!nonFinalError}
                            />
                        ) : hasOutput ? (
                            <IOBlock label="output" value={formatToolValue(output)} />
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
    /** Build mode: expanded rows expose full input/output/error payload expanders. */
    detailed?: boolean
}

/**
 * A group of tool calls in one turn: a live gutter timeline while streaming, else a collapsed
 * "Used N tools" summary. Approve/Deny lives in the ApprovalDock; the FE never executes tools.
 */
const ToolActivity = ({parts, isStreaming = false, detailed = false}: ToolActivityProps) => {
    const anyUnsettled = parts.some((p) => !isSettled(p.state as string))
    const live = isStreaming && anyUnsettled
    const approvalPending = parts.some((p) => (p.state as string) === "approval-requested")

    // One card per file this group wrote (successful calls only, last op per path wins).
    const fileCards = dedupeByPath(
        parts
            .filter((p) => (p.state as string) === "output-available")
            .map((p) => detectFileActivity(partToolName(p), (p as {input?: unknown}).input))
            .filter((a): a is FileActivity => Boolean(a)),
    )

    // Persisted by the group's first tool-call id so the expanded list survives a Virtuoso unmount.
    const groupKey = toolGroupKey(parts[0]?.toolCallId ?? "grp")
    const stored = useAtomValue(expandedValueAtomFamily(groupKey))
    const setExpanded = useSetAtom(setExpandedAtom)
    const open = stored ?? false
    // Keep the gate visible in-context: force the list open whenever one is awaiting approval.
    const expanded = open || approvalPending

    // ---- Live: the gutter timeline while tools are in flight ----
    if (live) {
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
                {fileCards.length ? (
                    <div className="flex flex-wrap gap-1.5 pt-1.5">
                        {fileCards.map((a) => (
                            <DriveFileCard key={a.path} path={a.path} op={a.op} />
                        ))}
                    </div>
                ) : null}
            </div>
        )
    }

    // ---- Settled: the quiet "Used N tools" line + expandable list ----
    const failed = parts.filter(
        (p) =>
            (p.state as string) === "output-error" &&
            !isNonFinalRunnerError((p as {errorText?: string}).errorText),
    ).length
    const count = parts.length
    const single = count === 1 ? resolveToolDisplay(partToolName(parts[0])) : null
    const label = single
        ? `Used ${single.label}${single.source ? ` · ${single.source}` : ""}`
        : `Used ${count} tools`
    const SummaryIcon = failed > 0 ? Warning : CheckCircle

    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            {fileCards.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {fileCards.map((a) => (
                        <DriveFileCard key={a.path} path={a.path} op={a.op} />
                    ))}
                </div>
            ) : null}
            <button
                type="button"
                onClick={() => setExpanded({key: groupKey, value: !open})}
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
                <span className="text-xs text-colorTextSecondary" title={single?.raw}>
                    {label}
                    {failed > 0 ? ` · ${failed} failed` : ""}
                </span>
            </button>

            <HeightCollapse open={expanded}>
                <div className="flex min-w-0 flex-col pt-1 pl-[18px]">
                    {parts.map((part, i) => (
                        <ToolRow
                            key={`${part.toolCallId || part.type}-${i}`}
                            part={part}
                            live={false}
                            detailed={detailed}
                        />
                    ))}
                </div>
            </HeightCollapse>
        </div>
    )
}

/** Last activity per path wins (a write followed by an edit renders one "Updated" card). */
const dedupeByPath = (activities: FileActivity[]): FileActivity[] => {
    const byPath = new Map<string, FileActivity>()
    for (const a of activities) byPath.set(a.path, a)
    return [...byPath.values()]
}

export default memo(ToolActivity)
