import type {ReactNode} from "react"

import {observabilityRangeAtom, useObservabilityDashboard} from "@agenta/observability"
import {RangePicker} from "@agenta/observability-ui"
import {
    formatCompactNumber,
    formatCurrency,
    formatNumber,
    formatPercent,
} from "@agenta/shared/utils"
import {LineChart} from "@agenta/ui/components/presentational/charts"
import type {ChartSeries, LinePoint} from "@agenta/ui/components/presentational/charts"
import {Skeleton} from "@agenta/ui/ui"
import {ChartLineIcon, WarningCircleIcon} from "@phosphor-icons/react"
import {useAtom} from "jotai"

const CHART_HEIGHT = 160
const EMPTY = "-"

interface Bucket {
    timestamp: number | string
    success_count: number
    failure_count: number
    cost: number
    latency: number
    total_tokens: number
}

const Stat = ({label, value, danger}: {label: string; value: string; danger?: boolean}) => (
    <span className="flex items-center gap-1 text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span
            className={`font-medium tabular-nums ${danger ? "text-destructive" : "text-foreground"}`}
        >
            {value}
        </span>
    </span>
)

const UsageCard = ({
    title,
    stats,
    children,
}: {
    title: string
    stats: ReactNode
    children: ReactNode
}) => (
    <section
        aria-label={title}
        className="box-border flex min-w-0 flex-col gap-1 rounded-lg border border-solid border-border bg-card px-5 py-4"
    >
        <h3 className="m-0 text-[16px] font-semibold leading-[1.4] text-foreground">{title}</h3>
        <div className="mb-2 flex min-h-[22px] flex-wrap items-center gap-x-4 gap-y-1">{stats}</div>
        {children}
    </section>
)

/** A failed query is not an empty window: the reason shows once above the grid. */
const EmptyChart = ({failed}: {failed: boolean}) => (
    <div
        className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground"
        style={{height: CHART_HEIGHT}}
    >
        {failed ? (
            <WarningCircleIcon size={18} />
        ) : (
            <>
                <ChartLineIcon size={18} />
                <span>No data</span>
            </>
        )}
    </div>
)

/**
 * The app's usage over the picked window, as in the old app: Requests, Latency, Cost and Tokens in
 * a 2x2 grid with the window picker above. `appId` is any workflow (an app or an evaluator); the
 * window is the one every usage surface shares.
 */
export const AppUsageSection = ({appId}: {appId: string}) => {
    const {data, loading, isFetching, errorMessage} = useObservabilityDashboard(appId)
    const [range, setRange] = useAtom(observabilityRangeAtom)
    const busy = loading || isFetching

    const buckets: readonly Bucket[] = data?.data ?? []
    const labels = buckets.map((bucket) => String(bucket.timestamp))
    const hasData = (data?.total_count ?? 0) > 0
    const failed = Boolean(errorMessage) && !busy
    const failureRate = data?.failure_rate ?? 0

    const chart = (
        name: string,
        series: ChartSeries[],
        valueOf: (bucket: Bucket, key: string) => number,
        formatValue: (value: number) => string,
    ) => {
        if (!data && busy) return <Skeleton className="h-[160px] w-full rounded-md" />
        if (!hasData) return <EmptyChart failed={failed} />
        // The buckets carry a ready tick label, not a time: plot by position, label by bucket.
        const points: LinePoint[] = buckets.map((bucket, index) => ({
            x: index,
            values: Object.fromEntries(series.map((s) => [s.key, valueOf(bucket, s.key)])),
        }))
        return (
            <LineChart
                title={`${name} over time`}
                height={CHART_HEIGHT}
                series={series}
                points={points}
                formatValue={formatValue}
                formatX={(index) => labels[index] ?? ""}
            />
        )
    }

    const field = (bucket: Bucket, key: string) => Number(bucket[key as keyof Bucket]) || 0

    return (
        <section aria-label="Usage" className="flex flex-col gap-4">
            <div className="flex justify-end">
                <RangePicker
                    type="text"
                    disabled={busy}
                    value={range}
                    onChange={setRange}
                    fallbackLabel="1 month"
                    exclude={["all time"]}
                    ariaLabel="Usage date range"
                />
            </div>
            {failed ? (
                <div role="alert" className="text-[13px] text-destructive">
                    {errorMessage}
                </div>
            ) : null}
            <div
                className={`grid grid-cols-1 gap-5 md:grid-cols-2 ${data && busy ? "opacity-60" : ""}`}
            >
                <UsageCard
                    title="Requests"
                    stats={
                        <>
                            <Stat
                                label="Total:"
                                value={data?.total_count ? formatNumber(data.total_count) : EMPTY}
                            />
                            {failureRate > 0 ? (
                                <Stat label="Failed:" value={formatPercent(failureRate)} danger />
                            ) : null}
                        </>
                    }
                >
                    {chart(
                        "Requests",
                        failureRate > 0
                            ? [
                                  {key: "success_count", name: "Successful"},
                                  {key: "failure_count", name: "Failed"},
                              ]
                            : [{key: "success_count", name: "Requests"}],
                        field,
                        formatCompactNumber,
                    )}
                </UsageCard>
                <UsageCard
                    title="Latency"
                    stats={
                        <Stat
                            label="Avg:"
                            value={
                                data?.avg_latency ? `${formatNumber(data.avg_latency)}ms` : EMPTY
                            }
                        />
                    }
                >
                    {chart(
                        "Latency",
                        [{key: "latency", name: "Latency"}],
                        field,
                        (value) => `${formatCompactNumber(value)}ms`,
                    )}
                </UsageCard>
                <UsageCard
                    title="Cost"
                    stats={
                        <>
                            <Stat
                                label="Total:"
                                value={data?.total_cost ? formatCurrency(data.total_cost) : EMPTY}
                            />
                            <Stat
                                label="Avg:"
                                value={data?.total_cost ? formatCurrency(data.avg_cost) : EMPTY}
                            />
                            {/* Traces with no cost on their root add 0 to the total. */}
                            {(data?.without_cost_count ?? 0) > 0 ? (
                                <span title="These traces have no cost on their root span. Either they made no priced model call, or their cost could not be added up.">
                                    <Stat
                                        label="Without cost:"
                                        value={formatNumber(data?.without_cost_count ?? 0)}
                                    />
                                </span>
                            ) : null}
                        </>
                    }
                >
                    {chart("Cost", [{key: "cost", name: "Cost"}], field, formatCurrency)}
                </UsageCard>
                <UsageCard
                    title="Tokens"
                    stats={
                        <>
                            <Stat
                                label="Total:"
                                value={data?.total_tokens ? formatNumber(data.total_tokens) : EMPTY}
                            />
                            <Stat
                                label="Avg:"
                                value={data?.avg_tokens ? formatNumber(data.avg_tokens) : EMPTY}
                            />
                        </>
                    }
                >
                    {chart(
                        "Tokens",
                        [{key: "total_tokens", name: "Tokens"}],
                        field,
                        formatCompactNumber,
                    )}
                </UsageCard>
            </div>
        </section>
    )
}
