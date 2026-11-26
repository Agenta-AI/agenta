import {useCallback} from "react"

import {
    editEvaluationRun,
    evaluationRunQueryAtomFamily,
    processNewEvaluatorSteps,
} from "@agenta/entities/evaluationRun"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue} from "jotai"

import {RUNS_LIST_KEY} from "../evaluations/list/runsListKey"

export interface RunEditValues {
    name: string
    description: string
    /** Evaluator revisions to add to the run. */
    addedEvaluatorRevisionIds?: readonly string[]
}

/**
 * The run's saved name and description, and `save`, which changes them and adds evaluators. With
 * new evaluators it then asks the API to run them on every scenario (old results stay), as the
 * old app does. It reloads every query of this run and the runs list. `save` throws when a request
 * fails.
 */
export const useEditEvaluationRun = (projectId: string, runId: string) => {
    const queryClient = useQueryClient()
    const run = useAtomValue(evaluationRunQueryAtomFamily(runId)).data

    // The run, and the new evaluator's columns, cells and metrics: every query keyed by the run.
    const reload = useCallback(
        () =>
            Promise.all([
                queryClient.invalidateQueries({
                    predicate: (query) =>
                        Array.isArray(query.queryKey) && query.queryKey.includes(runId),
                }),
                queryClient.invalidateQueries({queryKey: RUNS_LIST_KEY}),
            ]),
        [queryClient, runId],
    )

    const save = useCallback(
        async ({name, description, addedEvaluatorRevisionIds = []}: RunEditValues) => {
            if (!run) throw new Error("The evaluation is not loaded.")
            await editEvaluationRun({projectId, run, name, description, addedEvaluatorRevisionIds})
            try {
                if (addedEvaluatorRevisionIds.length > 0) {
                    await processNewEvaluatorSteps({projectId, runId})
                }
            } finally {
                // The edit is saved even when the new evaluators could not start: reload anyway.
                await reload()
            }
        },
        [projectId, run, runId, reload],
    )

    return {name: run?.name ?? "", description: run?.description ?? "", save}
}
