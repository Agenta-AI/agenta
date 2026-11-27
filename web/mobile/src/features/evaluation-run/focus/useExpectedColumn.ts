import {useMemo} from "react"

import {evaluationRunMolecule} from "@agenta/entities/evaluationRun"
import {workflowMolecule} from "@agenta/entities/workflow"
import {atom, useAtomValue} from "jotai"

/**
 * The test case column an evaluator of the run compares the output with (its
 * `correct_answer_key`, for example `correct_answer`). Null when no evaluator names one.
 */
export function useExpectedColumn(runId: string): string | null {
    const keyAtom = useMemo(
        () =>
            atom((get) => {
                const ids = get(evaluationRunMolecule.selectors.evaluatorRevisionIds(runId))
                for (const id of ids) {
                    const parameters = get(workflowMolecule.selectors.data(id))?.data?.parameters
                    const key = parameters?.correct_answer_key
                    if (typeof key === "string" && key) return key
                }
                return null
            }),
        [runId],
    )
    return useAtomValue(keyAtom)
}
