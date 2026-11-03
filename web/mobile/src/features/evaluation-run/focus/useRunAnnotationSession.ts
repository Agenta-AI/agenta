import {useCallback, useEffect} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {evaluationRunQueryKey, runLevelMetricsQueryKey} from "@agenta/entities/evaluationRun"
import {projectIdAtom} from "@agenta/shared/state"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom} from "jotai"

import {runScenariosQueryKey} from "../scenarios/useRunScenarios"

/**
 * Opens the run in the annotation controllers while the screen is mounted, so the shared form
 * annotates this run's scenarios, and closes it on leave. `onSaved` reads again what a save
 * changes: the scenario rows, the run status and the run metrics.
 */
export const useRunAnnotationSession = (runId: string) => {
    const openRun = useSetAtom(annotationSessionController.actions.openRun)
    const closeSession = useSetAtom(annotationSessionController.actions.closeSession)
    const clearFormState = useSetAtom(annotationFormController.actions.clearFormState)
    const activeRunId = useAtomValue(annotationSessionController.selectors.activeRunId())
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()

    useEffect(() => {
        openRun({runId})
        return () => {
            closeSession()
            clearFormState()
        }
    }, [runId, openRun, closeSession, clearFormState])

    const onSaved = useCallback(() => {
        for (const queryKey of [
            runScenariosQueryKey(projectId, runId),
            runLevelMetricsQueryKey(projectId, runId),
            evaluationRunQueryKey(runId),
        ]) {
            void queryClient.invalidateQueries({queryKey})
        }
    }, [queryClient, projectId, runId])

    return {isOpen: activeRunId === runId, onSaved}
}
