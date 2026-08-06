import {atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {
    deriveEvaluationKind,
    type EvaluationRunKind,
} from "@/oss/lib/evaluations/utils/evaluationKind"

import {evaluationRunQueryAtomFamily} from "../atoms/table/run"

export type PreviewEvaluationType = "auto" | "human" | "online" | null

/**
 * Base atom for storing the evaluation type.
 * This can be set explicitly from the page props, but prefer using
 * `derivedEvalTypeAtomFamily` which derives the type from run.data.steps.
 */
export const previewEvalTypeAtom = atom<PreviewEvaluationType>(null)

/**
 * Derived atom that computes the evaluation type from run.data.steps.
 * This is the reliable source of truth - do NOT use meta.evaluation_kind.
 *
 * Priority:
 * 1. Derive from run.data.steps (most reliable)
 * 2. Fall back to previewEvalTypeAtom if run data not available
 */
export const derivedEvalTypeAtomFamily = atomFamily((runId: string | null) =>
    atom((get): EvaluationRunKind | null => {
        if (!runId) {
            return get(previewEvalTypeAtom)
        }

        const runQuery = get(evaluationRunQueryAtomFamily(runId))
        const rawRun = runQuery?.data?.rawRun

        if (rawRun) {
            return deriveEvaluationKind(rawRun)
        }

        // Fall back to the explicit atom value if run data not loaded yet
        return get(previewEvalTypeAtom)
    }),
)
