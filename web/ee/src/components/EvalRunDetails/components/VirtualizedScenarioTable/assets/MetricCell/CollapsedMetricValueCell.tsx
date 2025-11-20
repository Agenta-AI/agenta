import {memo} from "react"

import {useAtomValue} from "jotai"

import {formatMetricValue} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover/assets/utils"
import LabelValuePill from "@/oss/components/ui/LabelValuePill"
import {scenarioMetricMapFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms/runMetricsCache"

import {CellWrapper} from "../CellComponents"

export interface CollapsedMetricValueCellProps {
    scenarioId: string
    evaluatorSlug?: string // undefined → include all evaluators
}

const CollapsedMetricValueCell = memo<CollapsedMetricValueCellProps>(
    ({scenarioId, evaluatorSlug}) => {
        const rowMetrics = useAtomValue(scenarioMetricMapFamily(scenarioId)) || {}

        const filtered: Record<string, any> = {}
        Object.entries(rowMetrics).forEach(([k, v]) => {
            if (evaluatorSlug) {
                if (k.startsWith(`${evaluatorSlug}.`)) {
                    filtered[k.slice(evaluatorSlug.length + 1)] = v
                }
            } else {
                if (!k.includes(".")) {
                    filtered[k] = v
                }
            }
        })

        if (!Object.keys(filtered).length) {
            return (
                <CellWrapper>
                    <span className="text-gray-500">–</span>
                </CellWrapper>
            )
        }

        const grouped: Record<string, Record<string, any>> = {}
        Object.entries(filtered).forEach(([k, v]) => {
            const [slug, metricName] = evaluatorSlug ? ["", k] : k.split(".", 2)
            const keySlug = evaluatorSlug || slug || "unknown"
            if (!grouped[keySlug]) grouped[keySlug] = {}
            grouped[keySlug][metricName || k] = v
        })

        return (
            <CellWrapper>
                <div className="flex flex-col items-start gap-1 max-w-[450px] overflow-x-auto [&::-webkit-scrollbar]:!w-0">
                    {Object.entries(grouped).map(([slug, metrics], idx) => (
                        <>
                            {Object.entries(metrics).map(([name, val]) => (
                                <LabelValuePill
                                    key={name}
                                    label={name}
                                    value={formatMetricValue(name, val)}
                                    className="!min-w-0 [&_div:first-child]:!min-w-0 [&_div:first-child]:w-fit"
                                />
                            ))}
                        </>
                    ))}
                </div>
            </CellWrapper>
        )
    },
)

export default CollapsedMetricValueCell
