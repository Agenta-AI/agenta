import {memo} from "react"

import {useAtomValue} from "jotai"

import LabelValuePill from "@/oss/components/CustomUIs/LabelValuePill"
import useEvaluatorReference from "@/oss/components/References/hooks/useEvaluatorReference"
import {booleanValueColorClass} from "@/oss/lib/helpers/colors"
import {traceAnnotationInfoAtomFamily} from "@/oss/state/newObservability"
import {useProjectData} from "@/oss/state/project"

interface Props {
    invocationKey: string
    evaluatorSlug: string
}

const EvaluatorMetricsCell = memo(({invocationKey, evaluatorSlug}: Props) => {
    const {aggregatedEvaluatorMetrics} = useAtomValue(traceAnnotationInfoAtomFamily(invocationKey))
    const metrics = aggregatedEvaluatorMetrics?.[evaluatorSlug]

    const {projectId} = useProjectData()
    const {reference} = useEvaluatorReference({
        projectId: projectId ?? null,
        evaluatorSlug,
    })
    const displayName = reference?.name ?? evaluatorSlug

    if (!metrics) {
        return <span className="text-gray-500">–</span>
    }

    return (
        <div className="flex flex-col gap-[6px]">
            <div className="flex items-center justify-between">
                <span className="text-[10px]">{displayName}</span>
                <span className="text-[10px] text-muted-foreground">
                    {Object.keys(metrics).length}{" "}
                    {Object.keys(metrics).length === 1 ? "metric" : "metrics"}
                </span>
            </div>
            <div className="flex items-center gap-2 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                {Object.entries(metrics).map(([metricName, rawData]) => {
                    const data = rawData as {average?: number; latest?: boolean}
                    const isBoolean = data.latest !== undefined
                    const value = isBoolean ? (data.latest ? "True" : "False") : `μ ${data.average}`
                    return (
                        <LabelValuePill
                            key={metricName}
                            label={metricName}
                            value={value}
                            valueClassName={
                                isBoolean
                                    ? booleanValueColorClass(data.latest as boolean)
                                    : undefined
                            }
                            className="!min-w-fit"
                        />
                    )
                })}
            </div>
        </div>
    )
})

export default EvaluatorMetricsCell
