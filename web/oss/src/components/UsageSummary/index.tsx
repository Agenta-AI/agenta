import {useMemo, useState} from "react"

import {formatNumber} from "@agenta/shared/utils"
import {CaretDown, CaretUp, ChartLineIcon} from "@phosphor-icons/react"
import {Button} from "antd"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"

import Sort from "@/oss/components/Filters/Sort"
import {PANEL_ACTION_CLASS, PanelSection} from "@/oss/components/PanelSection"
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

    if (variant === "strip") {
        // Rail card: a header row, then a 2×2 grid of label-over-value. The original one-liner
        // was laid out for the full page width — in a narrow column its stats wrapped mid-row and
        // stranded the expand control, which read as a broken grid rather than a compact summary.
        return (
            // The rail's flex item here is this section, not the card inside it, so it carries
            // the no-shrink itself.
            <PanelSection
                title="Usage"
                bodyClassName="flex flex-col gap-3 px-4 pb-4"
                titleExtra={
                    <Sort
                        type="text"
                        onSortApply={setTimeRange}
                        defaultSortValue={timeRange.label || "1 month"}
                        exclude={["all time"]}
                        ariaLabel="Usage date range"
                    />
                }
                extra={
                    <button
                        type="button"
                        onClick={() => setExpanded((prev) => !prev)}
                        className={PANEL_ACTION_CLASS}
                    >
                        {expanded ? "Collapse" : "Expand"}
                        {expanded ? <CaretUp size={14} /> : <CaretDown size={14} />}
                    </button>
                }
            >
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    {stats.map((stat) => (
                        <div key={stat.label} className="flex flex-col gap-0.5">
                            <span className="text-[11px] text-[var(--ag-colorTextSecondary)]">
                                {stat.label}
                            </span>
                            <span className="text-xs font-semibold text-[var(--ag-colorText)]">
                                {stat.value}
                            </span>
                        </div>
                    ))}
                </div>

                {expanded ? (
                    // Stacked, not gridded: the grid's breakpoints read the viewport, and this
                    // column is 340px on any of them.
                    <AnalyticsDashboard layout="stack" showTimeRangeSelector={false} />
                ) : null}
            </PanelSection>
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
