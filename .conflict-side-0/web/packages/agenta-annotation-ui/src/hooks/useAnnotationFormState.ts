/**
 * useAnnotationFormState
 *
 * Thin React hook wrapper around `annotationFormController`.
 * Wires controller atoms to React component lifecycle.
 *
 * All form state logic (schema resolution, baseline computation, edit tracking)
 * lives in `@agenta/annotation` — this hook just provides React bindings.
 *
 * Workflow IDs are derived from the session controller automatically —
 * no manual injection needed.
 *
 * @packageDocumentation
 */

import {useCallback, useEffect} from "react"

import {annotationFormController} from "@agenta/annotation"
import type {AnnotationMetrics, EvaluatorResolutionState} from "@agenta/annotation"
import type {Annotation} from "@agenta/entities/annotation"
import type {Workflow} from "@agenta/entities/workflow"
import {useAtomValue, useSetAtom} from "jotai"

export type {AnnotationMetricField, AnnotationMetrics} from "@agenta/annotation"

// ============================================================================
// TYPES
// ============================================================================

interface UseAnnotationFormStateProps {
    /** Current scenario ID (used to scope form state) */
    scenarioId: string
    /** Existing annotations for the current scenario's trace/span */
    annotations: Annotation[]
    /** Trace ID for the current scenario */
    traceId?: string
    /** Span ID for the current scenario */
    spanId?: string
    /** Testcase ID for testcase-based queues (no trace_id needed) */
    testcaseId?: string
}

interface UseAnnotationFormStateResult {
    /** Merged metrics (baseline + edits) */
    metrics: AnnotationMetrics
    /** Resolved evaluator entities */
    evaluators: Workflow[]
    /** Evaluator schema resolution state */
    evaluatorResolution: EvaluatorResolutionState
    /** Whether there are unsaved changes */
    hasPendingChanges: boolean
    /** Update a single metric field */
    updateMetric: (params: {slug: string; fieldKey: string; value: unknown}) => void
    /** Reset all pending edits */
    resetEdits: () => void
}

// ============================================================================
// HOOK
// ============================================================================

/**
 * React hook that wires `annotationFormController` to component lifecycle.
 *
 * Sets scenario context into the controller on mount/change,
 * then reads derived state (metrics, pending changes, evaluators) via selectors.
 *
 * Evaluator revision refs are derived from the session controller inside the
 * form controller, so the form resolves the queue's pinned evaluator schemas
 * without any UI-side fetch wiring.
 */
export function useAnnotationFormState({
    scenarioId,
    annotations,
    traceId = "",
    spanId = "",
    testcaseId,
}: UseAnnotationFormStateProps): UseAnnotationFormStateResult {
    const setScenarioContext = useSetAtom(annotationFormController.actions.setScenarioContext)
    const updateMetricAction = useSetAtom(annotationFormController.actions.updateMetric)
    const resetEditsAction = useSetAtom(annotationFormController.actions.resetEdits)

    // Sync scenario context into controller
    useEffect(() => {
        if (!scenarioId) return
        setScenarioContext({scenarioId, annotations, traceId, spanId, testcaseId})
    }, [setScenarioContext, scenarioId, annotations, traceId, spanId, testcaseId])

    // Read from controller selectors
    const metrics = useAtomValue(annotationFormController.selectors.effectiveMetrics(scenarioId))
    const hasPendingChanges = useAtomValue(
        annotationFormController.selectors.hasPendingChanges(scenarioId),
    )
    const evaluatorResolution = useAtomValue(
        annotationFormController.selectors.evaluatorResolution(),
    )
    const evaluators = useAtomValue(annotationFormController.selectors.evaluators(scenarioId))

    // Wrapped actions that inject scenarioId
    const updateMetric = useCallback(
        ({slug, fieldKey, value}: {slug: string; fieldKey: string; value: unknown}) => {
            updateMetricAction({scenarioId, slug, fieldKey, value})
        },
        [updateMetricAction, scenarioId],
    )

    const resetEdits = useCallback(() => {
        resetEditsAction(scenarioId)
    }, [resetEditsAction, scenarioId])

    return {
        metrics,
        evaluators,
        evaluatorResolution,
        hasPendingChanges,
        updateMetric,
        resetEdits,
    }
}
