import {memo} from "react"

import {useAtomValue} from "jotai"

import {scenarioMetricsMapFamily} from "../../../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import {CellWrapper} from "../CellComponents"

export interface CollapsedMetricsCellProps {
    scenarioId: string
    evaluatorSlug?: string // undefined → include all evaluators
}

const CollapsedMetricsCell = memo<CollapsedMetricsCellProps>(({scenarioId, evaluatorSlug}) => {
    const rowMetrics = useAtomValue(scenarioMetricsMapFamily(scenarioId)) || {}

    const filtered: Record<string, any> = {}
    Object.entries(rowMetrics).forEach(([k, v]) => {
        if (!evaluatorSlug) {
            filtered[k] = v
        } else if (k.startsWith(`${evaluatorSlug}.`)) {
            filtered[k.slice(evaluatorSlug.length + 1)] = v
        }
    })

    return (
        <CellWrapper>
            <pre className="whitespace-pre-wrap text-xs">
                {Object.keys(filtered).length ? JSON.stringify(filtered) : ""}
            </pre>
        </CellWrapper>
    )
})

export default CollapsedMetricsCell
