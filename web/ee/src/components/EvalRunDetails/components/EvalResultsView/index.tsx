import {memo, useCallback, useMemo} from "react"

import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {useRunId} from "@/oss/contexts/RunIdContext"
import {
    evalAtomStore,
    evaluationRunStateFamily,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import {runMetricsFamily} from "../../../../lib/hooks/useEvaluationRunData/assets/atoms/runScopedMetrics"
import EvaluatorMetricsCard from "../../HumanEvalRun/components/EvalResultsView/EvaluatorMetricsCard"

interface EvalResultsViewProps {
    runId: string
}

const EvalResultsView = ({runId}: EvalResultsViewProps) => {
    // Use proper runId fallback logic: prop takes priority over context
    const contextRunId = useRunId()
    const effectiveRunId = runId || contextRunId
    const store = evalAtomStore()

    // Use the same selector pattern as ScenarioAnnotationPanel
    const evaluatorsSelector = useCallback((state: any): string[] => {
        const evaluators = state?.enrichedRun?.evaluators
        if (!evaluators) return []

        // Handle both array and object formats
        const evaluatorsList = Array.isArray(evaluators) ? evaluators : Object.values(evaluators)

        return evaluatorsList.map((ev: any) => ev.slug || ev.id || ev.name)
    }, [])

    const evaluatorsAtom = useMemo(
        () => selectAtom(evaluationRunStateFamily(effectiveRunId), evaluatorsSelector, deepEqual),
        [effectiveRunId, evaluatorsSelector],
    )
    const evaluatorSlugs = useAtomValue(evaluatorsAtom, {store})

    // Force subscription to runMetricsFamily to trigger metrics fetch
    useAtomValue(runMetricsFamily(effectiveRunId), {store})

    // Debug: Check what's in the evaluation run state
    const evaluationRunState = useAtomValue(evaluationRunStateFamily(effectiveRunId), {store})

    // Show loading state if enriched run data is not available yet
    if (!evaluationRunState?.enrichedRun) {
        return (
            <section className="flex flex-wrap gap-2 overflow-y-auto p-1">
                <div className="text-center text-gray-500 w-full p-8">
                    Loading evaluation results...
                </div>
            </section>
        )
    }

    // Show message if no evaluators are found
    if (evaluatorSlugs.length === 0) {
        return (
            <section className="flex flex-wrap gap-2 overflow-y-auto p-1">
                <div className="text-center text-gray-500 w-full p-8">
                    No evaluators found for this evaluation run.
                </div>
            </section>
        )
    }

    return (
        <section className="flex flex-wrap gap-2 overflow-y-auto p-1">
            {evaluatorSlugs.map((slug) => (
                <EvaluatorMetricsCard key={slug} runId={effectiveRunId} evaluatorSlug={slug} />
            ))}
        </section>
    )
}

export default memo(EvalResultsView)
