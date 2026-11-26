import {
    FilterDialog,
    type AnnotationRowSlot,
    type FilterDialogProps,
} from "@agenta/observability-ui"
import dynamic from "next/dynamic"

const AnnotationRowControls = dynamic(
    () => import("./AnnotationRowControls").then((module) => module.AnnotationRowControls),
    {ssr: false},
)

const annotationRow: AnnotationRowSlot = {
    renderInline: (context) => <AnnotationRowControls part="evaluator" context={context} />,
    renderBelow: (context) => <AnnotationRowControls part="feedback" context={context} />,
    // The evaluator and feedback controls have their own remove buttons once either is set.
    hidesRowDelete: ({value}) => value?.evaluator !== undefined || value?.feedback !== undefined,
}

/**
 * The traces filter dialog with evaluator and feedback controls on its annotation row. The
 * controls and the evaluator list load when a dialog with an annotation row first opens.
 */
export const AnnotatedTracesFilter = (props: Omit<FilterDialogProps, "annotationRow">) => (
    <FilterDialog {...props} annotationRow={annotationRow} />
)
