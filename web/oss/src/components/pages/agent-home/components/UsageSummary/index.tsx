import {useMemo, useState} from "react"

import {formatNumber} from "@agenta/shared/utils"
import {CaretDown, CaretUp, ChartLineIcon} from "@phosphor-icons/react"
import {Button} from "antd"
import dynamic from "next/dynamic"

import {useObservabilityDashboard} from "@/oss/state/observability"

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

/** Collapsed 30-day usage strip; expands to the full observability charts. */
const UsageSummary = ({variant = "default"}: {variant?: "default" | "strip"}) => {
    const [expanded, setExpanded] = useState(false)
    const {data} = useObservabilityDashboard()

    const stats = useMemo(
        () => [
            {label: "Requests", value: data?.total_count ? formatNumber(data.total_count) : "-"},
            {
                label: "Latency",
                value: data?.avg_latency ? `${formatNumber(Math.round(data.avg_latency))}ms` : "-",
            },
            {label: "Cost", value: data?.total_cost ? `$${data.total_cost.toFixed(2)}` : "-"},
            {label: "Tokens", value: data?.total_tokens ? formatNumber(data.total_tokens) : "-"},
        ],
        [data],
    )

    if (variant === "strip") {
        // Strip-era restyle (TEMPLATE_STRIP_MODE): same behavior, redesigned one-liner.
        return (
            <section className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-4 rounded-xl border border-solid border-[var(--ag-strip-card-border)] bg-[var(--ag-strip-card-bg)] px-6 py-5">
                    <div className="flex items-center gap-2">
                        <ChartLineIcon size={17} className="text-[var(--ag-colorTextSecondary)]" />
                        <span className="text-[14.5px] font-semibold text-[var(--ag-colorText)]">
                            Usage
                        </span>
                        <span className="text-[12.5px] text-[var(--ag-colorTextTertiary)]">
                            last 30 days
                        </span>
                    </div>
                    <div className="ml-4 flex flex-wrap items-center gap-8">
                        {stats.map((stat) => (
                            <div
                                key={stat.label}
                                className="flex items-center gap-1.5 text-[13.5px]"
                            >
                                <span className="text-[var(--ag-colorTextSecondary)]">
                                    {stat.label}
                                </span>
                                <span className="font-semibold text-[var(--ag-colorText)]">
                                    {stat.value}
                                </span>
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => setExpanded((prev) => !prev)}
                        className="ml-auto inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13.5px] text-[var(--ag-colorTextSecondary)]"
                    >
                        {expanded ? "Collapse" : "Expand"}
                        {expanded ? (
                            <CaretUp size={15} className="text-[var(--ag-colorTextQuaternary)]" />
                        ) : (
                            <CaretDown size={15} className="text-[var(--ag-colorTextQuaternary)]" />
                        )}
                    </button>
                </div>

                {expanded ? <AnalyticsDashboard layout="grid-4" /> : null}
            </section>
        )
    }

    return (
        <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-solid border-[var(--ag-colorBorder)] px-4 py-3">
                <div className="flex items-center gap-2">
                    <ChartLineIcon size={16} className="text-[var(--ag-colorTextSecondary)]" />
                    <span className="text-xs font-medium">Usage</span>
                    <span className="text-[11px] text-[var(--ag-colorTextTertiary)]">
                        last 30 days
                    </span>
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

            {expanded ? <AnalyticsDashboard layout="grid-4" /> : null}
        </section>
    )
}

export default UsageSummary
