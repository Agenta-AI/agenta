import {
    evaluatorConfigRevisionsQueryStateAtom,
    evaluatorsListQueryAtom,
    humanEvaluatorsListDataAtom,
    workflowLatestRevisionQueryAtomFamily,
} from "@agenta/entities/workflow"
import {getHostQueryClient} from "@agenta/shared/api"
import {atom, useAtomValue} from "jotai"

// A latest-revision request that failed resolves to no revision; the list then cannot tell a
// human evaluator from any other.
const revisionsFailedAtom = atom((get) =>
    (get(evaluatorsListQueryAtom).data?.refs ?? []).some((ref) => {
        if (!ref.id || ref.deleted_at) return false
        const query = get(workflowLatestRevisionQueryAtomFamily(ref.id))
        return !query.isPending && !query.data
    }),
)

/**
 * The project's human evaluators (latest revision flagged as feedback). Reading the list starts one
 * latest-revision request per evaluator, so only the open annotate sheet calls this.
 */
export const useHumanEvaluators = () => {
    const evaluators = useAtomValue(humanEvaluatorsListDataAtom)
    const list = useAtomValue(evaluatorsListQueryAtom)
    const revisionsFailed = useAtomValue(revisionsFailedAtom)
    // Pending until the list and each evaluator's latest revision flags are known, so an empty
    // list is not shown while the flags still load.
    const {isPending} = useAtomValue(evaluatorConfigRevisionsQueryStateAtom)
    const isLoading = isPending && evaluators.length === 0
    return {
        evaluators,
        isLoading,
        isError:
            !isLoading && evaluators.length === 0 && (Boolean(list.isError) || revisionsFailed),
        retry: () => {
            void list.refetch()
            void getHostQueryClient().invalidateQueries({queryKey: ["workflows", "latestRevision"]})
        },
    }
}
