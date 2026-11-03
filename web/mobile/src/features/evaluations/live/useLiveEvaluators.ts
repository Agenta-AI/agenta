import {useMemo} from "react"

import {selectLiveEvaluators} from "@agenta/entities/evaluationRun"
import {
    evaluatorConfigRevisionsQueryStateAtom,
    evaluatorsListQueryAtom,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/**
 * The evaluators a live evaluation can run: the latest revision of each online capable,
 * non-human evaluator. Reading it fans out one revision request per evaluator, so only the
 * open sheet calls it.
 */
export const useLiveEvaluators = () => {
    const state = useAtomValue(evaluatorConfigRevisionsQueryStateAtom)
    const list = useAtomValue(evaluatorsListQueryAtom)
    const evaluators = useMemo(() => selectLiveEvaluators(state.data), [state.data])

    return {
        evaluators,
        isPending: state.isPending,
        isError: state.isError,
        retry: () => void list.refetch(),
    }
}
