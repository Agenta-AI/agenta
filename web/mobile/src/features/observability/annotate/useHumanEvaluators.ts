import {
    evaluatorConfigRevisionsQueryStateAtom,
    evaluatorsListQueryAtom,
    humanEvaluatorsListDataAtom,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/**
 * The project's human evaluators (latest revision flagged as feedback). Reading the list starts one
 * latest-revision request per evaluator, so only the open annotate sheet calls this.
 */
export const useHumanEvaluators = () => {
    const evaluators = useAtomValue(humanEvaluatorsListDataAtom)
    const list = useAtomValue(evaluatorsListQueryAtom)
    // Pending until the list and each evaluator's latest revision flags are known, so an empty
    // list is not shown while the flags still load.
    const {isPending} = useAtomValue(evaluatorConfigRevisionsQueryStateAtom)
    return {
        evaluators,
        isLoading: isPending && evaluators.length === 0,
        isError: Boolean(list.isError) && evaluators.length === 0,
        retry: () => void list.refetch(),
    }
}
