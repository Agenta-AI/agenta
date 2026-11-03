import {useMemo} from "react"

import {evaluatorFeedbackSchemasAtom, evaluatorsListDataAtom} from "@agenta/entities/workflow"
import {useEnsureEvaluatorEnrichment} from "@agenta/entity-ui/selection"
import {
    AnnotationEvaluatorControl,
    AnnotationFeedbackControl,
    buildAnnotationFeedbackOptions,
    FilterDialog,
    type AnnotationRowSlot,
    type FilterDialogProps,
} from "@agenta/observability-ui"
import {useAtomValue} from "jotai"

export type AnnotatedFilterDialogProps = Omit<FilterDialogProps, "annotationRow">

/**
 * `FilterDialog` with the annotation evaluator + feedback sub-row wired in.
 *
 * The package deliberately reads no atoms, so the evaluator list and the feedback catalogue are
 * supplied here. `useEnsureEvaluatorEnrichment` is load-bearing: without it
 * `evaluatorFeedbackSchemasAtom` stays empty and the feedback picker has no options.
 */
const AnnotatedFilterDialog = (props: AnnotatedFilterDialogProps) => {
    const evaluatorPreviews = useAtomValue(evaluatorsListDataAtom)
    useEnsureEvaluatorEnrichment()
    const evaluatorFeedbackSchemas = useAtomValue(evaluatorFeedbackSchemasAtom)

    const evaluatorOptions = useMemo(
        () =>
            (evaluatorPreviews ?? []).map((evaluator) => ({
                label: evaluator.name || evaluator.slug || "",
                value: evaluator.slug || "",
            })),
        [evaluatorPreviews],
    )

    const feedbackOptions = useMemo(
        () => buildAnnotationFeedbackOptions(evaluatorFeedbackSchemas),
        [evaluatorFeedbackSchemas],
    )

    const annotationRow = useMemo<AnnotationRowSlot>(
        () => ({
            renderInline: (ctx) => (
                <AnnotationEvaluatorControl
                    value={ctx.value}
                    onChange={ctx.onChange}
                    onRemoveRow={ctx.onRemoveRow}
                    evaluatorOptions={evaluatorOptions}
                    feedbackOptions={feedbackOptions}
                    disabled={ctx.disabled}
                    container={ctx.container}
                />
            ),
            renderBelow: (ctx) => (
                <AnnotationFeedbackControl
                    value={ctx.value}
                    onChange={ctx.onChange}
                    onRemoveRow={ctx.onRemoveRow}
                    evaluatorOptions={evaluatorOptions}
                    feedbackOptions={feedbackOptions}
                    disabled={ctx.disabled}
                    container={ctx.container}
                />
            ),
            // The evaluator/feedback controls own their own removal buttons once either is active.
            hidesRowDelete: (ctx) =>
                ctx.value?.evaluator !== undefined || ctx.value?.feedback !== undefined,
        }),
        [evaluatorOptions, feedbackOptions],
    )

    return <FilterDialog {...props} annotationRow={annotationRow} />
}

export default AnnotatedFilterDialog
