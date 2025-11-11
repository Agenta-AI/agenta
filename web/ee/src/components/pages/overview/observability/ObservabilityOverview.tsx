import {useEffect, useState} from "react"

import {AreaChart} from "@tremor/react"
import {Col, Row, Spin, Typography} from "antd"
import round from "lodash/round"
import {createUseStyles} from "react-jss"

import type {TimeRange} from "@/oss/components/TimeFilter"
import {useAppId} from "@/oss/hooks/useAppId"
import {formatCurrency, formatNumber} from "@/oss/lib/helpers/formatters"
import {JSSTheme} from "@/oss/lib/Types"
import {GenerationDashboardData} from "@/oss/lib/types_ee"
import {fetchGenerationsDashboardData} from "@/oss/services/observability/api"

import WidgetCard from "../../observability/dashboard/widgetCard"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    statText: {
        fontWeight: 400,
    },
}))

interface ObservabilityOverviewProps {
    timeRange?: TimeRange
}

const ObservabilityOverview: React.FC<ObservabilityOverviewProps> = ({timeRange = "30_days"}) => {
    const classes = useStyles()
    const appId = useAppId()
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<GenerationDashboardData>()

    const defaultGraphProps: React.ComponentProps<typeof AreaChart> = {
        className: "h-[168px] p-0",
        colors: ["blue-400", "red"],
        connectNulls: true,
        tickGap: 15,
        curveType: "linear",
        showGridLines: false,
        showLegend: false,
        index: "timestamp",
        data: data?.data?.length ? data.data : [{}],
        categories: [],
    }

    useEffect(() => {
        setLoading(true)
        fetchGenerationsDashboardData(appId, {range: timeRange})
            .then((data) => {
                setData(data)
            })
            .catch(console.error)
            .finally(() => setLoading(false))
    }, [appId, timeRange])

    return (
        <div>
            <Spin spinning={loading}>
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
                                        ? `${round(data?.avg_latency ?? 0, 3)}s`
                                        : "-"}
                                </Typography.Text>
                            }
                        >
                            <AreaChart {...defaultGraphProps} categories={["latency"]} />
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
                            <AreaChart {...defaultGraphProps} categories={["cost"]} />
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
                            <AreaChart {...defaultGraphProps} categories={["total_tokens"]} />
                        </WidgetCard>
                    </Col>
                </Row>
            </Spin>
        </div>
    )
}

export default ObservabilityOverview
