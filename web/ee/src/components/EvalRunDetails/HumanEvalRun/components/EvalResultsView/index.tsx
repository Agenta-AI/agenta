import {memo, useCallback, useMemo} from "react"

import deepEqual from "fast-deep-equal"
import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"

import {evaluationEvaluatorsAtom} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"

import EvaluatorMetricsCard from "./EvaluatorMetricsCard"

/**
 * Displays run-level evaluation results grouped by evaluator.
 * Uses selectAtom to subscribe only to the evaluator *list shape* (slug array) so the
 * parent component re-renders only when evaluators are added/removed – any metric changes
 * are handled inside each card.
 */
const EvalResultsView = ({runId}: {runId: string}) => {
    const slugSelector = useCallback(
        (list: any[] | undefined): string[] =>
            (list || []).map((ev) => ev.slug || ev.id || ev.name),
        [],
    )

    const slugsAtom = useMemo(
        () => selectAtom(evaluationEvaluatorsAtom, slugSelector, deepEqual),
        [],
    )
    const evaluatorSlugs = useAtomValue(slugsAtom)

    return (
        <section className="flex flex-wrap gap-2 overflow-y-auto p-1">
            {evaluatorSlugs.map((slug) => (
                <EvaluatorMetricsCard key={slug} runId={runId} evaluatorSlug={slug} />
            ))}
        </section>
    )
}

export default memo(EvalResultsView)
