import {useMemo, useState} from "react"

import {
    USAGE_RANGE,
    bucketStarts,
    bucketWindow,
    formatCount,
    formatMetric,
    formatMoney,
    successRate,
    sum,
    usageDrawerAtom,
    usageFiltersAtom,
    usageRangeAtom,
    usageWindowAtom,
    type UsageMetric,
    type UsagePoint,
} from "@agenta/observability/usage"
import {Button, Sheet, SheetContent, SheetDescription, SheetTitle, cn} from "@agenta/ui/ui"
import {CaretLeft, CaretRight, DownloadSimple, X} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {ChartTooltipPanel} from "../charts/ChartTooltipPanel"
import {TimeChart} from "../charts/TimeChart"
import {usageColor} from "../colors"
import {bucketUnit, fullLabel, shortLabel} from "../labels"
import {useUsageWindowData} from "../useUsageData"

import {downloadCsv} from "./csv"
import {DrawerBreakdown, type BreakdownTable} from "./DrawerBreakdown"
import {DrawerRuns} from "./DrawerRuns"

const METRIC_LABEL: Record<UsageMetric, string> = {
    cost: "Cost",
    runs: "Runs",
    success: "Success rate",
    tokens: "Tokens",
    tools: "Tool calls",
    avgcost: "Avg cost per run",
}

const TILES: UsageMetric[] = ["cost", "runs", "success", "tokens", "avgcost", "tools"]

const additive = (metric: UsageMetric) => metric !== "success" && metric !== "avgcost"

const pointValue = (metric: UsageMetric, p: UsagePoint, tools: number): number | null => {
    switch (metric) {
        case "cost":
            return p.cost
        case "runs":
            return p.runs
        case "success":
            return successRate(p.runs, p.failed)
        case "tokens":
            return p.tokens
        case "avgcost":
            return p.runs ? p.cost / p.runs : null
        case "tools":
            return tools
    }
}

export interface UsageDrawerProps {
    agentName: (id: string) => string
    onOpenTrace?: (traceId: string) => void
}

export const UsageDrawer = ({agentName, onOpenTrace}: UsageDrawerProps) => {
    const [state, setState] = useAtom(usageDrawerAtom)
    return (
        <Sheet open={state !== null} onOpenChange={(open) => !open && setState(null)}>
            <SheetContent
                side="responsive"
                className="flex flex-col gap-0 p-0 [--ag-sheet-responsive-width:640px]"
                aria-describedby={undefined}
            >
                {state ? <DrawerBody agentName={agentName} onOpenTrace={onOpenTrace} /> : null}
            </SheetContent>
        </Sheet>
    )
}

const DrawerBody = ({agentName, onOpenTrace}: UsageDrawerProps) => {
    const [state, setState] = useAtom(usageDrawerAtom)
    const pageWindow = useAtomValue(usageWindowAtom)
    const range = useAtomValue(usageRangeAtom)
    const [filters, setFilters] = useAtom(usageFiltersAtom)
    const [hovered, setHovered] = useState<number | null>(null)
    const [table, setTable] = useState<BreakdownTable | null>(null)

    const pageStarts = useMemo(() => bucketStarts(pageWindow), [pageWindow])
    const bucket = state?.bucket ?? null
    const window = bucket === null ? pageWindow : bucketWindow(pageWindow, bucket)
    const focus = state?.focus ?? null
    const data = useUsageWindowData(window, filters, focus)
    const toolsPerBucket = useToolsPerBucket(data)
    if (!state) return null
    const metric = state.metric

    const values = data.overview.points.map((p, i) => pointValue(metric, p, toolsPerBucket[i]))
    const totals = data.overview.totals
    const totalTools = sum(toolsPerBucket)
    const tileValue = (m: UsageMetric) => pointValue(m, {start: 0, ...totals}, totalTools)
    const labels = data.starts.map((s) => shortLabel(window, s))
    const fullLabels = data.starts.map((s) =>
        bucket === null ? fullLabel(window, s) : shortLabel(window, s),
    )
    const unit = bucketUnit(window)
    const present = values.filter((v): v is number => v !== null)
    const average = additive(metric)
        ? present.length
            ? sum(present) / values.length
            : 0
        : (tileValue(metric) ?? 0)
    const peakIndex = values.reduce<number>(
        (best, v, i) => (v !== null && (best < 0 || v > (values[best] ?? -Infinity)) ? i : best),
        -1,
    )

    const title =
        bucket !== null ? fullLabel(pageWindow, pageStarts[bucket]) : USAGE_RANGE[range].label
    const sub = `${bucket === null ? "Day by day" : unit === "hour" ? "Hour by hour" : "5-minute view"} · ${formatCount(totals.runs)} runs`
    const focusLabel = focus
        ? `${focus.dim === "agent" ? "Agent" : "Model"}: ${focus.dim === "agent" ? agentName(focus.key) : focus.key}`
        : null
    const pageChips = [
        filters.agent.length ? `Agent: ${filters.agent.map(agentName).join(", ")}` : null,
        filters.model.length ? `Model: ${filters.model.join(", ")}` : null,
    ].filter((c): c is string => Boolean(c))

    const go = (next: number) => setState({...state, bucket: next})

    return (
        <>
            <div className="flex items-start gap-3 border-0 border-b border-solid border-border px-5 py-4">
                {bucket !== null ? (
                    <div className="flex gap-0.5 pt-0.5">
                        <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Previous"
                            disabled={bucket <= 0}
                            onClick={() => go(bucket - 1)}
                        >
                            <CaretLeft />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon-sm"
                            aria-label="Next"
                            disabled={bucket >= pageStarts.length - 1}
                            onClick={() => go(bucket + 1)}
                        >
                            <CaretRight />
                        </Button>
                    </div>
                ) : null}
                <div className="flex min-w-0 flex-1 flex-col">
                    <SheetTitle className="truncate text-lg font-semibold">
                        {focus && bucket === null ? (focusLabel?.split(": ")[1] ?? title) : title}
                    </SheetTitle>
                    <SheetDescription className="text-xs text-muted-foreground">
                        {sub}
                    </SheetDescription>
                </div>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Close"
                    onClick={() => setState(null)}
                >
                    <X />
                </Button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
                {pageChips.length || focusLabel ? (
                    <div className="flex flex-wrap gap-1.5">
                        {pageChips.map((chip) => (
                            <span
                                key={chip}
                                className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs"
                            >
                                {chip}
                            </span>
                        ))}
                        {focusLabel ? (
                            <span className="inline-flex h-6 items-center gap-1 rounded-md bg-accent pl-2 pr-1 text-xs">
                                {focusLabel}
                                <button
                                    type="button"
                                    aria-label="Remove"
                                    onClick={() =>
                                        setState({
                                            ...state,
                                            focus: null,
                                            dim: focus?.dim === "model" ? "model" : "agent",
                                        })
                                    }
                                    className="grid size-4 cursor-pointer place-items-center rounded border-0 bg-transparent text-muted-foreground hover:text-foreground"
                                >
                                    <X size={10} />
                                </button>
                            </span>
                        ) : null}
                    </div>
                ) : null}

                <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-6">
                    {TILES.map((m) => (
                        <button
                            key={m}
                            type="button"
                            onClick={() => setState({...state, metric: m})}
                            className={cn(
                                "flex cursor-pointer flex-col gap-0.5 rounded-lg border-0 px-3 py-2 text-left",
                                m === metric ? "bg-background shadow-sm" : "bg-transparent",
                            )}
                        >
                            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span
                                    className="size-1.5 rounded-full"
                                    style={{background: usageColor(m)}}
                                />
                                {METRIC_LABEL[m]}
                            </span>
                            <span className="text-base font-semibold tabular-nums">
                                {m === "tools"
                                    ? formatCount(totalTools)
                                    : formatMetric(m, tileValue(m))}
                            </span>
                        </button>
                    ))}
                </div>

                <section className="rounded-xl bg-muted px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                            {METRIC_LABEL[metric]} by{" "}
                            {unit === "day" ? "day" : unit === "hour" ? "hour" : "5 minutes"}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                            {bucket === null ? "Click a bar to zoom in" : "Hover a bar for details"}
                        </span>
                    </div>
                    <TimeChart
                        kind={additive(metric) ? "bar" : "line"}
                        labels={labels}
                        series={[
                            {
                                key: metric,
                                label: METRIC_LABEL[metric],
                                color: usageColor(metric),
                                values,
                            },
                        ]}
                        formatTick={(v) => formatMetric(metric, v, true)}
                        average={{
                            value: average,
                            label: `avg ${formatMetric(metric, average, true)}${additive(metric) ? ` / ${unit}` : ""}`,
                        }}
                        yMin={
                            metric === "success"
                                ? Math.max(0, Math.floor((Math.min(...present, 100) - 5) / 10) * 10)
                                : undefined
                        }
                        yMax={metric === "success" ? 100 : undefined}
                        height={180}
                        className="mt-2"
                        hovered={hovered}
                        onHover={setHovered}
                        onSelect={
                            bucket === null ? (i) => setState({...state, bucket: i}) : undefined
                        }
                        tooltip={(i) => {
                            const p = data.overview.points[i]
                            const v = values[i]
                            const topModel = data.callModelOrder
                                .map((k) => ({k, n: data.callModels[k][i]}))
                                .sort((a, b) => b.n - a.n)[0]
                            const busiest = data.agentOrder
                                .map((k) => ({k, n: data.agentRuns[k][i]}))
                                .sort((a, b) => b.n - a.n)[0]
                            return (
                                <ChartTooltipPanel
                                    title={fullLabels[i]}
                                    runs={`${formatCount(p.runs)} runs`}
                                    value={`${formatMetric(metric, v)} ${METRIC_LABEL[metric].toLowerCase()}`}
                                    facts={[
                                        {
                                            label: "vs average",
                                            value:
                                                v !== null && average
                                                    ? `${v >= average ? "+" : ""}${Math.round(((v - average) / average) * 100)}%`
                                                    : "—",
                                        },
                                        metric === "cost"
                                            ? {
                                                  label: "Avg cost per run",
                                                  value: formatMoney(
                                                      p.runs ? p.cost / p.runs : null,
                                                  ),
                                              }
                                            : {label: "Cost", value: formatMoney(p.cost)},
                                        {label: "Failed runs", value: formatCount(p.failed)},
                                        {label: "Top model", value: topModel?.n ? topModel.k : "—"},
                                        {
                                            label: "Busiest agent",
                                            value: busiest?.n ? agentName(busiest.k) : "—",
                                        },
                                    ]}
                                />
                            )
                        }}
                    />
                    {peakIndex >= 0 ? (
                        <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
                            <span>
                                Highest: {fullLabels[peakIndex]} ·{" "}
                                {formatMetric(metric, values[peakIndex])}
                            </span>
                        </div>
                    ) : null}
                </section>

                <DrawerBreakdown
                    data={data}
                    window={window}
                    filters={filters}
                    focus={focus}
                    dim={state.dim}
                    metric={metric}
                    agentName={agentName}
                    unit={unit}
                    onDim={(dim) => setState({...state, dim})}
                    onDrill={(next, dim) => setState({...state, focus: next, dim})}
                    onTable={setTable}
                />

                <DrawerRuns
                    window={window}
                    filters={filters}
                    focus={focus}
                    total={totals.runs}
                    failed={totals.failed}
                    failedOnly={state.failedOnly}
                    onFailedOnly={(failedOnly) => setState({...state, failedOnly})}
                    agentName={agentName}
                    showDate={bucket === null && window.interval >= 24 * 60}
                    onOpenTrace={onOpenTrace}
                />
            </div>

            <div className="flex items-center justify-between gap-2 border-0 border-t border-solid border-border px-5 py-3">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={!table}
                    onClick={() =>
                        table && downloadCsv(`agenta-usage-${table.name}.csv`, table.rows)
                    }
                >
                    <DownloadSimple data-icon="inline-start" />
                    Export CSV
                </Button>
                {focus && focus.dim !== "callModel" ? (
                    <Button
                        size="sm"
                        onClick={() => {
                            const key = focus.dim
                            setFilters({...filters, [key]: [focus.key]})
                            setState(null)
                        }}
                    >
                        Apply as filter
                    </Button>
                ) : null}
            </div>
        </>
    )
}

const useToolsPerBucket = (data: ReturnType<typeof useUsageWindowData>) =>
    useMemo(
        () =>
            data.starts.map((_, i) =>
                data.toolOrder.reduce((total, key) => total + (data.toolCalls[key][i] ?? 0), 0),
            ),
        [data.starts, data.toolOrder, data.toolCalls],
    )
