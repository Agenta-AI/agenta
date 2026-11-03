import {useCallback, useEffect} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {evaluationRunQueryKey, runLevelMetricsQueryKey} from "@agenta/entities/evaluationRun"
import {traceSpanMolecule} from "@agenta/entities/trace"
import {projectIdAtom} from "@agenta/shared/state"
import {useQueryClient} from "@tanstack/react-query"
import {useAtomValue, useSetAtom, useStore} from "jotai"

import {runScenariosQueryKey} from "../scenarios/useRunScenarios"

/**
 * Opens the run in the annotation controllers while the screen is mounted, so the shared form
 * annotates this run's scenarios, and closes it on leave. `onSaved` reads again what a save
 * changes: the scenario rows, the run status, the run metrics, and the scenario's annotation
 * traces, which the rows read a text value from and would otherwise keep from before the save.
 */
export const useRunAnnotationSession = (runId: string) => {
    const openRun = useSetAtom(annotationSessionController.actions.openRun)
    const closeSession = useSetAtom(annotationSessionController.actions.closeSession)
    const clearFormState = useSetAtom(annotationFormController.actions.clearFormState)
    const activeRunId = useAtomValue(annotationSessionController.selectors.activeRunId())
    const projectId = useAtomValue(projectIdAtom) ?? ""
    const queryClient = useQueryClient()
    const store = useStore()

    useEffect(() => {
        openRun({runId})
        return () => {
            closeSession()
            clearFormState()
        }
    }, [runId, openRun, closeSession, clearFormState])

    const onSaved = useCallback(
        (scenarioId: string) => {
            const annotations = store.get(
                annotationSessionController.selectors.scenarioAnnotations(scenarioId),
            )
            traceSpanMolecule.actions.evictByIds({
                projectId,
                traceIds: annotations.map((annotation) => annotation.trace_id),
            })
            for (const queryKey of [
                runScenariosQueryKey(projectId, runId),
                runLevelMetricsQueryKey(projectId, runId),
                evaluationRunQueryKey(runId),
            ]) {
                void queryClient.invalidateQueries({queryKey})
            }
        },
        [store, queryClient, projectId, runId],
    )

    return {isOpen: activeRunId === runId, onSaved}
}
