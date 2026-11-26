import {useCallback, useEffect} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {useAtomValue, useSetAtom} from "jotai"

/**
 * Binds one scenario's annotation form to `annotationFormController`: it hands the controller the
 * scenario's annotations and trace or test case reference, then reads the merged metrics, the
 * evaluators and the pending-change flag back. All form logic stays in the controller.
 */
export const useAnnotationFormState = (scenarioId: string) => {
    const annotations = useAtomValue(
        annotationSessionController.selectors.scenarioAnnotations(scenarioId),
    )
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(scenarioId),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(scenarioId),
    )
    const setScenarioContext = useSetAtom(annotationFormController.actions.setScenarioContext)
    const updateMetricAction = useSetAtom(annotationFormController.actions.updateMetric)

    const {traceId, spanId} = traceRef
    const {testcaseId} = testcaseRef
    useEffect(() => {
        if (!scenarioId) return
        setScenarioContext({scenarioId, annotations, traceId, spanId, testcaseId})
    }, [setScenarioContext, scenarioId, annotations, traceId, spanId, testcaseId])

    const metrics = useAtomValue(annotationFormController.selectors.effectiveMetrics(scenarioId))
    const evaluators = useAtomValue(annotationFormController.selectors.evaluators(scenarioId))
    const evaluatorResolution = useAtomValue(
        annotationFormController.selectors.evaluatorResolution(),
    )

    const updateMetric = useCallback(
        (slug: string, fieldKey: string, value: unknown) =>
            updateMetricAction({scenarioId, slug, fieldKey, value}),
        [updateMetricAction, scenarioId],
    )

    return {metrics, evaluators, evaluatorResolution, updateMetric}
}
