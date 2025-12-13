import {useMemo} from "react"

import {AreaChart} from "@tremor/react"
import {Col, Row, Spin} from "antd"
import {createUseStyles} from "react-jss"

import {
    formatCompactNumber,
    formatCurrency,
    formatLatency,
    formatNumber,
} from "@/oss/lib/helpers/formatters"
import {JSSTheme} from "@/oss/lib/Types"

import {useObservabilityDashboard} from "../../../../state/observability"
import WidgetCard from "../../observability/dashboard/widgetCard"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        "& .ant-row": {
            rowGap: "20px !important",
        },
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
}))

const ObservabilityOverview = () => {
    const classes = useStyles()
    const {data, loading, isFetching} = useObservabilityDashboard()

    const chartData = useMemo(() => (data?.data?.length ? data.data : [{}]), [data])

    const defaultGraphProps = useMemo<React.ComponentProps<typeof AreaChart>>(
        () => ({
            className: "h-[140px]",
            colors: ["slate", "rose"],
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
        <div className={classes.container}>
            <Spin spinning={loading || isFetching}>
                <Row gutter={[20, 20]}>
                    <Col span={12}>
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
                            <AreaChart
                                {...defaultGraphProps}
                                categories={
                                    (data?.failure_rate ?? 0) > 0
                                        ? ["success_count", "failure_count"]
                                        : ["success_count"]
                                }
                            />
                        </WidgetCard>
                    </Col>
                    <Col span={12}>
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
                            <AreaChart
                                {...defaultGraphProps}
                                categories={["latency"]}
                                valueFormatter={(value) => `${formatCompactNumber(value)}ms`}
                            />
                        </WidgetCard>
                    </Col>
                    <Col span={12}>
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
                            <AreaChart
                                {...defaultGraphProps}
                                categories={["cost"]}
                                colors={["emerald"]}
                                valueFormatter={(value) => formatCurrency(value)}
                            />
                        </WidgetCard>
                    </Col>
                    <Col span={12}>
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
                            <AreaChart
                                {...defaultGraphProps}
                                categories={["total_tokens"]}
                                colors={["emerald"]}
                            />
                        </WidgetCard>
                    </Col>
                </Row>
            </Spin>
        </div>
    )
}

export default ObservabilityOverview
