import {memo} from "react"

import {traceAnnotationInfoAtomFamily} from "@agenta/observability"
import {useAtomValue} from "jotai"

import {LabelValuePill} from "../primitives/LabelValuePill"

const booleanValueColorClass = (value: boolean): string =>
    value ? "text-green-7 dark:text-[var(--ant-green-7)]" : "text-orange-6"

interface Props {
    invocationKey: string
    evaluatorSlug: string
    /**
     * Resolved evaluator name. The lookup (`useEvaluatorReference`) pulls in a
     * 721-LOC reference-atom subtree that has no business in a cell, so the host
     * resolves it and passes the label down. Falls back to the slug.
     */
    displayName?: string
}

export const EvaluatorMetricsCell = memo(({invocationKey, evaluatorSlug, displayName}: Props) => {
    const {aggregatedEvaluatorMetrics} = useAtomValue(traceAnnotationInfoAtomFamily(invocationKey))
    const metrics = aggregatedEvaluatorMetrics?.[evaluatorSlug]
    const label = displayName ?? evaluatorSlug

    if (!metrics) {
        return <span className="text-gray-500">–</span>
    }

    const metricCount = Object.keys(metrics).length

    return (
        <div className="flex flex-col gap-[6px]">
            <div className="flex items-center justify-between">
                <span className="text-[12px]">{label}</span>
                <span className="text-[12px] text-colorTextSecondary">
                    {metricCount} {metricCount === 1 ? "metric" : "metrics"}
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
