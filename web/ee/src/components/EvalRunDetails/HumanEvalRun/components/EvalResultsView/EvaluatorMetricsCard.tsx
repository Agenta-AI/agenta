import {memo, useCallback, useMemo} from "react"

import {Card, Typography} from "antd"
import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {MetricDetailsPopoverWrapper} from "@/oss/components/HumanEvaluations/assets/MetricDetailsPopover"
import {useRunId} from "@/oss/contexts/RunIdContext"
import {
    evalAtomStore,
    evaluationRunStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

interface EvaluatorMetricsCardProps {
    runId: string
    evaluatorSlug: string
}

/**
 * Displays all metric definitions for a single evaluator with popovers.
 * Uses jotai selectAtom so only this card re-renders when its evaluator object changes.
 */
const EvaluatorMetricsCard = ({runId, evaluatorSlug}: EvaluatorMetricsCardProps) => {
    // Use proper runId fallback logic: prop takes priority over context
    const contextRunId = useRunId()
    const effectiveRunId = runId || contextRunId
    const store = evalAtomStore()

    // Create a selector to extract the specific evaluator from the evaluation run state
    const evaluatorSelector = useCallback(
        (state: any) => {
            const evaluators = state?.enrichedRun?.evaluators
            if (!evaluators) return null

            // Handle both array and object formats
            if (Array.isArray(evaluators)) {
                return evaluators.find((ev: any) => ev.slug === evaluatorSlug)
            } else {
                return Object.values(evaluators).find((ev: any) => ev.slug === evaluatorSlug)
            }
        },
        [evaluatorSlug],
    )

    const evaluatorAtom = useMemo(
        () => selectAtom(evaluationRunStateFamily(effectiveRunId), evaluatorSelector, deepEqual),
        [effectiveRunId, evaluatorSelector],
    )

    const evaluator = useAtomValue(evaluatorAtom, {store})

    if (!evaluator) return null

    const metricEntries = Object.entries(evaluator.metrics || {})

    return (
        <Card key={evaluatorSlug} className="w-[400px] shrink-0" classNames={{body: "!p-3"}}>
            <Typography.Text type="secondary">{evaluator.name}</Typography.Text>
            <div className="w-full flex flex-col gap-2 mt-2">
                {metricEntries.map(([metricKey, def]) => (
                    <div
                        key={metricKey}
                        className="w-full flex items-center justify-between border border-solid border-gray-200 px-2 py-1.5 rounded-lg hover:scale-[1.02] hover:shadow-sm transition-all"
                    >
                        <Typography.Text className="text-nowrap mr-10">{metricKey}</Typography.Text>
                        <MetricDetailsPopoverWrapper
                            runId={effectiveRunId}
                            evaluatorSlug={evaluator.slug}
                            evaluatorMetricKey={metricKey}
                            metricType={(def as any)?.type}
                            className="justify-end [&_.ant-space]:!justify-end"
                        />
                    </div>
                ))}
            </div>
        </Card>
    )
}

export default memo(EvaluatorMetricsCard)
