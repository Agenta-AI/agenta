import {useEnrichedHumanEvaluatorAdapter} from "@agenta/entity-ui/selection"

import {EvaluatorPicker} from "./EvaluatorPicker"
import {renderEvaluatorRevisionLabel} from "./EvaluatorRevisionLabel"
import type {DraftEvaluator} from "./newEvaluationDraft"

/** The picker of a human evaluation: human evaluators, labelled with their metrics. */
export const HumanEvaluatorPicker = (props: {
    selected: readonly DraftEvaluator[]
    disabled?: boolean
    onPick: (evaluator: DraftEvaluator) => void
    onRemove: (revisionId: string) => void
    onClear: () => void
}) => {
    const adapter = useEnrichedHumanEvaluatorAdapter(renderEvaluatorRevisionLabel, {
        showWorkflowMeta: true,
    })
    return (
        <EvaluatorPicker
            adapter={adapter}
            instanceId="new-evaluation-human-evaluator"
            allowSelectAll={false}
            {...props}
        />
    )
}
