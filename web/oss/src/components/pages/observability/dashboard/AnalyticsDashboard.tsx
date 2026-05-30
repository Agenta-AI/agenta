import {useMemo, type ComponentProps} from "react"

import {formatCompactNumber, formatCurrency, formatNumber} from "@agenta/shared/utils"
import {ChartLineIcon} from "@phosphor-icons/react"
import {Spin} from "antd"
import {useAtom} from "jotai"

import Sort from "@/oss/components/Filters/Sort"
import {useObservabilityDashboard} from "@/oss/state/observability"
import {observabilityDashboardTimeRangeAtom} from "@/oss/state/observability/dashboard"

import CustomAreaChart from "./CustomAreaChart"
import WidgetCard from "./widgetCard"

const emptyStateClass =
    "flex items-center justify-center gap-2 flex-1 min-h-[140px] pb-10 text-colorTextTertiary text-[13px]"

const statTextClass =
    "flex items-center gap-1 text-[13px] [&_.label]:text-colorTextSecondary [&_.label]:font-normal [&_.value]:text-colorText [&_.value]:font-medium [&.danger_.value]:text-[var(--ant-color-error)]"

const gridLayout2Class = "grid grid-cols-2 gap-5 [@media(max-width:768px)]:grid-cols-1"

const gridLayout4Class =
    "grid grid-cols-2 gap-5 [@media(min-width:1360px)]:grid-cols-4 [@media(max-width:850px)]:grid-cols-1"

const EmptyChart = ({className}: {className: string}) => (
    <div className={className}>
        <ChartLineIcon size={18} />
        <span>No data</span>
    </div>
)

interface AnalyticsDashboardProps {
    layout?: "grid-2" | "grid-4"
}

const AnalyticsDashboard = ({layout = "grid-2"}: AnalyticsDashboardProps) => {
    const {data, loading, isFetching} = useObservabilityDashboard()
    const [timeRange, setTimeRange] = useAtom(observabilityDashboardTimeRangeAtom)

    const chartData = useMemo(() => (data?.data?.length ? data.data : []), [data])
    const hasData = (data?.total_count ?? 0) > 0

    const defaultGraphProps = useMemo<ComponentProps<typeof CustomAreaChart>>(
        () => ({
            className: "h-[140px]",
            colors: ["cyan-600", "rose"],
            tickCount: 5,
            index: "timestamp",
            data: chartData,
            categories: [],
            valueFormatter: (value) => formatCompactNumber(value),
        }),
        [chartData],
    )

    const gridClassName = layout === "grid-4" ? gridLayout4Class : gridLayout2Class

    return (
        <div>
            <div className="flex justify-end mb-4">
                <Sort
                    type="text"
                    disabled={loading || isFetching}
                    onSortApply={setTimeRange}
                    defaultSortValue={timeRange.label || "1 month"}
                    exclude={["all time"]}
                />
            </div>
            <Spin spinning={loading || isFetching}>
                <div className={gridClassName}>
                    <WidgetCard
                        title="Requests"
                        leftSubHeading={
                            <div className={statTextClass}>
                                <span className="label">Total:</span>
                                <span className="value">
                                    {data?.total_count ? formatNumber(data?.total_count) : "-"}
                                </span>
                            </div>
                        }
                        rightSubHeading={
                            (data?.failure_rate ?? 0) > 0 && (
                                <div className={`${statTextClass} danger`}>
                                    <span className="label">Failed:</span>
                                    <span className="value">
                                        {data?.failure_rate
                                            ? `${formatNumber(data?.failure_rate)}%`
                                            : "-"}
                                    </span>
                                </div>
                            )
                        }
                    >
                        {hasData ? (
                            <CustomAreaChart
                                {...defaultGraphProps}
                                categories={
                                    (data?.failure_rate ?? 0) > 0
                                        ? ["success_count", "failure_count"]
                                        : ["success_count"]
                                }
                            />
                        ) : (
                            <EmptyChart className={emptyStateClass} />
                        )}
                    </WidgetCard>

                    <WidgetCard
                        title="Latency"
                        leftSubHeading={
                            <div className={statTextClass}>
                                <span className="label">Avg:</span>
                                <span className="value">
                                    {data?.avg_latency
                                        ? `${formatNumber(data.avg_latency)}ms`
                                        : "-"}
                                </span>
                            </div>
                        }
                    >
                        {hasData ? (
                            <CustomAreaChart
                                {...defaultGraphProps}
                                categories={["latency"]}
                                valueFormatter={(value) => `${formatCompactNumber(value)}ms`}
                            />
                        ) : (
                            <EmptyChart className={emptyStateClass} />
                        )}
                    </WidgetCard>

                    <WidgetCard
                        title="Cost"
                        leftSubHeading={
                            <div className={statTextClass}>
                                <span className="label">Total:</span>
                                <span className="value">
                                    {data?.total_cost ? formatCurrency(data.total_cost) : "-"}
                                </span>
                            </div>
                        }
                        rightSubHeading={
                            <div className={statTextClass}>
                                <span className="label">Avg:</span>
                                <span className="value">
                                    {data?.total_cost ? formatCurrency(data.avg_cost) : "-"}
                                </span>
                            </div>
                        }
                    >
                        {hasData ? (
                            <CustomAreaChart
                                {...defaultGraphProps}
                                categories={["cost"]}
                                colors={["cyan-600"]}
                                valueFormatter={(value) => formatCurrency(value)}
                            />
                        ) : (
                            <EmptyChart className={emptyStateClass} />
                        )}
                    </WidgetCard>

                    <WidgetCard
                        title="Tokens"
                        leftSubHeading={
                            <div className={statTextClass}>
                                <span className="label">Total:</span>
                                <span className="value">
                                    {data?.total_tokens ? formatNumber(data?.total_tokens) : "-"}
                                </span>
                            </div>
                        }
                        rightSubHeading={
                            <div className={statTextClass}>
                                <span className="label">Avg:</span>
                                <span className="value">
                                    {data?.avg_tokens ? formatNumber(data?.avg_tokens) : "-"}
                                </span>
                            </div>
                        }
                    >
                        {hasData ? (
                            <CustomAreaChart
                                {...defaultGraphProps}
                                categories={["total_tokens"]}
                                colors={["cyan-600"]}
                            />
                        ) : (
                            <EmptyChart className={emptyStateClass} />
                        )}
                    </WidgetCard>
                </div>
            </Spin>
        </div>
    )
}

export default AnalyticsDashboard
