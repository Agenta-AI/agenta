import {useCallback, useEffect} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {
    evaluationRunQueryKey,
    runLevelMetricsQueryKey,
    runScenarioMetricsQueryKey,
} from "@agenta/entities/evaluationRun"
import {traceSpanMolecule} from "@agenta/entities/trace"
import {projectIdAtom} from "@agenta/shared/state"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"

import {runScenariosQueryKey} from "../scenarios/useRunScenarios"

/**
 * What a save in a run changes, read again: the scenario rows, the run status, the run metrics
 * (run-level and per test case), and the replaced annotation traces, which the rows read a text
 * value from and would otherwise keep from before the save. The run's queue passes it as the
 * form's `onSaved` too.
 */
export const useRunAnnotationRefresh = (runId: string) => {
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()

    return useCallback(
        ({replacedTraceIds}: {replacedTraceIds: string[]}) => {
            traceSpanMolecule.actions.evictByIds({projectId, traceIds: replacedTraceIds})
            if (!runId) return
            for (const queryKey of [
                runScenariosQueryKey(projectId, runId),
                runLevelMetricsQueryKey(projectId, runId),
                runScenarioMetricsQueryKey(projectId, runId),
                evaluationRunQueryKey(runId),
            ]) {
                void queryClient.invalidateQueries({queryKey})
            }
        },
        [queryClient, projectId, runId],
    )
}

/**
 * Opens the run in the annotation controllers while the screen is mounted, so the shared form
 * annotates this run's scenarios, and closes it on leave. `onSaved` is `useRunAnnotationRefresh`.
 */
export const useRunAnnotationSession = (runId: string) => {
    const openRun = useSetAtom(annotationSessionController.actions.openRun)
    const closeSession = useSetAtom(annotationSessionController.actions.closeSession)
    const clearFormState = useSetAtom(annotationFormController.actions.clearFormState)
    const activeRunId = useAtomValue(annotationSessionController.selectors.activeRunId())
    const onSaved = useRunAnnotationRefresh(runId)

    useEffect(() => {
        openRun({runId})
        return () => {
            closeSession()
            clearFormState()
        }
    }, [runId, openRun, closeSession, clearFormState])

    return {isOpen: activeRunId === runId, onSaved}
}
