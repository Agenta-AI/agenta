import {memo, useCallback, useMemo, useState, type ReactNode} from "react"

import {Popover} from "antd"
import {atom} from "jotai"
import {LOW_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    previewRunMetricStatsSelectorFamily,
    type RunLevelMetricSelection,
} from "@/oss/components/Evaluations/atoms/runMetrics"
import {
    ResponsiveFrequencyChart,
    ResponsiveMetricChart,
    buildChartData,
} from "@/oss/components/Evaluations/MetricDetailsPopover"
import {formatCurrency, formatLatency} from "@/oss/lib/helpers/formatters"
import type {BasicStats} from "@/oss/lib/metricUtils"

const formatNumber = (value: unknown): string => {
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return String(value)
        const abs = Math.abs(value)
        if (abs === 0) return "0"
        if (abs >= 1000) {
            return value.toLocaleString(undefined, {maximumFractionDigits: 2})
        }
        if (abs >= 1) {
            return value.toFixed(2).replace(/\.?0+$/, "")
        }
        const decimals = Math.min(12, Math.max(4, Math.ceil(Math.abs(Math.log10(abs))) + 2))
        return value.toFixed(decimals).replace(/\.?0+$/, "")
    }
    return String(value ?? "")
}

const formatMetricNumber = (metricKey: string | undefined, value: number): string => {
    if (!Number.isFinite(value)) return String(value)
    if (metricKey?.includes("cost")) return formatCurrency(value)
    if (metricKey?.includes("duration")) return formatLatency(value)
    return formatNumber(value)
}

const buildPrimitiveRows = (stats: Record<string, any> | undefined, metricKey?: string) => {
    if (!stats) return []
    const rows: {label: string; value: string}[] = []
    const addRow = (label: string, raw: unknown, {formatNumeric = true} = {}) => {
        if (raw === undefined || raw === null || raw === "") return
        if (typeof raw === "number" && formatNumeric) {
            rows.push({label, value: formatMetricNumber(metricKey, raw)})
            return
        }
        rows.push({label, value: formatNumber(raw)})
    }

    addRow("Mean", stats.mean)
    addRow("Std Dev", stats.std ?? stats.stddev ?? stats.stdDev)
    addRow("Min", stats.min)
    addRow("Max", stats.max)
    addRow("Count", stats.count, {formatNumeric: false})
    addRow("Sum", stats.sum)
    addRow("Total", stats.total)

    return rows
}

const POPOVER_STYLES = {
    root: {
        maxWidth: 360,
        width: "calc(100vw - 32px)",
    },
    body: {
        padding: 0,
        borderRadius: 16,
        border: "1px solid #E4E7EC",
        boxShadow: "0px 18px 45px rgba(15, 23, 42, 0.18)",
        background: "#fff",
        maxHeight: 480,
        overflowY: "auto",
    },
    arrow: {
        color: "#fff",
    },
} as const

const Section = ({title, children}: {title: string; children: ReactNode}) => (
    <section className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            {title}
        </span>
        {children}
    </section>
)

const DistributionSkeleton = () => (
    <div className="flex flex-col gap-3">
        <div className="h-3 w-24 rounded-full bg-neutral-200/80 animate-pulse" />
        <div className="relative h-[160px] w-full overflow-hidden rounded-2xl border border-neutral-100 bg-neutral-50">
            <div className="h-full w-full animate-pulse bg-gradient-to-r from-neutral-100 via-neutral-200/80 to-neutral-100" />
        </div>
    </div>
)

const normalizeStatShape = (value: any) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    const next: any = {...value}

    if (Array.isArray(next.freq)) {
        next.frequency = next.freq.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
        delete next.freq
    }

    if (Array.isArray(next.uniq)) {
        next.unique = next.uniq
        delete next.uniq
    }

    if (Array.isArray(next.frequency)) {
        next.frequency = next.frequency.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
        next.frequency.sort(
            (a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0) || (a?.value === true ? -1 : 1),
        )
        next.rank = next.frequency
        if (!Array.isArray(next.unique) || !next.unique.length) {
            next.unique = next.frequency.map((entry: any) => entry.value)
        }
    } else if (Array.isArray(next.rank)) {
        next.rank = next.rank.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
    }

    if (Array.isArray(next.hist)) {
        if (!Array.isArray(next.distribution) || !next.distribution.length) {
            next.distribution = next.hist
                .map((entry: any) => {
                    const interval = Array.isArray(entry?.interval) ? entry.interval : []
                    const start =
                        interval.length && typeof interval[0] === "number"
                            ? interval[0]
                            : typeof entry?.value === "number"
                              ? entry.value
                              : typeof entry?.bin === "number"
                                ? entry.bin
                                : 0
                    return {
                        value: start,
                        count: entry?.count ?? 0,
                    }
                })
                .sort((a: any, b: any) => (a?.value ?? 0) - (b?.value ?? 0))
        }

        if (typeof next.binSize !== "number") {
            const interval = Array.isArray(next.hist[0]?.interval) ? next.hist[0].interval : null
            if (interval && interval.length >= 2) {
                const width = Number(interval[1]) - Number(interval[0])
                if (Number.isFinite(width) && width > 0) next.binSize = width
            }
        }

        if (typeof next.min !== "number") {
            const interval = Array.isArray(next.hist[0]?.interval) ? next.hist[0].interval : null
            if (interval && interval.length) next.min = interval[0]
        }

        if (typeof next.max !== "number") {
            const last = next.hist[next.hist.length - 1]
            const interval = Array.isArray(last?.interval) ? last.interval : null
            if (interval && interval.length) next.max = interval[interval.length - 1]
        }
    }

    return next
}

const formatScenarioValue = (value: unknown, metricKey?: string): string | null => {
    if (value === undefined || value === null) return null
    if (typeof value === "boolean") return value ? "true" : "false"
    if (typeof value === "number") {
        if (metricKey?.includes("cost")) {
            return formatCurrency(value)
        }
        if (metricKey?.includes("duration")) {
            return formatLatency(value)
        }
        return formatNumber(value)
    }
    if (typeof value === "string") return value
    if (Array.isArray(value)) {
        try {
            return JSON.stringify(value)
        } catch {
            return String(value)
        }
    }
    if (typeof value === "object") {
        const normalized = normalizeStatShape(value)
        const frequency = normalized?.frequency
        if (Array.isArray(frequency) && frequency.length) {
            const best = [...frequency].sort(
                (a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0),
            )[0]
            if (best && best.value !== undefined) {
                return formatScenarioValue(best.value)
            }
        }
        const mean = normalized?.mean
        if (typeof mean === "number") return formatNumber(mean)
        const nestedValue = normalized?.value
        if (nestedValue !== undefined) return formatScenarioValue(nestedValue)
        const unique = normalized?.unique
        if (Array.isArray(unique) && unique.length) return formatScenarioValue(unique[0])
        try {
            return JSON.stringify(normalized, null, 2)
        } catch {
            return String(normalized)
        }
    }
    return String(value)
}

const IDLE_RUN_METRIC_SELECTION: RunLevelMetricSelection = {
    state: "hasData",
    stats: undefined,
    resolvedKey: undefined,
}

const idleRunMetricSelectionAtom = atom<RunLevelMetricSelection>(IDLE_RUN_METRIC_SELECTION)

const MetricPopoverContent = ({
    runId,
    metricKey,
    metricPath,
    metricLabel,
    highlightValue,
    fallbackValue,
    stepType,
    stepKey,
    shouldLoad,
    showScenarioValue = true,
    prefetchedStats,
}: {
    runId?: string
    metricKey?: string
    metricPath?: string
    metricLabel?: string
    highlightValue?: unknown
    fallbackValue?: unknown
    stepType?: string
    stepKey?: string
    shouldLoad: boolean
    showScenarioValue?: boolean
    prefetchedStats?: BasicStats
}) => {
    const prefetchedSelectionAtom = useMemo(
        () =>
            prefetchedStats
                ? atom<RunLevelMetricSelection>({
                      state: "hasData",
                      stats: prefetchedStats,
                      resolvedKey: metricKey ?? metricPath,
                  })
                : null,
        [prefetchedStats, metricKey, metricPath],
    )
    const effectiveShouldLoad = shouldLoad || Boolean(prefetchedStats)
    const selectionAtom = useMemo(
        () =>
            prefetchedSelectionAtom
                ? prefetchedSelectionAtom
                : runId && effectiveShouldLoad
                  ? previewRunMetricStatsSelectorFamily({
                        runId,
                        metricKey,
                        metricPath,
                        stepKey,
                    })
                  : idleRunMetricSelectionAtom,
        [prefetchedSelectionAtom, runId, metricKey, metricPath, stepKey, effectiveShouldLoad],
    )

    const selection = useAtomValueWithSchedule(selectionAtom, {priority: LOW_PRIORITY})
    const loading = selection.state === "loading"
    const hasError = selection.state === "hasError"
    const stats = selection.state === "hasData" ? selection.stats : undefined
    const resolvedMetricKey = metricLabel ?? selection.resolvedKey ?? metricKey ?? metricPath

    const primitiveRows = useMemo(
        () => buildPrimitiveRows(stats as any, metricKey),
        [stats, metricKey],
    )
    const summaryRows = useMemo(
        () => primitiveRows.filter((row) => row.label !== "Count"),
        [primitiveRows],
    )
    const summaryPreviewRows = useMemo(() => summaryRows.slice(0, 2), [summaryRows])
    const totalScenarios = useMemo(() => {
        const primitiveCountRow = primitiveRows.find((row) => row.label === "Count")
        const primitiveCount = primitiveCountRow ? Number(primitiveCountRow.value) : null
        const statsCount = (stats as any)?.count ?? (stats as any)?.total_count
        if (typeof primitiveCount === "number" && Number.isFinite(primitiveCount))
            return primitiveCount
        if (typeof statsCount === "number" && Number.isFinite(statsCount)) return statsCount
        const frequencySum = Array.isArray((stats as any)?.frequency)
            ? (stats as any).frequency.reduce(
                  (acc: number, entry: any) =>
                      acc + (typeof entry?.count === "number" ? entry.count : 0),
                  0,
              )
            : undefined
        if (typeof frequencySum === "number" && Number.isFinite(frequencySum)) {
            return frequencySum
        }
        return undefined
    }, [primitiveRows, stats])

    const chartData = useMemo(() => {
        if (!stats) return []
        const data = buildChartData(stats as Record<string, any>)
        const safeData = Array.isArray(data) ? data : []
        return safeData
    }, [stats])
    const histogramCandidates = useMemo(
        () =>
            chartData.filter((entry: any) => {
                if (!entry) return false
                const edge =
                    typeof entry.edge === "number"
                        ? entry.edge
                        : entry.edge !== undefined
                          ? Number(entry.edge)
                          : Number.NaN
                return Number.isFinite(edge)
            }),
        [chartData],
    )
    const hasHistogram =
        histogramCandidates.length > 0 && histogramCandidates.length === chartData.length
    const histogramChartData = hasHistogram
        ? histogramCandidates.map((entry: any) => ({
              ...entry,
              edge: typeof entry.edge === "number" ? entry.edge : Number(entry.edge),
              value:
                  typeof entry.value === "number"
                      ? entry.value
                      : Number.isFinite(Number(entry.value))
                        ? Number(entry.value)
                        : 0,
          }))
        : []
    const binSize =
        typeof (stats as any)?.binSize === "number" && Number.isFinite((stats as any).binSize)
            ? (stats as any).binSize
            : undefined
    const binWidthDisplay =
        typeof binSize === "number" ? formatMetricNumber(metricKey, binSize) : null
    const frequencyChartData = hasHistogram
        ? []
        : chartData
              .map((entry) => {
                  if (!entry) return null
                  const label = entry.name ?? entry.label ?? ""
                  const rawValue = entry.value ?? entry.count
                  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
                      return {label, count: rawValue}
                  }
                  const parsed = Number(rawValue)
                  return {
                      label,
                      count: Number.isFinite(parsed) ? parsed : 0,
                  }
              })
              .filter((entry): entry is {label: string | number; count: number} => Boolean(entry))
    const hasFrequencyChart = frequencyChartData.length > 0
    const toScalar = (source: unknown): unknown => {
        if (source === undefined || source === null) return source
        if (typeof source === "boolean" || typeof source === "number" || typeof source === "string")
            return source
        if (typeof source === "object") {
            const normalized = normalizeStatShape(source)
            const maybeMean = normalized?.mean
            if (typeof maybeMean === "number") return maybeMean
            const maybeValue = normalized?.value
            if (typeof maybeValue === "number" || typeof maybeValue === "string") return maybeValue
            const freq = normalized?.frequency
            if (Array.isArray(freq) && freq.length) {
                const top =
                    [...freq]
                        .sort((a: any, b: any) => (b?.count ?? 0) - (a?.count ?? 0))
                        .find((entry: any) => entry?.count > 0) || freq[0]
                if (top && top.value !== undefined) return top.value
            }
            const unique = normalized?.unique
            if (Array.isArray(unique) && unique.length) return unique[0]
        }
        return source
    }

    const scenarioScalar = showScenarioValue ? toScalar(fallbackValue) : null
    const scenarioValueToShow = showScenarioValue
        ? scenarioScalar !== undefined && scenarioScalar !== null
            ? scenarioScalar
            : fallbackValue
        : null
    const scenarioDisplay = showScenarioValue
        ? formatScenarioValue(scenarioValueToShow, metricKey)
        : null
    const hasDetails = Boolean(
        summaryRows.length || hasHistogram || hasFrequencyChart || scenarioDisplay,
    )
    const isEmpty = !stats && !loading && !hasError
    const highlightSource =
        highlightValue !== undefined && highlightValue !== null ? highlightValue : fallbackValue
    const highlightScalar = toScalar(highlightSource)
    const highlightDisplay = formatScenarioValue(highlightScalar, metricKey)
    const frequencyHighlightValues: (string | number)[] = highlightDisplay ? [highlightDisplay] : []

    const headlineMetrics = useMemo(() => {
        const items: {label: string; value: string}[] = []
        if (typeof totalScenarios === "number" && Number.isFinite(totalScenarios)) {
            items.push({label: "Count", value: formatNumber(totalScenarios)})
        }
        summaryPreviewRows.forEach((row) => {
            if (row.value) items.push(row)
        })
        return items.slice(0, 3)
    }, [summaryPreviewRows, totalScenarios])

    // const summarySection = summaryRows.length ? (
    //     <Section title="Summary">
    //         <div className="rounded-2xl border border-neutral-100 bg-white/80">
    //             {summaryRows.map(({label, value}, index) => (
    //                 <div
    //                     key={label}
    //                     className={`flex items-center justify-between gap-6 px-3 py-2 text-[12px] ${
    //                         index !== summaryRows.length - 1 ? "border-b border-neutral-100" : ""
    //                     }`}
    //                 >
    //                     <span className="text-neutral-500">{label}</span>
    //                     <span className="font-semibold text-neutral-900 tabular-nums">{value}</span>
    //                 </div>
    //             ))}
    //         </div>
    //     </Section>
    // ) : null

    const headlineMetricsRow = headlineMetrics.length ? (
        <div className="flex items-center gap-2 border border-neutral-100 py-2">
            {headlineMetrics.map(({label, value}) => (
                <div
                    key={label}
                    className="flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] shadow-sm"
                >
                    <span className="uppercase tracking-wide text-[10px] text-neutral-400">
                        {label}
                    </span>
                    <span className="text-[12px] font-semibold text-neutral-900 tabular-nums">
                        {value}
                    </span>
                </div>
            ))}
        </div>
    ) : null

    // if (typeof window !== "undefined") {
    //     console.info("[EvalRunDetails2] MetricPopover render", {
    //         runId,
    //         metricKey,
    //         metricPath,
    //         stepKey,
    //         highlightValue,
    //         fallbackValue,
    //         highlightScalar,
    //         scenarioDisplay,
    //         statsAvailable: Boolean(stats),
    //         loading,
    //         hasError,
    //     })
    //     if (stats) {
    //         console.info("[EvalRunDetails2] MetricPopover run-level stats", stats)
    //     }
    // }

    if (!shouldLoad && !prefetchedStats) {
        return <span className="text-xs text-neutral-500">Loading statistics…</span>
    }

    if (!runId) {
        return (
            <div className="max-w-[320px] text-xs text-neutral-600">
                Run metadata unavailable—statistics cannot be loaded.
            </div>
        )
    }

    if (hasError) {
        return (
            <div className="max-w-[320px] text-xs text-neutral-600">
                Failed to load run-level statistics.{" "}
                {selection.error ? String(selection.error) : ""}
            </div>
        )
    }

    const highlightChip = highlightDisplay ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] text-neutral-900 shadow-sm">
            <span className="uppercase tracking-wide text-[10px] text-neutral-400">Value</span>
            {highlightDisplay}
        </span>
    ) : null

    return (
        <div className="flex w-[320px] max-w-[360px] flex-col gap-4 rounded-2xl bg-white p-4 text-xs text-neutral-700">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-neutral-900">
                        {resolvedMetricKey ?? "Metric details"}
                    </span>
                    {highlightChip}
                </div>
                {headlineMetricsRow}
            </div>
            {loading ? (
                <>
                    {showScenarioValue ? (
                        <Section title="Scenario value">
                            <div className="h-3 w-3/4 rounded-full bg-neutral-200/70 animate-pulse" />
                        </Section>
                    ) : null}
                    <Section title="Distribution">
                        <DistributionSkeleton />
                    </Section>
                </>
            ) : hasDetails ? (
                <>
                    {scenarioDisplay ? (
                        <Section title="Scenario value">
                            <span className="text-neutral-800 text-xs whitespace-pre-wrap">
                                {scenarioDisplay}
                            </span>
                        </Section>
                    ) : null}
                    {hasHistogram || hasFrequencyChart ? (
                        <Section title="Distribution">
                            <div className="h-[160px] w-full">
                                {hasHistogram ? (
                                    <ResponsiveMetricChart
                                        chartData={histogramChartData}
                                        extraDimensions={stats as any}
                                        binWidthLabel={binWidthDisplay ?? undefined}
                                        highlightValue={
                                            typeof highlightScalar === "number"
                                                ? (highlightScalar as number)
                                                : undefined
                                        }
                                    />
                                ) : (
                                    <ResponsiveFrequencyChart
                                        data={frequencyChartData}
                                        highlightValues={frequencyHighlightValues}
                                    />
                                )}
                            </div>
                        </Section>
                    ) : null}
                    {/* {summarySection} */}
                </>
            ) : (
                <div className="flex flex-col gap-2 text-[11px] text-neutral-600">
                    {showScenarioValue && scenarioDisplay ? (
                        <Section title="Scenario value">
                            <span className="text-neutral-800 text-xs whitespace-pre-wrap">
                                {scenarioDisplay}
                            </span>
                        </Section>
                    ) : null}
                    <span className="text-neutral-500">
                        {isEmpty
                            ? stepType === "annotation"
                                ? "Run-level evaluator statistics not available yet."
                                : "Run-level statistics not available yet."
                            : stepType === "annotation"
                              ? "Run-level evaluator statistics not available yet."
                              : "No run-level statistics available yet."}
                    </span>
                </div>
            )}
        </div>
    )
}

const MetricDetailsPreviewPopover = memo(
    ({
        runId,
        metricKey,
        metricPath,
        metricLabel,
        highlightValue,
        fallbackValue,
        stepType,
        stepKey,
        showScenarioValue,
        prefetchedStats,
        children,
    }: {
        runId?: string
        metricKey?: string
        metricPath?: string
        metricLabel?: string
        highlightValue?: unknown
        fallbackValue?: unknown
        stepType?: string
        stepKey?: string
        showScenarioValue?: boolean
        prefetchedStats?: BasicStats
        children: React.ReactNode
    }) => {
        const [shouldLoad, setShouldLoad] = useState(false)
        const handleOpenChange = useCallback((next: boolean) => {
            if (next) setShouldLoad(true)
        }, [])

        return (
            <Popover
                trigger={["hover", "focus"]}
                onOpenChange={handleOpenChange}
                placement="top"
                styles={POPOVER_STYLES}
                destroyOnHidden
                content={
                    <MetricPopoverContent
                        runId={runId}
                        metricKey={metricKey}
                        metricPath={metricPath}
                        metricLabel={metricLabel}
                        highlightValue={highlightValue}
                        fallbackValue={fallbackValue}
                        stepType={stepType}
                        stepKey={stepKey}
                        shouldLoad={shouldLoad}
                        showScenarioValue={showScenarioValue}
                        prefetchedStats={prefetchedStats}
                    />
                }
            >
                <div className="flex w-full h-full">{children}</div>
            </Popover>
        )
    },
)

MetricDetailsPreviewPopover.displayName = "MetricDetailsPreviewPopover"

export default MetricDetailsPreviewPopover
