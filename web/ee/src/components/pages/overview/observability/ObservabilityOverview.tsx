import {useMemo} from "react"

import {AreaChart} from "@tremor/react"
import {Col, Row, Spin, Typography} from "antd"
import round from "lodash/round"
import {createUseStyles} from "react-jss"

import {formatCurrency, formatLatency, formatNumber} from "@/oss/lib/helpers/formatters"
import {JSSTheme} from "@/oss/lib/Types"

import {useObservabilityDashboard} from "../../../../state/observability"
import WidgetCard from "../../observability/dashboard/widgetCard"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    statText: {
        fontWeight: 400,
    },
}))

const ObservabilityOverview = () => {
    const classes = useStyles()
    const {data, loading, isFetching} = useObservabilityDashboard()

    const chartData = useMemo(() => (data?.data?.length ? data.data : [{}]), [data])

    const defaultGraphProps = useMemo<React.ComponentProps<typeof AreaChart>>(
        () => ({
            className: "h-[160px]",
            connectNulls: true,
            curveType: "monotone",
            showGridLines: false,
            showLegend: false,
            showYAxis: true,
            showXAxis: true,
            index: "timestamp",
            data: chartData,
            categories: [],
            showAnimation: false,
            autoMinValue: true,
        }),
        [chartData],
    )

    return (
        <div>
            <Spin spinning={loading || isFetching}>
                <Row gutter={[16, 16]}>
                    <Col span={12}>
                        <WidgetCard
                            title="Requests"
                            leftSubHeading={
                                <Typography.Text className={classes.statText}>
                                    <Typography.Text type="secondary">Total:</Typography.Text>{" "}
                                    {data?.total_count ? formatNumber(data?.total_count) : "-"}
                                </Typography.Text>
                            }
                            rightSubHeading={
                                (data?.failure_rate ?? 0) > 0 && (
                                    <Typography.Text type="danger" className={classes.statText}>
                                        <Typography.Text type="secondary">Failed:</Typography.Text>{" "}
                                        {data?.failure_rate
                                            ? `${formatNumber(data?.failure_rate)}%`
                                            : "-"}
                                    </Typography.Text>
                                )
                            }
                        >
                            <AreaChart
                                {...defaultGraphProps}
                                colors={["slate", "rose"]}
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
                                <Typography.Text className={classes.statText}>
                                    <Typography.Text type="secondary">Avg:</Typography.Text>{" "}
                                    {data?.avg_latency
                                        ? `${formatNumber(data.avg_latency)}ms`
                                        : "-"}
                                </Typography.Text>
                            }
                        >
                            <AreaChart
                                {...defaultGraphProps}
                                colors={["slate"]}
                                categories={["latency"]}
                            />
                        </WidgetCard>
                    </Col>
                    <Col span={12}>
                        <WidgetCard
                            title="Cost"
                            leftSubHeading={
                                <Typography.Text className={classes.statText}>
                                    <Typography.Text type="secondary">Total:</Typography.Text>{" "}
                                    {data?.total_cost ? formatCurrency(data.total_cost) : "-"}
                                </Typography.Text>
                            }
                            rightSubHeading={
                                <Typography.Text className={classes.statText}>
                                    <Typography.Text type="secondary">Avg:</Typography.Text>{" "}
                                    {data?.total_cost ? formatCurrency(data.avg_cost) : "-"}
                                </Typography.Text>
                            }
                        >
                            <AreaChart
                                {...defaultGraphProps}
                                colors={["slate"]}
                                categories={["cost"]}
                            />
                        </WidgetCard>
                    </Col>
                    <Col span={12}>
                        <WidgetCard
                            title="Tokens"
                            leftSubHeading={
                                <Typography.Text className={classes.statText}>
                                    <Typography.Text type="secondary">Total:</Typography.Text>{" "}
                                    {data?.total_tokens ? formatNumber(data?.total_tokens) : "-"}
                                </Typography.Text>
                            }
                            rightSubHeading={
                                <Typography.Text className={classes.statText}>
                                    <Typography.Text type="secondary">Avg:</Typography.Text>{" "}
                                    {data?.avg_tokens ? formatNumber(data?.avg_tokens) : "-"}
                                </Typography.Text>
                            }
                        >
                            <AreaChart
                                {...defaultGraphProps}
                                colors={["slate"]}
                                categories={["total_tokens"]}
                            />
                        </WidgetCard>
                    </Col>
                </Row>
            </Spin>
        </div>
    )
}

export default ObservabilityOverview
