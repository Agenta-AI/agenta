import {useMemo, useState} from "react"

import {UsageCard} from "@agenta/home-ui"
import {RangePicker} from "@agenta/observability-ui"
import {formatNumber} from "@agenta/shared/utils"
import {CaretDown, CaretUp, ChartLineIcon} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"

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

    // Cost and tokens are out until they're trustworthy: 60 requests reported $0.00 and 0 tokens,
    // which discredited the two real stats beside them. Both remain in the expanded dashboard.
    const stats = useMemo(
        () => [
            {
                label: "Requests",
                value: data?.total_count == null ? EMPTY : formatNumber(data.total_count),
            },
            {label: "Latency", value: formatLatency(data?.avg_latency)},
        ],
        [data],
    )

    // The rail card is the SHARED one (mobile renders it too); this app supplies the range
    // picker and the expanded dashboard, neither of which is portable yet.
    if (variant === "strip") {
        return (
            <UsageCard
                expandedContent={
                    <AnalyticsDashboard layout="stack" showTimeRangeSelector={false} />
                }
            />
        )
    }

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-solid border-[var(--ag-colorBorder)] px-4 py-3">
                <div className="flex items-center gap-2">
                    <ChartLineIcon size={16} className="text-[var(--ag-colorTextSecondary)]" />
                    <span className="text-xs font-medium">Usage</span>
                    <RangePicker
                        type="text"
                        value={timeRange}
                        onChange={setTimeRange}
                        fallbackLabel="1 month"
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
