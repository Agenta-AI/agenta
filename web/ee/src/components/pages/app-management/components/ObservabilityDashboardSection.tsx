import {useMemo, type ComponentProps} from "react"

import {ChartLine} from "@phosphor-icons/react"
import {AreaChart} from "@tremor/react"
import {Spin, Typography} from "antd"
import {createUseStyles} from "react-jss"

import {formatCompactNumber, formatCurrency, formatNumber} from "@/oss/lib/helpers/formatters"
import {JSSTheme} from "@/oss/lib/Types"

import {useObservabilityDashboard} from "../../../../state/observability"
import WidgetCard from "../../observability/dashboard/widgetCard"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-spin-nested-loading": {
            width: "100%",
        },
    },
    sectionSubtitle: {
        fontSize: 13,
        color: theme.colorTextSecondary,
        fontWeight: 400,
    },
    emptyState: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        flex: 1,
        minHeight: 140,
        paddingBottom: 40,

        color: theme.colorTextTertiary,
        fontSize: 13,
    },
    statText: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 13,
        "& .label": {
            color: theme.colorTextSecondary,
            fontWeight: 400,
        },
        "& .value": {
            color: theme.colorText,
            fontWeight: 500,
        },
        "&.danger .value": {
            color: theme.colorError,
        },
    },
    widgetContainer: {
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 20,
        "@media (min-width: 1360px)": {
            gridTemplateColumns: "repeat(4, 1fr)",
        },
        "@media (max-width: 850px)": {
            gridTemplateColumns: "repeat(1, 1fr)",
        },
    },
}))

//TODO: Move this to a shared component
const EmptyChart = ({className}: {className: string}) => (
    <div className={className}>
        <ChartLine size={18} />
        <span>No data</span>
    </div>
)

const ObservabilityDashboardSection = () => {
    const classes = useStyles()
    const {data, loading, isFetching} = useObservabilityDashboard()

    const chartData = useMemo(() => (data?.data?.length ? data.data : []), [data])
    const hasData = (data?.total_count ?? 0) > 0

    const defaultGraphProps = useMemo<ComponentProps<typeof AreaChart>>(
        () => ({
            className: "h-[140px]",
            colors: ["cyan-600", "red"],
            connectNulls: true,
            tickGap: 20,
            curveType: "monotone",
            showGridLines: true,
            showLegend: false,
            index: "timestamp",
            data: chartData,
            categories: [],
            valueFormatter: (value) => formatCompactNumber(value),
            yAxisWidth: 48,
            showXAxis: true,
            showYAxis: true,
        }),
        [chartData],
    )

    return (
        <div className={`my-6 flex flex-col gap-4 ${classes.container}`}>
            <div className="flex items-baseline justify-between">
                <Typography.Title level={2} className="!m-0">
                    Analytics
                </Typography.Title>
                <span className={classes.sectionSubtitle}>Last 30 days</span>
            </div>
            <Spin spinning={loading || isFetching}>
                <div className={classes.widgetContainer}>
                    <div className="flex-1">
                        <WidgetCard
                            title="Requests"
                            leftSubHeading={
                                <div className={classes.statText}>
                                    <span className="label">Total:</span>
                                    <span className="value">
                                        {data?.total_count ? formatNumber(data?.total_count) : "-"}
                                    </span>
                                </div>
                            }
                            rightSubHeading={
                                (data?.failure_rate ?? 0) > 0 && (
                                    <div className={`${classes.statText} danger`}>
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
                                <AreaChart
                                    {...defaultGraphProps}
                                    categories={
                                        (data?.failure_rate ?? 0) > 0
                                            ? ["success_count", "failure_count"]
                                            : ["success_count"]
                                    }
                                />
                            ) : (
                                <EmptyChart className={classes.emptyState} />
                            )}
                        </WidgetCard>
                    </div>
                    <div className="flex-1">
                        <WidgetCard
                            title="Latency"
                            leftSubHeading={
                                <div className={classes.statText}>
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
                                <AreaChart
                                    {...defaultGraphProps}
                                    categories={["latency"]}
                                    valueFormatter={(value) => `${formatCompactNumber(value)}ms`}
                                />
                            ) : (
                                <EmptyChart className={classes.emptyState} />
                            )}
                        </WidgetCard>
                    </div>
                    <div className="flex-1">
                        <WidgetCard
                            title="Cost"
                            leftSubHeading={
                                <div className={classes.statText}>
                                    <span className="label">Total:</span>
                                    <span className="value">
                                        {data?.total_cost ? formatCurrency(data.total_cost) : "-"}
                                    </span>
                                </div>
                            }
                            rightSubHeading={
                                <div className={classes.statText}>
                                    <span className="label">Avg:</span>
                                    <span className="value">
                                        {data?.total_cost ? formatCurrency(data.avg_cost) : "-"}
                                    </span>
                                </div>
                            }
                        >
                            {hasData ? (
                                <AreaChart
                                    {...defaultGraphProps}
                                    categories={["cost"]}
                                    colors={["cyan-600"]}
                                    valueFormatter={(value) => formatCurrency(value)}
                                />
                            ) : (
                                <EmptyChart className={classes.emptyState} />
                            )}
                        </WidgetCard>
                    </div>
                    <div className="flex-1">
                        <WidgetCard
                            title="Tokens"
                            leftSubHeading={
                                <div className={classes.statText}>
                                    <span className="label">Total:</span>
                                    <span className="value">
                                        {data?.total_tokens
                                            ? formatNumber(data?.total_tokens)
                                            : "-"}
                                    </span>
                                </div>
                            }
                            rightSubHeading={
                                <div className={classes.statText}>
                                    <span className="label">Avg:</span>
                                    <span className="value">
                                        {data?.avg_tokens ? formatNumber(data?.avg_tokens) : "-"}
                                    </span>
                                </div>
                            }
                        >
                            {hasData ? (
                                <AreaChart
                                    {...defaultGraphProps}
                                    categories={["total_tokens"]}
                                    colors={["cyan-600"]}
                                />
                            ) : (
                                <EmptyChart className={classes.emptyState} />
                            )}
                        </WidgetCard>
                    </div>
                </div>
            </Spin>
        </div>
    )
}

export default ObservabilityDashboardSection
