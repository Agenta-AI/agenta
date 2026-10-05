import {useMemo, useState} from "react"

import {
    categorizeFailure,
    formatCompact,
    formatCount,
    formatMoney,
    analyticsRunToolsAtomFamily,
    analyticsRunsAtomFamily,
    type AnalyticsFilters,
    type AnalyticsFocus,
    type AnalyticsRun,
    type AnalyticsWindow,
} from "@agenta/observability/analytics"
import {Button, Segmented, SkeletonBlock, cn} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretRight} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {analyticsColor} from "../colors"
import {clock, monthDay} from "../labels"

const SHOWN = 15
/** Failed runs fetched to count reasons; a window with more counts the newest. */
const REASON_SAMPLE = 500

export interface DrawerRunsProps {
    window: AnalyticsWindow
    filters: AnalyticsFilters
    focus: AnalyticsFocus | null
    total: number
    failed: number
    failedOnly: boolean
    onFailedOnly: (failedOnly: boolean) => void
    agentName: (id: string) => string
    showDate: boolean
    onOpenTrace?: (traceId: string) => void
}

export const DrawerRuns = ({
    window,
    filters,
    focus,
    total,
    failed,
    failedOnly,
    onFailedOnly,
    agentName,
    showDate,
    onOpenTrace,
}: DrawerRunsProps) => {
    const [reason, setReason] = useState<string | null>(null)
    const [open, setOpen] = useState<string | null>(null)
    const query = useAtomValue(
        analyticsRunsAtomFamily({
            window,
            filters,
            focus,
            failedOnly,
            limit: failedOnly ? REASON_SAMPLE : SHOWN,
        }),
    )
    const runs = useMemo(() => query.data ?? [], [query.data])

    const reasons = useMemo(() => {
        if (!failedOnly) return []
        const counts: Record<string, {count: number; raw: Set<string>}> = {}
        for (const run of runs) {
            const label = categorizeFailure(run.reason).label
            const entry = (counts[label] ??= {count: 0, raw: new Set()})
            entry.count += 1
            if (run.reason) entry.raw.add(run.reason)
        }
        return Object.entries(counts)
            .map(([label, entry]) => ({label, count: entry.count, raw: [...entry.raw].join("\n")}))
            .sort((a, b) => b.count - a.count)
    }, [failedOnly, runs])

    const listed = useMemo(
        () =>
            (reason
                ? runs.filter((run) => categorizeFailure(run.reason).label === reason)
                : runs
            ).slice(0, SHOWN),
        [runs, reason],
    )
    const traceIds = useMemo(() => listed.map((run) => run.traceId), [listed])
    const toolsQuery = useAtomValue(analyticsRunToolsAtomFamily(traceIds))
    const tools = toolsQuery.data
    const matching = reason
        ? (reasons.find((r) => r.label === reason)?.count ?? 0)
        : failedOnly
          ? failed
          : total
    const maxReason = reasons[0]?.count ?? 1
    // Segmented re-measures on every new options array, so it must stay stable.
    const runFilterOptions = useMemo(
        () => [
            {value: "all", label: `All ${formatCount(total)}`},
            {value: "failed", label: `Failed ${formatCount(failed)}`},
        ],
        [total, failed],
    )

    return (
        <section className="rounded-xl bg-muted px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Runs</span>
                <Segmented
                    size="sm"
                    options={runFilterOptions}
                    value={failedOnly ? "failed" : "all"}
                    onChange={(value) => {
                        setReason(null)
                        onFailedOnly(value === "failed")
                    }}
                />
            </div>

            {failedOnly && reasons.length ? (
                <div className="flex flex-col gap-0.5 pb-3">
                    <div className="flex items-center justify-between pb-1 text-xs text-muted-foreground">
                        <span>
                            Why runs failed · {formatCount(runs.length)} failed runs
                            {failed > runs.length ? ` (newest ${formatCount(runs.length)})` : ""}
                        </span>
                        {reason ? (
                            <button
                                type="button"
                                onClick={() => setReason(null)}
                                className="cursor-pointer border-0 bg-transparent p-0 text-xs text-foreground underline underline-offset-2"
                            >
                                Show all
                            </button>
                        ) : null}
                    </div>
                    {reasons.map((r) => (
                        <button
                            key={r.label}
                            type="button"
                            title={r.raw}
                            onClick={() => setReason(reason === r.label ? null : r.label)}
                            className={cn(
                                "grid h-8 cursor-pointer grid-cols-[minmax(0,190px)_minmax(0,1fr)_36px_36px] items-center gap-2.5 rounded-md border-0 px-2 text-left text-sm",
                                reason === r.label ? "bg-accent" : "bg-transparent hover:bg-accent",
                                reason && reason !== r.label && "opacity-45",
                            )}
                        >
                            <span className="truncate">{r.label}</span>
                            <span className="h-1.5 rounded-full bg-background">
                                <span
                                    className="block h-full rounded-full"
                                    style={{
                                        width: `${(r.count / maxReason) * 100}%`,
                                        background: analyticsColor("failed"),
                                    }}
                                />
                            </span>
                            <span className="text-right tabular-nums">{formatCount(r.count)}</span>
                            <span className="text-right text-xs text-muted-foreground tabular-nums">
                                {Math.round((r.count / runs.length) * 100)}%
                            </span>
                        </button>
                    ))}
                </div>
            ) : null}

            {query.isPending ? (
                <div className="flex flex-col gap-2 py-2">
                    {Array.from({length: 4}, (_, i) => (
                        <SkeletonBlock key={i} className="h-9 w-full" />
                    ))}
                </div>
            ) : query.error ? (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    Couldn’t load the runs.
                    <Button variant="outline" size="xs" onClick={() => void query.refetch()}>
                        Retry
                    </Button>
                </div>
            ) : listed.length ? (
                listed.map((run) => (
                    <RunRow
                        key={run.traceId}
                        run={run}
                        tools={tools ? (tools[run.traceId] ?? {calls: 0, failed: []}) : undefined}
                        agentName={agentName}
                        showDate={showDate}
                        open={open === run.traceId}
                        onToggle={() => setOpen(open === run.traceId ? null : run.traceId)}
                        onOpenTrace={onOpenTrace}
                    />
                ))
            ) : (
                <div className="py-4 text-sm text-muted-foreground">No runs match</div>
            )}
            {matching > listed.length && listed.length ? (
                <div className="pt-2 text-[11px] text-muted-foreground">
                    Showing {listed.length} of {formatCount(matching)}
                </div>
            ) : null}
        </section>
    )
}

const RunRow = ({
    run,
    tools,
    agentName,
    showDate,
    open,
    onToggle,
    onOpenTrace,
}: {
    run: AnalyticsRun
    tools?: {calls: number; failed: string[]}
    agentName: (id: string) => string
    showDate: boolean
    open: boolean
    onToggle: () => void
    onOpenTrace?: (traceId: string) => void
}) => {
    const failedTools = tools?.failed ?? []
    const category = run.failed ? categorizeFailure(run.reason) : null
    const subline = category
        ? category.label
        : failedTools.length
          ? `${failedTools.length} tool call${failedTools.length > 1 ? "s" : ""} failed, run recovered`
          : tools
            ? `${tools.calls} tool call${tools.calls === 1 ? "" : "s"}`
            : ""
    const subColor = category ? "textBad" : failedTools.length ? "textWarn" : null
    return (
        <div className="border-0 border-t border-solid border-border">
            <button
                type="button"
                onClick={onToggle}
                className={cn(
                    "grid min-h-11 w-full cursor-pointer grid-cols-[12px_minmax(0,1.2fr)_minmax(0,1.1fr)_auto_56px_70px_14px] items-center gap-2.5 border-0 px-1 py-1.5 text-left text-sm",
                    open ? "bg-accent" : "bg-transparent hover:bg-accent",
                )}
            >
                <span
                    className="size-2 rounded-full"
                    style={{background: analyticsColor(run.failed ? "dotFailed" : "dotOk")}}
                />
                <span className="flex min-w-0 flex-col">
                    <span className="truncate">
                        {run.agentId ? agentName(run.agentId) : "Unknown agent"}
                    </span>
                    {subline ? (
                        <span
                            className="truncate text-[11px] text-muted-foreground"
                            style={subColor ? {color: analyticsColor(subColor)} : undefined}
                        >
                            {subline}
                        </span>
                    ) : null}
                </span>
                <span className="truncate text-xs text-muted-foreground">{run.model ?? "—"}</span>
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {showDate ? `${monthDay(run.startedAt)}, ` : ""}
                    {clock(run.startedAt)}
                </span>
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {formatCompact(run.tokens)}
                </span>
                <span className="text-right tabular-nums">
                    {run.subscription && run.cost !== null ? "≈ " : ""}
                    {formatMoney(run.cost)}
                </span>
                <CaretRight
                    size={12}
                    className={cn(
                        "text-muted-foreground transition-transform",
                        open && "rotate-90",
                    )}
                />
            </button>
            {open ? (
                <div className="mb-2 ml-6 mr-1 flex flex-col gap-2 rounded-lg bg-background px-3 py-2.5 text-sm">
                    <span className="font-medium">
                        {category
                            ? category.label
                            : failedTools.length
                              ? "Run succeeded after retrying"
                              : "Run succeeded"}
                    </span>
                    {category ? (
                        <span className="text-muted-foreground">{category.fix}</span>
                    ) : null}
                    {run.reason ? (
                        <code className="whitespace-pre-wrap break-all text-[11px] text-muted-foreground">
                            {run.reason}
                        </code>
                    ) : null}
                    <div className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">Failed tool calls</span>
                        <span className="text-xs">
                            {failedTools.length
                                ? failedTools.join(", ")
                                : run.failed
                                  ? "None. The run itself failed."
                                  : "None"}
                        </span>
                    </div>
                    {run.subscription ? (
                        <span className="text-[11px] text-muted-foreground">
                            ≈ This run used a subscription; the cost is estimated at API rates.
                        </span>
                    ) : null}
                    {onOpenTrace ? (
                        <Button
                            variant="outline"
                            size="xs"
                            className="self-start"
                            onClick={() => onOpenTrace(run.traceId)}
                        >
                            <ArrowSquareOut data-icon="inline-start" />
                            Open trace
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
