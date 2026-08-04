import {useMemo, useState} from "react"

import {formatNumber} from "@agenta/shared/utils"
import {CaretDown, CaretUp, ChartLineIcon} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"

import Sort from "@/oss/components/Filters/Sort"
import {useObservabilityDashboard} from "@/oss/state/observability"
import {observabilityDashboardTimeRangeAtom} from "@/oss/state/observability/dashboard"

// Reuse the full observability charts for the expanded view (default range = 30 days).
const AnalyticsDashboard = dynamic(
    () => import("@/oss/components/pages/observability/dashboard/AnalyticsDashboard"),
)

const StatItem = ({label, value}: {label: string; value: string}) => (
    <div className="flex items-center gap-1.5 text-xs">
        <span className="text-[var(--ag-colorTextSecondary)]">{label}</span>
        <span className="font-medium text-[var(--ag-colorText)]">{value}</span>
    </div>
)

/** No data reads as an em dash. A falsy check would print it for a genuine zero. */
const EMPTY = "—"

/** Five-digit milliseconds are unreadable; past a second the useful unit is seconds. */
const formatLatency = (ms: number | null | undefined) => {
    if (ms == null) return EMPTY
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** Usage summary with an optional expanded observability dashboard. */
const UsageSummary = ({variant = "default"}: {variant?: "default" | "strip"}) => {
    const [expanded, setExpanded] = useState(false)
    const {data} = useObservabilityDashboard()
    const [timeRange, setTimeRange] = useAtom(observabilityDashboardTimeRangeAtom)

    const stats = useMemo(
        () => [
            {
                label: "Requests",
                value: data?.total_count == null ? EMPTY : formatNumber(data.total_count),
            },
            {label: "Latency", value: formatLatency(data?.avg_latency)},
            {
                label: "Cost",
                value: data?.total_cost == null ? EMPTY : `$${data.total_cost.toFixed(2)}`,
            },
            {
                label: "Tokens",
                value: data?.total_tokens == null ? EMPTY : formatNumber(data.total_tokens),
            },
        ],
        [data],
    )

    if (variant === "strip") {
        // Rail card: a header row, then a 2×2 grid of label-over-value. The original one-liner
        // was laid out for the full page width — in a narrow column its stats wrapped mid-row and
        // stranded the expand control, which read as a broken grid rather than a compact summary.
        return (
            <section className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 rounded-xl border border-solid border-[var(--ag-strip-card-border)] bg-[var(--ag-strip-card-bg)] px-4 py-4">
                    <div className="flex items-center gap-2">
                        <ChartLineIcon size={15} className="text-[var(--ag-colorTextSecondary)]" />
                        <span className="text-xs font-medium text-[var(--ag-colorText)]">
                            Usage
                        </span>
                        <Sort
                            type="text"
                            onSortApply={setTimeRange}
                            defaultSortValue={timeRange.label || "1 month"}
                            exclude={["all time"]}
                            ariaLabel="Usage date range"
                        />
                        <button
                            type="button"
                            onClick={() => setExpanded((prev) => !prev)}
                            className="ml-auto inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-xs text-[var(--ag-colorTextSecondary)]"
                        >
                            {expanded ? "Collapse" : "Expand"}
                            {expanded ? (
                                <CaretUp
                                    size={14}
                                    className="text-[var(--ag-colorTextQuaternary)]"
                                />
                            ) : (
                                <CaretDown
                                    size={14}
                                    className="text-[var(--ag-colorTextQuaternary)]"
                                />
                            )}
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {stats.map((stat) => (
                            <div key={stat.label} className="flex flex-col gap-0.5">
                                <span className="text-[11px] text-[var(--ag-colorTextSecondary)]">
                                    {stat.label}
                                </span>
                                <span className="text-sm font-semibold text-[var(--ag-colorText)]">
                                    {stat.value}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

                {expanded ? (
                    <AnalyticsDashboard layout="grid-4" showTimeRangeSelector={false} />
                ) : null}
            </section>
        )
    }

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-solid border-[var(--ag-colorBorder)] px-4 py-3">
                <div className="flex items-center gap-2">
                    <ChartLineIcon size={16} className="text-[var(--ag-colorTextSecondary)]" />
                    <span className="text-xs font-medium">Usage</span>
                    <Sort
                        type="text"
                        onSortApply={setTimeRange}
                        defaultSortValue={timeRange.label || "1 month"}
                        exclude={["all time"]}
                        ariaLabel="Usage date range"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                    {stats.map((stat) => (
                        <StatItem key={stat.label} label={stat.label} value={stat.value} />
                    ))}
                </div>
                <Button
                    type="text"
                    onClick={() => setExpanded((prev) => !prev)}
                    className="ml-auto inline-flex items-center gap-1"
                >
                    {expanded ? "Collapse" : "Expand"}
                    {expanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                </Button>
            </div>

            {expanded ? <AnalyticsDashboard layout="grid-4" showTimeRangeSelector={false} /> : null}
        </section>
    )
}

export default UsageSummary
