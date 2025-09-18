import {memo} from "react"

import {Typography} from "antd"
import {useAtomValue} from "jotai"

import LabelValuePill from "@/oss/components/ui/LabelValuePill"
import {traceAnnotationInfoAtomFamily} from "@/oss/state/newObservability"

interface Props {
    invocationKey: string
    evaluatorSlug: string
}

const EvaluatorMetricsCell = memo(({invocationKey, evaluatorSlug}: Props) => {
    const {aggregatedEvaluatorMetrics} = useAtomValue(traceAnnotationInfoAtomFamily(invocationKey))
    const metrics = aggregatedEvaluatorMetrics?.[evaluatorSlug]

    if (!metrics) {
        return <span className="text-gray-500">–</span>
    }

    return (
        <div className="flex flex-col gap-[6px]">
            <div className="flex items-center justify-between">
                <Typography.Text className="text-[10px]">{evaluatorSlug}</Typography.Text>
                <Typography.Text className="text-[10px]" type="secondary">
                    {Object.keys(metrics).length}{" "}
                    {Object.keys(metrics).length === 1 ? "metric" : "metrics"}
                </Typography.Text>
            </div>
            <div className="flex items-center gap-2 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                {Object.entries(metrics).map(([metricName, rawData]) => {
                    const data = rawData as {average?: number}
                    return (
                        <LabelValuePill
                            key={metricName}
                            label={metricName}
                            value={`μ ${data.average}`}
                            className="!min-w-fit"
                        />
                    )
                })}
            </div>
        </div>
    )
})

export default EvaluatorMetricsCell
