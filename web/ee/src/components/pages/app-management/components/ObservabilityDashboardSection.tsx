import {useEffect, useState, type ComponentProps} from "react"

import {AreaChart} from "@tremor/react"
import {Spin, Typography} from "antd"
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
    container: {
        margin: "1.5rem 0",
        display: "flex",
        "& .ant-spin-nested-loading": {
            width: "100%",
        },
    },
    statText: {
        "& span.ant-typography": {
            fontSize: theme.fontSize,
            lineHeight: theme.lineHeight,
            fontWeight: "normal",
            color: theme.colorTextSecondary,
        },
        "& > span": {
            fontWeight: theme.fontWeightMedium,
        },
    },
    widgetContainer: {
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: 16,
        "@media (min-width: 1360px)": {
            gridTemplateColumns: "repeat(4, 1fr)",
        },
        "@media (max-width: 850px)": {
            gridTemplateColumns: "repeat(1, 1fr)",
        },
    },
}))

interface ObservabilityDashboardSectionProps {
    timeRange?: TimeRange
}

const ObservabilityDashboardSection: React.FC<ObservabilityDashboardSectionProps> = ({
    timeRange = "30_days",
}) => {
    const classes = useStyles()
    const appId = useAppId()
    const [loading, setLoading] = useState(false)
    const [data, setData] = useState<GenerationDashboardData>()

    const defaultGraphProps: ComponentProps<typeof AreaChart> = {
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
        <div className={classes.container}>
            <Spin spinning={loading}>
                <div className={classes.widgetContainer}>
                    <div className="flex-1">
                        <WidgetCard
                            title="Requests"
                            leftSubHeading={
                                <div className={classes.statText}>
                                    <Typography.Text>Total:</Typography.Text>{" "}
                                    <span>
                                        {data?.total_count ? formatNumber(data?.total_count) : "-"}
                                    </span>
                                </div>
                            }
                            rightSubHeading={
                                (data?.failure_rate ?? 0) > 0 && (
                                    <div className={classes.statText}>
                                        <Typography.Text>Failed:</Typography.Text>{" "}
                                        <span>
                                            {" "}
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
                    </div>
                    <div className="flex-1">
                        <WidgetCard
                            title="Latency"
                            leftSubHeading={
                                <div className={classes.statText}>
                                    <Typography.Text>Avg:</Typography.Text>{" "}
                                    <span>
                                        {data?.avg_latency
                                            ? `${round(data?.avg_latency ?? 0, 3)}s`
                                            : "-"}
                                    </span>
                                </div>
                            }
                        >
                            <AreaChart {...defaultGraphProps} categories={["latency"]} />
                        </WidgetCard>
                    </div>
                    <div className="flex-1">
                        <WidgetCard
                            title="Cost"
                            leftSubHeading={
                                <div className={classes.statText}>
                                    <Typography.Text>Total:</Typography.Text>{" "}
                                    <span>
                                        {data?.total_cost ? formatCurrency(data.total_cost) : "-"}
                                    </span>
                                </div>
                            }
                            rightSubHeading={
                                <div className={classes.statText}>
                                    <Typography.Text>Avg:</Typography.Text>{" "}
                                    <span>
                                        {data?.total_cost ? formatCurrency(data.avg_cost) : "-"}
                                    </span>
                                </div>
                            }
                        >
                            <AreaChart {...defaultGraphProps} categories={["cost"]} />
                        </WidgetCard>
                    </div>
                    <div className="flex-1">
                        <WidgetCard
                            title="Tokens"
                            leftSubHeading={
                                <div className={classes.statText}>
                                    <Typography.Text>Total:</Typography.Text>{" "}
                                    <span>
                                        {" "}
                                        {data?.total_tokens
                                            ? formatNumber(data?.total_tokens)
                                            : "-"}
                                    </span>
                                </div>
                            }
                            rightSubHeading={
                                <div className={classes.statText}>
                                    <Typography.Text>Avg:</Typography.Text>{" "}
                                    <span>
                                        {" "}
                                        {data?.avg_tokens ? formatNumber(data?.avg_tokens) : "-"}
                                    </span>
                                </div>
                            }
                        >
                            <AreaChart {...defaultGraphProps} categories={["total_tokens"]} />
                        </WidgetCard>
                    </div>
                </div>
            </Spin>
        </div>
    )
}

export default ObservabilityDashboardSection
