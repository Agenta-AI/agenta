import {useCallback} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"

/** The one failure text a reader sees; the cause goes to the console. */
export const SUBMIT_FAILURE_TEXT = "Couldn't save the annotations"

/**
 * Saves one scenario's annotations. A first save marks the scenario completed ("Mark completed");
 * a save on a completed scenario updates it ("Update"). Every entry point (the footer, the
 * keyboard, the annotate sheet) shares these rules and these messages.
 */
export const useSubmitAnnotations = (scenarioId: string, queueId: string) => {
    const statuses = useAtomValue(annotationSessionController.selectors.scenarioStatuses())
    const isCompleted = statuses[scenarioId] === "success"
    const isSubmitting = useAtomValue(annotationFormController.selectors.isSubmitting(scenarioId))
    const hasFilledMetrics = useAtomValue(
        annotationFormController.selectors.hasFilledMetrics(scenarioId),
    )
    const hasPendingChanges = useAtomValue(
        annotationFormController.selectors.hasPendingChanges(scenarioId),
    )
    const submitAnnotations = useSetAtom(annotationFormController.actions.submitAnnotations)

    // A completed scenario saves only a change; a new one needs at least one value.
    const canSubmit =
        Boolean(scenarioId) && !isSubmitting && (isCompleted ? hasPendingChanges : hasFilledMetrics)

    const submit = useCallback(async () => {
        if (!scenarioId) return
        try {
            await submitAnnotations({scenarioId, queueId, markComplete: !isCompleted})
            message.success(isCompleted ? "Updated feedback" : "Scenario completed")
        } catch (cause) {
            console.error("Saving the annotations failed", cause)
            message.error(SUBMIT_FAILURE_TEXT)
        }
    }, [submitAnnotations, scenarioId, queueId, isCompleted])

    return {
        submit,
        canSubmit,
        isSubmitting,
        isCompleted,
        hasPendingChanges,
        label: isCompleted ? "Update" : "Mark completed",
    }
}
