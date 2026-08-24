import {useMemo, useState, type ReactNode} from "react"

import {useObservabilityDashboard} from "@agenta/observability"
import {formatNumber} from "@agenta/shared/utils"
import {
    HeightCollapse,
    PANEL_ACTION_CLASS,
    PanelSection,
} from "@agenta/ui/components/presentational"
import {CaretDown, CaretUp} from "@phosphor-icons/react"

import {AnalyticsRangePicker} from "./AnalyticsRangePicker"

/** No data reads as an em dash. A falsy check would print it for a genuine zero. */
const EMPTY = "—"

/** Five-digit milliseconds are unreadable; past a second the useful unit is seconds. */
const formatLatency = (ms: number | null | undefined) => {
    if (ms == null) return EMPTY
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}

const formatCost = (value: number | null | undefined) =>
    value == null ? EMPTY : `$${value < 0.01 && value > 0 ? value.toFixed(4) : value.toFixed(2)}`

const formatPercent = (value: number | null | undefined) =>
    value == null ? EMPTY : `${(value * 100).toFixed(1)}%`

const Stat = ({label, value}: {label: string; value: string}) => (
    <div className="flex flex-col gap-0.5">
        <span className="text-xs text-colorTextSecondary">{label}</span>
        <span className="text-xs font-semibold text-colorText">{value}</span>
    </div>
)

export interface UsageCardProps {
    /** Scope to one app/agent; omit for the whole project. */
    appId?: string | null
    /** Rendered under the shared detail figures when expanded — desktop's charts. */
    expandedContent?: ReactNode
}

/**
 * The rail's usage card: a header row with the window picker, then a 2x2 grid of
 * label-over-value, and the rest of the figures behind Expand.
 *
 * Requests and latency lead because they are the two that are always trustworthy. Cost and
 * tokens sit in the expanded block rather than the summary: 60 requests once reported $0.00 and
 * 0 tokens, which discredited the two real stats beside them — but they are still the numbers
 * you came for once you go looking.
 */
export const UsageCard = ({appId = null, expandedContent}: UsageCardProps) => {
    const [expanded, setExpanded] = useState(false)
    const {data} = useObservabilityDashboard(appId)

    const summary = useMemo(
        () => [
            {
                label: "Requests",
                value: data?.total_count == null ? EMPTY : formatNumber(data.total_count),
            },
            {label: "Latency", value: formatLatency(data?.avg_latency)},
        ],
        [data],
    )

    const details = useMemo(
        () => [
            {label: "Total cost", value: formatCost(data?.total_cost)},
            {label: "Avg cost", value: formatCost(data?.avg_cost)},
            {
                label: "Total tokens",
                value: data?.total_tokens == null ? EMPTY : formatNumber(data.total_tokens),
            },
            {
                label: "Avg tokens",
                value: data?.avg_tokens == null ? EMPTY : formatNumber(Math.round(data.avg_tokens)),
            },
            {label: "Failure rate", value: formatPercent(data?.failure_rate)},
        ],
        [data],
    )

    return (
        <PanelSection
            title="Usage"
            bodyClassName="flex flex-col gap-3 px-4 pb-4"
            titleExtra={<AnalyticsRangePicker />}
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
                {summary.map((stat) => (
                    <Stat key={stat.label} {...stat} />
                ))}
            </div>

            {/* Stacked, not gridded: the grid's breakpoints read the viewport, and this column is
                340px on any of them. */}
            <HeightCollapse open={expanded}>
                <div className="flex flex-col gap-3 border-0 border-t border-solid border-colorBorderSecondary pt-3">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                        {details.map((stat) => (
                            <Stat key={stat.label} {...stat} />
                        ))}
                    </div>
                    {expandedContent}
                </div>
            </HeightCollapse>
        </PanelSection>
    )
}
