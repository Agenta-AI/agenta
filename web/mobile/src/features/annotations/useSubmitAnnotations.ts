import {useCallback} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom, useStore} from "jotai"

/** The one failure text a reader sees; the cause goes to the console. */
export const SUBMIT_FAILURE_TEXT = "Couldn't save the annotations"

/** Where the annotations go: a queue's item, or a scenario of an evaluation run. */
export type AnnotationScope = {queueId: string} | {runId: string}

/**
 * Runs after a save, for the screen to read again what the save changed. It gets the traces of the
 * annotations the save replaced, read before the save, since the screen may close meanwhile.
 */
export type OnAnnotationsSaved = (saved: {scenarioId: string; replacedTraceIds: string[]}) => void

/**
 * Saves one scenario's annotations. In a queue, a first save marks the scenario completed ("Mark
 * completed") and a save on a completed scenario updates it ("Update"). In a run, every save is
 * "Annotate" and needs a change. Every entry point (the footer, the keyboard, the annotate sheets)
 * shares these rules and these messages.
 */
export const useSubmitAnnotations = (
    scenarioId: string,
    scope: AnnotationScope,
    onSaved?: OnAnnotationsSaved,
) => {
    const queueId = "queueId" in scope ? scope.queueId : undefined
    const runId = "runId" in scope ? scope.runId : undefined
    const statuses = useAtomValue(annotationSessionController.selectors.scenarioStatuses())
    const isCompleted = Boolean(queueId) && statuses[scenarioId] === "success"
    const isSubmitting = useAtomValue(annotationFormController.selectors.isSubmitting(scenarioId))
    const hasFilledMetrics = useAtomValue(
        annotationFormController.selectors.hasFilledMetrics(scenarioId),
    )
    const hasPendingChanges = useAtomValue(
        annotationFormController.selectors.hasPendingChanges(scenarioId),
    )
    const submitAnnotations = useSetAtom(annotationFormController.actions.submitAnnotations)
    const store = useStore()

    // A queue's new item needs one value; a completed item, or any run scenario, needs a change.
    const canSubmit =
        Boolean(scenarioId) &&
        !isSubmitting &&
        (runId
            ? hasPendingChanges && hasFilledMetrics
            : isCompleted
              ? hasPendingChanges
              : hasFilledMetrics)

    const submit = useCallback(async () => {
        if (!scenarioId) return
        const replacedTraceIds = store
            .get(annotationSessionController.selectors.scenarioAnnotations(scenarioId))
            .map((annotation) => annotation.trace_id)
        try {
            await submitAnnotations({
                scenarioId,
                queueId,
                // Always true in a run (no completed state there): each save sets the scenario
                // to success and checks whether the run is done.
                markComplete: !isCompleted,
            })
        } catch (cause) {
            console.error("Saving the annotations failed", cause)
            message.error(SUBMIT_FAILURE_TEXT)
            return
        }
        message.success(
            runId
                ? "Annotations saved successfully"
                : isCompleted
                  ? "Updated feedback"
                  : "Scenario completed",
        )
        onSaved?.({scenarioId, replacedTraceIds})
    }, [store, submitAnnotations, scenarioId, queueId, runId, isCompleted, onSaved])

    return {
        submit,
        canSubmit,
        isSubmitting,
        isCompleted,
        hasPendingChanges,
        label: runId ? "Annotate" : isCompleted ? "Update" : "Mark completed",
    }
}
