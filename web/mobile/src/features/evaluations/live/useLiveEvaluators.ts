import {useMemo} from "react"

import {selectLiveEvaluators} from "@agenta/entities/evaluationRun"
import {
    evaluatorConfigRevisionsQueryStateAtom,
    evaluatorsListQueryAtom,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/**
 * The evaluators a live evaluation can run: the latest revision of each online capable,
 * non-human evaluator, named after the evaluator. Reading it fans out one revision request per evaluator, so only the
 * open sheet calls it.
 */
export const useLiveEvaluators = () => {
    const state = useAtomValue(evaluatorConfigRevisionsQueryStateAtom)
    const list = useAtomValue(evaluatorsListQueryAtom)
    const evaluators = useMemo(() => {
        // A revision can carry its own name (often "default"); the user knows the evaluator's name.
        const names = new Map((list.data?.refs ?? []).map((ref) => [ref.id, ref.name]))
        return selectLiveEvaluators(state.data).map((revision) => ({
            ...revision,
            name: (revision.workflow_id && names.get(revision.workflow_id)) || revision.name,
        }))
    }, [list.data, state.data])

    return {
        evaluators,
        isPending: state.isPending,
        isError: state.isError,
        /** Loaded, and no evaluator can run live. */
        noneSupported: !state.isPending && evaluators.length === 0,
        retry: () => void list.refetch(),
    }
}
