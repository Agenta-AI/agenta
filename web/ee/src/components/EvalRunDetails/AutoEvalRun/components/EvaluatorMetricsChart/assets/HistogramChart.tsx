import {memo, useMemo} from "react"
import ResponsiveMetricChart from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/ResponsiveMetricChart"
import {buildChartData} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import ResponsiveFrequencyChart from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/ResponsiveFrequencyChart"

const HistogramChart = ({metric}: {metric: Record<string, any>}) => {
    const chartData = useMemo(() => buildChartData(metric), [metric])

    const isCategoricalChart =
        Array.isArray(metric.distribution) ||
        Array.isArray(metric.rank) ||
        Array.isArray(metric.frequency)
    const hasEdge =
        chartData.length > 0 && Object.prototype.hasOwnProperty.call(chartData[0], "edge")

    const frequencyData = useMemo(() => {
        // Only build for categorical/frequency charts without edge
        if (isCategoricalChart && !hasEdge) {
            // buildChartData returns [{ name, value }] but ResponsiveFrequencyChart expects [{ label, count }]
            return buildChartData(metric).map((d) => ({
                label: d.name,
                count: d.value,
            }))
        }
        return []
    }, [metric, isCategoricalChart, hasEdge])

    return (
        <div className="w-full h-full min-h-0 flex flex-col relative overflow-hidden">
            <div className="flex-1 items-end min-h-0 relative *:h-full">
                {metric?.mean ? (
                    <ResponsiveMetricChart
                        chartData={chartData}
                        extraDimensions={metric}
                        direction="vertical"
                        dynamicMargin={{bottom: 40}}
                        disableGradient={true}
                        barColor={"#4096FF"}
                    />
                ) : metric?.unique ? (
                    <ResponsiveFrequencyChart
                        data={frequencyData}
                        direction="vertical"
                        barColor={"#4096FF"}
                        disableGradient={true}
                        dynamicMargin={{bottom: 40}}
                    />
                ) : null}
            </div>
        </div>
    )
}

export default memo(HistogramChart)
