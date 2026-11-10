import {useMemo} from "react"

import {evaluatorFeedbackSchemasAtom, evaluatorsListDataAtom} from "@agenta/entities/workflow"
import {useEnsureEvaluatorEnrichment} from "@agenta/entity-ui/selection"
import {
    AnnotationEvaluatorControl,
    AnnotationFeedbackControl,
    buildAnnotationFeedbackOptions,
    type AnnotationRowContext,
} from "@agenta/observability-ui"
import {useAtomValue} from "jotai"

/**
 * One half of the annotation filter row: the evaluator picker on the row's own line, or the
 * feedback controls on the line below. Loaded on demand, so the evaluator list is first read when
 * a filter dialog with an annotation row opens. The enrichment fills the feedback schemas; without
 * it the feedback list is empty.
 */
export const AnnotationRowControls = ({
    part,
    context,
}: {
    part: "evaluator" | "feedback"
    context: AnnotationRowContext
}) => {
    const evaluators = useAtomValue(evaluatorsListDataAtom)
    useEnsureEvaluatorEnrichment()
    const feedbackSchemas = useAtomValue(evaluatorFeedbackSchemasAtom)

    const evaluatorOptions = useMemo(
        () =>
            (evaluators ?? []).map((evaluator) => ({
                label: evaluator.name || evaluator.slug || "",
                value: evaluator.slug || "",
            })),
        [evaluators],
    )
    const feedbackOptions = useMemo(
        () => buildAnnotationFeedbackOptions(feedbackSchemas),
        [feedbackSchemas],
    )

    const Control = part === "evaluator" ? AnnotationEvaluatorControl : AnnotationFeedbackControl
    return (
        <Control
            value={context.value}
            onChange={context.onChange}
            onRemoveRow={context.onRemoveRow}
            evaluatorOptions={evaluatorOptions}
            feedbackOptions={feedbackOptions}
            disabled={context.disabled}
            container={context.container}
        />
    )
}
