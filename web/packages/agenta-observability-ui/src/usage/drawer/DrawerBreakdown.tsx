import {useEffect, useMemo} from "react"

import {
    formatCompact,
    formatCount,
    formatMetric,
    formatMoney,
    successRate,
    sum,
    type UsageDimension,
    type UsageFilters,
    type UsageFocus,
    type UsageMetric,
    type UsageWindow,
} from "@agenta/observability/usage"
import {Segmented, cn} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"

import {SERIES_COLORS, usageColor} from "../colors"
import {useUsageSplit, type UsageWindowData} from "../useUsageData"

/** Rows the CSV export writes: a header row, then one row per key. */
export interface BreakdownTable {
    name: string
    rows: string[][]
}

const LIMIT = 8
const OTHER = "__other"

interface RunRow {
    key: string
    label: string
    runs: number
    failed: number
    cost: number
    tokens: number
}

const RUN_COLUMNS: {key: UsageMetric; label: string}[] = [
    {key: "runs", label: "Runs"},
    {key: "success", label: "Success"},
    {key: "tokens", label: "Tokens"},
    {key: "cost", label: "Cost"},
    {key: "avgcost", label: "Avg / run"},
]

const rowValue = (row: RunRow, metric: UsageMetric): number | null => {
    switch (metric) {
        case "runs":
            return row.runs
        case "success":
            return successRate(row.runs, row.failed)
        case "tokens":
            return row.tokens
        case "cost":
            return row.cost
        case "avgcost":
            return row.runs ? row.cost / row.runs : null
        default:
            return row.cost
    }
}

const DIM_OPTIONS = [
    {value: "agent", label: "Agent"},
    {value: "model", label: "Model"},
    {value: "tool", label: "Tool"},
]

export interface DrawerBreakdownProps {
    data: UsageWindowData
    window: UsageWindow
    filters: UsageFilters
    focus: UsageFocus | null
    dim: UsageDimension
    metric: UsageMetric
    agentName: (id: string) => string
    unit: string
    onDim: (dim: UsageDimension) => void
    onDrill: (focus: UsageFocus, dim: UsageDimension) => void
    onTable: (table: BreakdownTable | null) => void
}

export const DrawerBreakdown = (props: DrawerBreakdownProps) => (
    <section className="rounded-xl bg-muted px-4 py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Breakdown</span>
                <Segmented
                    size="sm"
                    options={DIM_OPTIONS}
                    value={props.dim}
                    onChange={(value) => props.onDim(value as UsageDimension)}
                />
            </div>
            {props.dim !== "tool" ? (
                <span className="text-[11px] text-muted-foreground">Click a row to drill in</span>
            ) : null}
        </div>
        {props.dim === "tool" ? <ToolTable {...props} /> : <RunTable {...props} dim={props.dim} />}
    </section>
)

const RunTable = ({
    data,
    window,
    filters,
    focus,
    dim,
    metric,
    agentName,
    onDrill,
    onTable,
}: DrawerBreakdownProps & {dim: "agent" | "model"}) => {
    const runs = dim === "agent" ? data.agentRuns : data.modelRuns
    const failed = dim === "agent" ? data.agentFailed : data.modelFailed
    const order = dim === "agent" ? data.agentOrder : data.modelOrder
    const top = useMemo(() => order.slice(0, LIMIT), [order])
    const split = useUsageSplit(dim, top, window, filters, true, focus)
    const totals = data.overview.totals

    const rows = useMemo<RunRow[]>(() => {
        const out: RunRow[] = top.map((key) => ({
            key,
            label: dim === "agent" ? agentName(key) : key,
            runs: sum(runs[key] ?? []),
            failed: sum(failed[key] ?? []),
            cost: sum(split.cost[key] ?? []),
            tokens: sum(split.tokens[key] ?? []),
        }))
        const rest = {
            key: OTHER,
            label: order.length > LIMIT ? `Other (${order.length - LIMIT})` : "Unattributed",
            runs: totals.runs - sum(out.map((r) => r.runs)),
            failed: totals.failed - sum(out.map((r) => r.failed)),
            cost: Math.max(0, totals.cost - sum(out.map((r) => r.cost))),
            tokens: Math.max(0, totals.tokens - sum(out.map((r) => r.tokens))),
        }
        if (rest.runs > 0) out.push(rest)
        return out
    }, [top, order.length, runs, failed, split.cost, split.tokens, totals, dim, agentName])

    const sortKey = RUN_COLUMNS.some((c) => c.key === metric) ? metric : "cost"
    const shareKey: UsageMetric = metric === "runs" || metric === "tokens" ? metric : "cost"
    const sorted = useMemo(
        () =>
            [...rows].sort(
                (a, b) =>
                    Number(a.key === OTHER) - Number(b.key === OTHER) ||
                    (rowValue(b, sortKey) ?? -1) - (rowValue(a, sortKey) ?? -1),
            ),
        [rows, sortKey],
    )
    const shareTotal = sum(rows.map((r) => rowValue(r, shareKey) ?? 0))
    const pending = data.status.overview.pending || split.status.pending

    useEffect(() => {
        onTable({
            name: `by-${dim}`,
            rows: [
                [
                    dim === "agent" ? "Agent" : "Configured model",
                    "Runs",
                    "Failed",
                    "Tokens",
                    "Cost",
                ],
                ...sorted.map((r) => [
                    r.label,
                    String(r.runs),
                    String(r.failed),
                    String(r.tokens),
                    r.cost.toFixed(6),
                ]),
            ],
        })
    }, [sorted, dim, onTable])

    if (!rows.length) {
        return (
            <div className="py-6 text-center text-sm text-muted-foreground">
                {pending ? "Loading…" : "No runs in this window"}
            </div>
        )
    }

    const grid = "grid grid-cols-[minmax(96px,1fr)_40px_54px_48px_60px_56px_72px_12px] gap-2"
    return (
        <div className="-mx-1 overflow-x-auto">
            <div className="min-w-[480px] px-1">
                <div className={cn(grid, "h-7 items-center text-[11px] text-muted-foreground")}>
                    <span>{dim === "agent" ? "Agent" : "Configured model"}</span>
                    {RUN_COLUMNS.map((c) => (
                        <span
                            key={c.key}
                            className={cn("text-right", c.key === sortKey && "text-foreground")}
                        >
                            {c.label}
                            {c.key === sortKey ? " ↓" : ""}
                        </span>
                    ))}
                    <span className="text-right">Share</span>
                    <span />
                </div>
                {sorted.map((row, i) => {
                    const drillable =
                        row.key !== OTHER && !(focus?.dim === dim && focus.key === row.key)
                    const share = shareTotal ? (rowValue(row, shareKey) ?? 0) / shareTotal : 0
                    const rate = successRate(row.runs, row.failed)
                    return (
                        <button
                            key={row.key}
                            type="button"
                            disabled={!drillable}
                            onClick={() =>
                                onDrill({dim, key: row.key}, dim === "agent" ? "model" : "agent")
                            }
                            className={cn(
                                grid,
                                "h-10 w-full items-center border-0 border-t border-solid border-border bg-transparent px-0 text-left text-sm",
                                drillable && "cursor-pointer hover:bg-accent",
                            )}
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span
                                    className="size-2 shrink-0 rounded-full"
                                    style={{
                                        background: usageColor(
                                            row.key === OTHER
                                                ? "other"
                                                : SERIES_COLORS[i % SERIES_COLORS.length],
                                        ),
                                    }}
                                />
                                <span className="truncate">{row.label}</span>
                            </span>
                            <span className="text-right tabular-nums">{formatCount(row.runs)}</span>
                            <span
                                className="text-right tabular-nums"
                                style={
                                    rate !== null && rate < 90
                                        ? {color: usageColor("textBad")}
                                        : undefined
                                }
                            >
                                {formatMetric("success", rate)}
                            </span>
                            <span className="text-right tabular-nums">
                                {formatCompact(row.tokens)}
                            </span>
                            <span className="text-right tabular-nums">{formatMoney(row.cost)}</span>
                            <span className="text-right tabular-nums">
                                {formatMoney(row.runs ? row.cost / row.runs : null)}
                            </span>
                            <span className="flex items-center justify-end gap-2">
                                <span className="h-1.5 w-8 rounded-full bg-background">
                                    <span
                                        className="block h-full rounded-full"
                                        style={{
                                            width: `${share * 100}%`,
                                            background: usageColor(
                                                shareKey === "cost" ? "cost" : shareKey,
                                            ),
                                        }}
                                    />
                                </span>
                                <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">
                                    {Math.round(share * 100)}%
                                </span>
                            </span>
                            <span className="text-muted-foreground">
                                {drillable ? <CaretRight size={12} /> : null}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

const ToolTable = ({data, focus, filters, unit, onTable}: DrawerBreakdownProps) => {
    const rows = useMemo(
        () => data.toolOrder.map((key) => ({key, calls: sum(data.toolCalls[key])})),
        [data.toolOrder, data.toolCalls],
    )
    const total = sum(rows.map((r) => r.calls))
    const buckets = data.starts.length || 1
    const narrowed = Boolean(focus) || filters.agent.length > 0 || filters.model.length > 0

    useEffect(() => {
        onTable({
            name: "by-tool",
            rows: [["Tool", "Calls"], ...rows.map((r) => [r.key, String(r.calls)])],
        })
    }, [rows, onTable])

    if (!rows.length) {
        return (
            <div className="py-6 text-center text-sm text-muted-foreground">
                {data.status.tools.pending ? "Loading…" : "No tool calls in this window"}
            </div>
        )
    }
    const grid = "grid grid-cols-[minmax(0,1fr)_90px_90px_110px] gap-2.5"
    return (
        <div className="flex flex-col">
            {narrowed ? (
                <span className="mb-1 text-[11px] text-muted-foreground">
                    Tool calls are not narrowed by agent or model yet.
                </span>
            ) : null}
            <div className={cn(grid, "h-7 items-center text-[11px] text-muted-foreground")}>
                <span>Tool</span>
                <span className="text-right text-foreground">Calls ↓</span>
                <span className="text-right">
                    Per {unit === "day" ? "day" : unit === "hour" ? "hour" : "slot"}
                </span>
                <span className="text-right">Share</span>
            </div>
            {rows.map((row, i) => (
                <div
                    key={row.key}
                    className={cn(
                        grid,
                        "h-10 items-center border-0 border-t border-solid border-border text-sm",
                    )}
                >
                    <span className="flex min-w-0 items-center gap-2">
                        <span
                            className="size-2 shrink-0 rounded-full"
                            style={{
                                background: usageColor(SERIES_COLORS[i % SERIES_COLORS.length]),
                            }}
                        />
                        <span className="truncate">{row.key}</span>
                    </span>
                    <span className="text-right tabular-nums">{formatCount(row.calls)}</span>
                    <span className="text-right tabular-nums">
                        {(row.calls / buckets).toFixed(1)}
                    </span>
                    <span className="flex items-center justify-end gap-2">
                        <span className="h-1.5 w-8 rounded-full bg-background">
                            <span
                                className="block h-full rounded-full"
                                style={{
                                    width: `${total ? (row.calls / total) * 100 : 0}%`,
                                    background: usageColor("tools"),
                                }}
                            />
                        </span>
                        <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">
                            {total ? Math.round((row.calls / total) * 100) : 0}%
                        </span>
                    </span>
                </div>
            ))}
        </div>
    )
}
