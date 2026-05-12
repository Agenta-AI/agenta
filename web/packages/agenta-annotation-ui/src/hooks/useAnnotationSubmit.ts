/**
 * useAnnotationSubmit
 *
 * Thin React hook wrapper around `annotationFormController.actions.submitAnnotations`.
 * All submission logic (create/update annotations, scenario status, cache invalidation)
 * lives in `@agenta/annotation`.
 *
 * @packageDocumentation
 */

import {useCallback} from "react"

import {annotationFormController} from "@agenta/annotation"
import {useAtomValue, useSetAtom} from "jotai"

// ============================================================================
// TYPES
// ============================================================================

interface UseAnnotationSubmitProps {
    /** Current scenario ID */
    scenarioId: string
    /** Queue ID for cache invalidation */
    queueId: string
}

interface SubmitOptions {
    /** Whether to also update the scenario status to "success" */
    markComplete?: boolean
}

interface UseAnnotationSubmitResult {
    /** Whether a submission is currently in progress */
    isSubmitting: boolean
    /** Submit annotations (and optionally mark complete) */
    submitAnnotations: (options?: SubmitOptions) => Promise<void>
}

// ============================================================================
// HOOK
// ============================================================================

export function useAnnotationSubmit({
    scenarioId,
    queueId,
}: UseAnnotationSubmitProps): UseAnnotationSubmitResult {
    const isSubmitting = useAtomValue(annotationFormController.selectors.isSubmitting(scenarioId))
    const submit = useSetAtom(annotationFormController.actions.submitAnnotations)

    const submitAnnotations = useCallback(
        async (options?: SubmitOptions) => {
            await submit({
                scenarioId,
                queueId,
                markComplete: options?.markComplete,
            })
        },
        [submit, scenarioId, queueId],
    )

    return {isSubmitting, submitAnnotations}
}
