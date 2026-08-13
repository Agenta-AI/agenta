import {memo} from "react"

import {useToolIntegrationDetail} from "@agenta/entities/gatewayTool"
import {detectFileActivity, type FileActivity} from "@agenta/entities/session"
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
import {Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {DriveFileCard} from "@/oss/components/Drives/DriveFileCard"

import {
    extractCallDescription,
    partToolName,
    resolveToolDisplay,
    type ToolDisplay,
} from "../assets/toolDisplay"
import {formatToolValue, stripFence} from "../assets/toolFormat"
import {
    groupLabelText,
    hasFailed,
    isNonFinalRunnerError,
    isNotHandledOutput,
    isSettled,
    partSentence,
    rowSummary,
} from "../assets/toolRow"
import {
    expandedValueAtomFamily,
    setExpandedAtom,
    toolGroupKey,
    toolRowKey,
} from "../state/expandState"

const {Text} = Typography

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

/**
 * Re-resolve a tool once the catalog names its app ("GitHub", not "Github").
 *
 * Only tools with a catalog slug subscribe. Rows live inside a virtualized transcript and mount and
 * unmount on every scroll, and this query carries an IndexedDB persister, so a subscription per row
 * would charge every session for a lookup that almost none of them need.
 */
const CatalogToolRow = ({base, ...props}: ToolRowProps & {base: ToolDisplay}) => {
    const {integration} = useToolIntegrationDetail(base.sourceKey ?? "")
    const display = integration?.name
        ? resolveToolDisplay(
              base.raw,
              (props.part as {input?: unknown}).input,
              integration.name,
              (props.part as {output?: unknown}).output,
          )
        : base
    return <ToolRowView {...props} display={display} />
}

const ToolSource = ({display}: {display: ToolDisplay}) => {
    if (!display.source) return null
    return (
        <Text type="secondary" className="!text-xs shrink-0 whitespace-nowrap">
            {display.source}
        </Text>
    )
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

interface ToolRowProps {
    part: ToolUIPart
    live: boolean
    detailed?: boolean
}

/** One tool row: humanized name + status + summary; Build rows expand to input/output blocks. */
const ToolRowView = memo(
    ({part, live, detailed = false, display}: ToolRowProps & {display: ToolDisplay}) => {
        const name = partToolName(part)
        const state = part.state as string
        const input = (part as {input?: unknown}).input
        const output = (part as {output?: unknown}).output
        const errorText = (part as {errorText?: string}).errorText
        const nonFinalError = state === "output-error" && isNonFinalRunnerError(errorText)
        // `approval-responded` is resolved (the user answered) — not "running". Its execution shows on
        // a sibling part, so this must not spin forever (the cold-replay lingering-gate spinner).
        const running =
            !isSettled(state) && state !== "approval-requested" && state !== "approval-responded"
        const shownName = partSentence(part, display)
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
                {/* The sentence never yields: the detail and status beside it absorb the squeeze. */}
                <Text className="!text-xs max-w-full shrink-0 truncate" title={name}>
                    {shownName}
                </Text>
                {display.detail ? (
                    <Text
                        type="secondary"
                        className="!text-xs font-mono min-w-0 truncate"
                        title={display.detail}
                    >
                        {display.detail}
                    </Text>
                ) : null}
                <ToolSource display={display} />
                {midText ? (
                    <Text
                        type={state === "output-error" && !nonFinalError ? "danger" : "secondary"}
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
                    <Text
                        type="secondary"
                        className="!text-xs mt-0.5 pl-[21px] italic leading-snug"
                        title={callDescription.text}
                    >
                        {callDescription.text}
                        {callDescription.truncated ? "… (shortened)" : ""}
                    </Text>
                ) : null}

                {hasIO ? (
                    <HeightCollapse open={open}>
                        <div className="mt-1 flex min-w-0 flex-col gap-1.5 pl-[21px]">
                            <IOBlock label="tool" value={display.raw} />
                            {hasInput ? (
                                <IOBlock label="input" value={formatToolValue(input)} />
                            ) : null}
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
    },
)
ToolRowView.displayName = "ToolRowView"

/**
 * A tool row, resolved purely unless the tool has a catalog app.
 *
 * The split is the point: only the catalog branch mounts the query, so a transcript of shell, file
 * and platform calls subscribes to nothing.
 */
const ToolRow = (props: ToolRowProps) => {
    const base = resolveToolDisplay(
        partToolName(props.part),
        (props.part as {input?: unknown}).input,
        undefined,
        (props.part as {output?: unknown}).output,
    )
    if (base.sourceKey) return <CatalogToolRow {...props} base={base} />
    return <ToolRowView {...props} display={base} />
}

/** The collapsed line: one tool speaks for itself, a run of them only gets a count. */
const GroupLabel = ({parts}: {parts: ToolUIPart[]}) => {
    if (parts.length !== 1) return <>{`Used ${parts.length} tools`}</>
    return <SingleGroupLabel part={parts[0]} />
}

const SingleGroupLabel = ({part}: {part: ToolUIPart}) => {
    const base = resolveToolDisplay(
        partToolName(part),
        (part as {input?: unknown}).input,
        undefined,
        (part as {output?: unknown}).output,
    )
    if (base.sourceKey) return <CatalogGroupLabel part={part} base={base} />
    return <>{groupLabelText(part, base)}</>
}

const CatalogGroupLabel = ({part, base}: {part: ToolUIPart; base: ToolDisplay}) => {
    const {integration} = useToolIntegrationDetail(base.sourceKey ?? "")
    const display = integration?.name
        ? resolveToolDisplay(
              base.raw,
              (part as {input?: unknown}).input,
              integration.name,
              (part as {output?: unknown}).output,
          )
        : base
    return <>{groupLabelText(part, display)}</>
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
    const failed = parts.filter(hasFailed).length
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
                <Text type="secondary" className="!text-xs">
                    <GroupLabel parts={parts} />
                    {failed > 0 && parts.length > 1 ? ` · ${failed} failed` : ""}
                </Text>
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
