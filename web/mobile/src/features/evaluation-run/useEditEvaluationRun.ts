import {useCallback} from "react"

import {
    editEvaluationRun,
    evaluationRunQueryAtomFamily,
    evaluationRunQueryKey,
} from "@agenta/entities/evaluationRun"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {RUNS_LIST_KEY} from "../evaluations/list/runsListKey"

/**
 * The run's saved name and description, and `save`, which changes them and then reloads the run
 * and the runs list so both show the new name. `save` throws when the request fails.
 */
export const useEditEvaluationRun = (projectId: string, runId: string) => {
    const queryClient = useQueryClient()
    const run = useAtomValue(evaluationRunQueryAtomFamily(runId)).data

    const save = useCallback(
        async ({name, description}: {name: string; description: string}) => {
            if (!run) throw new Error("The evaluation is not loaded.")
            await editEvaluationRun({projectId, run, name, description})
            await Promise.all([
                queryClient.invalidateQueries({queryKey: evaluationRunQueryKey(runId)}),
                queryClient.invalidateQueries({queryKey: RUNS_LIST_KEY}),
            ])
        },
        [projectId, queryClient, run, runId],
    )

    return {name: run?.name ?? "", description: run?.description ?? "", save}
}
