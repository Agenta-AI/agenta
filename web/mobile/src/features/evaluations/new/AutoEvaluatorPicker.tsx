import {useEnrichedEvaluatorOnlyAdapter} from "@agenta/entity-ui/selection"

import {EvaluatorPicker} from "./EvaluatorPicker"
import {renderEvaluatorRevisionLabel} from "./EvaluatorRevisionLabel"
import type {DraftEvaluator} from "./newEvaluationDraft"

/** The picker of an auto evaluation: automatic evaluators only. */
export const AutoEvaluatorPicker = (props: {
    selected: readonly DraftEvaluator[]
    disabled?: boolean
    onPick: (evaluator: DraftEvaluator) => void
    onRemove: (revisionId: string) => void
    onClear: () => void
}) => {
    const adapter = useEnrichedEvaluatorOnlyAdapter(renderEvaluatorRevisionLabel, {
        showWorkflowMeta: true,
    })
    return (
        <EvaluatorPicker adapter={adapter} instanceId="new-evaluation-auto-evaluator" {...props} />
    )
}
