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
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Segmented,
    SkeletonBlock,
    cn,
} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretDown, CaretRight, Check} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {analyticsColor} from "../colors"
import {clock, monthDay} from "../labels"
import {FAILURE_SAMPLE} from "../useAnalyticsData"

const SHOWN = 20
// Root spans carry their inputs and outputs (~70 KB each), so samples stay small.
const COST_SAMPLE = 40

// The spans endpoint orders by time only, so costly runs come from a cost floor, ranked here.
const byCost = (a: AnalyticsRun, b: AnalyticsRun) => (b.cost ?? -1) - (a.cost ?? -1)

const FAILED_GRID =
    "grid grid-cols-[12px_minmax(0,1fr)_minmax(0,1.4fr)_92px_14px] items-center gap-2.5 px-1"

const ROW_GRID =
    "grid grid-cols-[12px_minmax(0,1.2fr)_minmax(0,1.1fr)_92px_56px_70px_14px] items-center gap-2.5 px-1"

export interface DrawerRunsProps {
    window: AnalyticsWindow
    filters: AnalyticsFilters
    focus: AnalyticsFocus | null
    total: number
    failed: number
    /** The window's cost per run, null while it loads. */
    averageCost: number | null
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
    averageCost,
    failedOnly,
    onFailedOnly,
    agentName,
    showDate,
    onOpenTrace,
}: DrawerRunsProps) => {
    const [reason, setReason] = useState<string | null>(null)
    const [open, setOpen] = useState<string | null>(null)
    const base = {window, filters, focus}
    const ready = averageCost !== null
    const average = averageCost ?? 0
    const hasCost = average > 0
    const failedQuery = useAtomValue(
        analyticsRunsAtomFamily({
            ...base,
            failedOnly: true,
            limit: FAILURE_SAMPLE,
            enabled: failedOnly,
        }),
    )
    const highQuery = useAtomValue(
        analyticsRunsAtomFamily({
            ...base,
            failedOnly: false,
            minCost: hasCost ? average * 2 : null,
            limit: hasCost ? COST_SAMPLE : SHOWN,
            enabled: !failedOnly && ready,
        }),
    )
    // Too few runs at twice the average: lower the floor to the average.
    const lowerFloor = hasCost && !failedOnly && (highQuery.data?.length ?? SHOWN) < 5
    const lowQuery = useAtomValue(
        analyticsRunsAtomFamily({
            ...base,
            failedOnly: false,
            minCost: average,
            limit: COST_SAMPLE,
            enabled: lowerFloor,
        }),
    )
    const query = failedOnly ? failedQuery : lowerFloor ? lowQuery : highQuery
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
            (failedOnly
                ? reason
                    ? runs.filter((run) => categorizeFailure(run.reason).label === reason)
                    : runs
                : [...runs].sort(byCost)
            ).slice(0, SHOWN),
        [runs, reason, failedOnly],
    )
    const traceIds = useMemo(() => listed.map((run) => run.traceId), [listed])
    const toolsQuery = useAtomValue(analyticsRunToolsAtomFamily({traceIds, window}))
    const tools = toolsQuery.data
    const matching = reason
        ? (reasons.find((r) => r.label === reason)?.count ?? 0)
        : failedOnly
          ? failed
          : total
    // Segmented re-measures on every new options array, so it must stay stable.
    const runFilterOptions = useMemo(
        () => [
            {value: "cost", label: "Most expensive"},
            {value: "failed", label: `Failed ${formatCount(failed)}`},
        ],
        [total, failed],
    )

    return (
        <section className="rounded-xl bg-muted px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Runs</span>
                <div className="flex items-center gap-2">
                    {failedOnly && reasons.length ? (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="max-w-[220px]">
                                    <span className="truncate">{reason ?? "All reasons"}</span>
                                    <CaretDown data-icon="inline-end" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-[260px]">
                                {[{label: null, count: runs.length, raw: ""}, ...reasons].map(
                                    (r) => (
                                        <DropdownMenuItem
                                            key={r.label ?? "all"}
                                            title={r.raw || undefined}
                                            onSelect={() => setReason(r.label)}
                                            className="justify-between gap-3"
                                        >
                                            <span className="truncate">
                                                {r.label ?? "All reasons"}
                                            </span>
                                            <span className="flex items-center gap-2 text-muted-foreground tabular-nums">
                                                {formatCount(r.count)}
                                                {reason === r.label ? (
                                                    <Check className="text-foreground" />
                                                ) : null}
                                            </span>
                                        </DropdownMenuItem>
                                    ),
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    ) : null}
                    <Segmented
                        size="sm"
                        options={runFilterOptions}
                        value={failedOnly ? "failed" : "cost"}
                        onChange={(value) => {
                            setReason(null)
                            onFailedOnly(value === "failed")
                        }}
                    />
                </div>
            </div>

            {listed.length && !query.isPending && !query.error ? (
                failedOnly ? (
                    <div className={cn(FAILED_GRID, "h-7 text-[11px] text-muted-foreground")}>
                        <span />
                        <span>Agent</span>
                        <span>Reason</span>
                        <span className="text-right">Started</span>
                        <span />
                    </div>
                ) : (
                    <div
                        className={cn(
                            ROW_GRID,
                            "h-7 text-[11px] text-muted-foreground [&>span:nth-child(n+4)]:text-right",
                        )}
                    >
                        <span />
                        <span>Agent</span>
                        <span>Model</span>
                        <span>Started</span>
                        <span>Tokens</span>
                        <span>Cost ↓</span>
                        <span />
                    </div>
                )
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
                        failedView={failedOnly}
                        open={open === run.traceId}
                        onToggle={() => setOpen(open === run.traceId ? null : run.traceId)}
                        onOpenTrace={onOpenTrace}
                    />
                ))
            ) : (
                <div className="py-4 text-sm text-muted-foreground">No runs match</div>
            )}
            {listed.length ? (
                <div className="pt-2 text-[11px] text-muted-foreground">
                    {failedOnly
                        ? [
                              matching > listed.length
                                  ? `Showing ${listed.length} of ${formatCount(matching)}`
                                  : null,
                              failed > runs.length
                                  ? `reasons from the newest ${formatCount(runs.length)} of ${formatCount(failed)} failed runs`
                                  : null,
                          ]
                              .filter(Boolean)
                              .join(" · ")
                        : hasCost
                          ? `Runs costing at least ${formatMoney(
                                lowerFloor ? average : average * 2,
                            )} (${lowerFloor ? "the" : "twice the"} average per run), most expensive first${
                                runs.length >= COST_SAMPLE ? `, from the newest ${COST_SAMPLE}` : ""
                            }`
                          : `Newest ${listed.length} of ${formatCount(total)} runs: none recorded a cost`}
                    {listed.some((run) => run.subscription && run.cost !== null) ? (
                        <span className="block">
                            ≈ Estimated from tokens: the run used a subscription.
                        </span>
                    ) : null}
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
    failedView,
    open,
    onToggle,
    onOpenTrace,
}: {
    run: AnalyticsRun
    tools?: {calls: number; failed: string[]}
    agentName: (id: string) => string
    showDate: boolean
    /** The Failed view: the reason gets its own column and cost columns drop. */
    failedView: boolean
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
                    failedView ? FAILED_GRID : ROW_GRID,
                    "min-h-11 w-full cursor-pointer border-0 py-1.5 text-left text-sm",
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
                    {subline && !failedView ? (
                        <span
                            className="truncate text-[11px] text-muted-foreground"
                            style={subColor ? {color: analyticsColor(subColor)} : undefined}
                        >
                            {subline}
                        </span>
                    ) : null}
                </span>
                {failedView ? (
                    <span className="truncate text-muted-foreground">{category?.label ?? "—"}</span>
                ) : (
                    <span className="truncate text-xs text-muted-foreground">
                        {run.model ?? "—"}
                    </span>
                )}
                <span className="text-right text-xs text-muted-foreground tabular-nums">
                    {showDate ? `${monthDay(run.startedAt)}, ` : ""}
                    {clock(run.startedAt)}
                </span>
                {failedView ? null : (
                    <>
                        <span className="text-right text-xs text-muted-foreground tabular-nums">
                            {formatCompact(run.tokens)}
                        </span>
                        <span className="text-right tabular-nums">
                            {run.subscription && run.cost !== null ? "≈ " : ""}
                            {formatMoney(run.cost)}
                        </span>
                    </>
                )}
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
