import type {OpenDrawerParams} from "@/oss/state/evaluator/evaluatorDrawerStore"

/**
 * Arguments for the evaluator creation drawer opened from the New Evaluation modal.
 *
 * `isolatedPlayground: true` runs the drawer in its own store. The modal can open on
 * top of a playground that has test cases connected, and a shared store would let the
 * drawer's close cleanup delete those rows.
 */
export const newEvaluationEvaluatorDrawerParams = (
    entityId: string,
    onEvaluatorCreated: ((configId?: string) => void) | undefined,
): OpenDrawerParams => ({
    entityId,
    mode: "create",
    onEvaluatorCreated,
    isolatedPlayground: true,
    // Created inline: stay in this modal instead of opening the new evaluator's page.
    postCreateNavigation: "stay",
})
