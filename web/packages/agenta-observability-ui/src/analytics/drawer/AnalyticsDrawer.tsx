import {useMemo, useRef, useState} from "react"

import {
    ANALYTICS_RANGE,
    bucketStarts,
    bucketWindow,
    formatCount,
    formatMetric,
    formatMoney,
    successRate,
    sum,
    analyticsDrawerAtom,
    analyticsFiltersAtom,
    analyticsRangeAtom,
    analyticsWindowAtom,
    type AnalyticsMetric,
    type AnalyticsPoint,
} from "@agenta/observability/analytics"
import {useScrollFadeEdges} from "@agenta/ui/hooks"
import {Button, Sheet, SheetContent, SheetDescription, SheetTitle, cn} from "@agenta/ui/ui"
import {CaretLeft, CaretRight, X} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {ChartTooltipPanel} from "../charts/ChartTooltipPanel"
import {TimeChart} from "../charts/TimeChart"
import {analyticsColor} from "../colors"
import {bucketUnit, fullLabel, shortLabel} from "../labels"
import {useAnalyticsWindowData} from "../useAnalyticsData"

import {DrawerBreakdown} from "./DrawerBreakdown"
import {DrawerRuns} from "./DrawerRuns"

const METRIC_LABEL: Record<AnalyticsMetric, string> = {
    cost: "Cost",
    runs: "Runs",
    success: "Success rate",
    tokens: "Tokens",
    tools: "Tool calls",
    avgcost: "Avg cost per run",
}

const TILES: AnalyticsMetric[] = ["cost", "runs", "success", "tokens", "avgcost", "tools"]

/** Tile labels stay on one line in a sixth of the drawer. */
const TILE_LABEL: Record<AnalyticsMetric, string> = {
    ...METRIC_LABEL,
    success: "Success",
    avgcost: "Avg / run",
}

const additive = (metric: AnalyticsMetric) => metric !== "success" && metric !== "avgcost"

const pointValue = (metric: AnalyticsMetric, p: AnalyticsPoint, tools: number): number | null => {
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

export interface AnalyticsDrawerProps {
    agentName: (id: string) => string
    onOpenTrace?: (traceId: string) => void
}

export const AnalyticsDrawer = ({agentName, onOpenTrace}: AnalyticsDrawerProps) => {
    const [state, setState] = useAtom(analyticsDrawerAtom)
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

const DrawerBody = ({agentName, onOpenTrace}: AnalyticsDrawerProps) => {
    const [state, setState] = useAtom(analyticsDrawerAtom)
    const pageWindow = useAtomValue(analyticsWindowAtom)
    const range = useAtomValue(analyticsRangeAtom)
    const [filters, setFilters] = useAtom(analyticsFiltersAtom)
    const [hovered, setHovered] = useState<number | null>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    useScrollFadeEdges(scrollRef)

    const pageStarts = useMemo(() => bucketStarts(pageWindow), [pageWindow])
    const bucket = state?.bucket ?? null
    // Stable identity: the window keys every query and the breakdown's table effect.
    const window = useMemo(
        () => (bucket === null ? pageWindow : bucketWindow(pageWindow, bucket)),
        [pageWindow, bucket],
    )
    const focus = state?.focus ?? null
    const data = useAnalyticsWindowData(window, filters, focus)
    const toolsPerBucket = useToolsPerBucket(data)
    if (!state) return null
    // Tool spans carry no agent or model, so a narrowed drawer cannot count them.
    const narrowed = Boolean(focus) || filters.agent.length > 0 || filters.model.length > 0
    const metric = narrowed && state.metric === "tools" ? "runs" : state.metric

    const values = data.overview.points.map((p, i) => pointValue(metric, p, toolsPerBucket[i]))
    const totals = data.overview.totals
    const totalTools = sum(toolsPerBucket)
    const tileValue = (m: AnalyticsMetric) => pointValue(m, {start: 0, ...totals}, totalTools)
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

    const title =
        bucket !== null ? fullLabel(pageWindow, pageStarts[bucket]) : ANALYTICS_RANGE[range].label
    const sub = `${unit === "day" ? "Day by day" : unit === "hour" ? "Hour by hour" : "5-minute view"} · ${formatCount(totals.runs)} runs`
    const focusName = focus ? (focus.dim === "agent" ? agentName(focus.key) : focus.key) : null
    const focusLabel = focus ? `${focus.dim === "agent" ? "Agent" : "Model"}: ${focusName}` : null
    const pageChips = [
        filters.agent.length ? `Agent: ${filters.agent.map(agentName).join(", ")}` : null,
        filters.model.length ? `Model: ${filters.model.join(", ")}` : null,
    ].filter((c): c is string => Boolean(c))

    const go = (next: number) => setState({...state, bucket: next})

    return (
        <>
            <div className="flex items-center gap-3 px-5 pb-1 pt-4">
                {bucket !== null ? (
                    <div className="flex gap-0.5">
                        <Button
                            variant="outline"
                            size="icon-xs"
                            aria-label="Previous"
                            disabled={bucket <= 0}
                            onClick={() => go(bucket - 1)}
                        >
                            <CaretLeft />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon-xs"
                            aria-label="Next"
                            disabled={bucket >= pageStarts.length - 1}
                            onClick={() => go(bucket + 1)}
                        >
                            <CaretRight />
                        </Button>
                    </div>
                ) : null}
                <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <SheetTitle className="shrink-0 text-lg font-semibold">
                        {focus && bucket === null ? focusName : title}
                    </SheetTitle>
                    <SheetDescription className="truncate text-xs text-muted-foreground">
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

            <div ref={scrollRef} className="ag-scroll-fade min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-4 px-5 py-4">
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

                    <div
                        className={cn(
                            "grid grid-cols-3 gap-1 rounded-xl bg-muted p-1",
                            narrowed ? "sm:grid-cols-5" : "sm:grid-cols-6",
                        )}
                    >
                        {/* Tool spans record no agent or model, so a narrowed drawer drops the tile. */}
                        {TILES.filter((m) => !(m === "tools" && narrowed)).map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => setState({...state, metric: m})}
                                className={cn(
                                    "flex min-w-0 cursor-pointer flex-col gap-1 rounded-lg border-0 px-3 py-2.5 text-left disabled:cursor-default disabled:opacity-50",
                                    m === metric ? "bg-background shadow-sm" : "bg-transparent",
                                )}
                            >
                                <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                                    <span
                                        className="size-1.5 shrink-0 rounded-full"
                                        style={{background: analyticsColor(m)}}
                                    />
                                    <span className="truncate">{TILE_LABEL[m]}</span>
                                </span>
                                <span className="truncate text-base font-semibold tabular-nums">
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
                                {bucket === null
                                    ? "Click a bar to zoom in"
                                    : "Hover a bar for details"}
                            </span>
                        </div>
                        <TimeChart
                            kind={additive(metric) ? "bar" : "line"}
                            labels={labels}
                            series={[
                                {
                                    key: metric,
                                    label: METRIC_LABEL[metric],
                                    color: analyticsColor(metric),
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
                                    ? Math.max(
                                          0,
                                          Math.floor((Math.min(...present, 100) - 5) / 10) * 10,
                                      )
                                    : undefined
                            }
                            yMax={metric === "success" ? 100 : undefined}
                            underlay={
                                metric === "success"
                                    ? {
                                          key: "failed",
                                          color: analyticsColor("failedRuns"),
                                          values: data.overview.points.map((p) => p.failed),
                                      }
                                    : null
                            }
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
                                const topModel = data.modelOrder
                                    .map((k) => ({k, n: data.modelRuns[k][i] ?? 0}))
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
                                            ...(focus?.dim === "model"
                                                ? []
                                                : [
                                                      {
                                                          label: "Most used model",
                                                          value: topModel?.n ? topModel.k : "—",
                                                      },
                                                  ]),
                                            {
                                                label: "Busiest agent",
                                                value: busiest?.n ? agentName(busiest.k) : "—",
                                            },
                                        ]}
                                    />
                                )
                            }}
                        />
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
                    />

                    <DrawerRuns
                        key={`${window.oldest}-${focus?.dim ?? ""}-${focus?.key ?? ""}`}
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
            </div>

            {focus ? (
                <div className="flex justify-end px-5 pb-4 pt-2">
                    <Button
                        size="sm"
                        onClick={() => {
                            setFilters({...filters, [focus.dim]: [focus.key]})
                            setState(null)
                        }}
                    >
                        Apply as filter
                    </Button>
                </div>
            ) : null}
        </>
    )
}

const useToolsPerBucket = (data: ReturnType<typeof useAnalyticsWindowData>) =>
    useMemo(
        () =>
            data.starts.map((_, i) =>
                data.toolOrder.reduce((total, key) => total + (data.toolCalls[key][i] ?? 0), 0),
            ),
        [data.starts, data.toolOrder, data.toolCalls],
    )
