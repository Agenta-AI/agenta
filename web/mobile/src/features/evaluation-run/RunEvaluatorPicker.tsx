import {AutoEvaluatorPicker} from "../evaluations/new/AutoEvaluatorPicker"
import {HumanEvaluatorPicker} from "../evaluations/new/HumanEvaluatorPicker"
import type {DraftEvaluator} from "../evaluations/new/newEvaluationDraft"

/**
 * The "Add evaluator" picker of the edit dialog: the new evaluation's pickers, human evaluators for
 * a human run and automatic ones for the others, as in the old app. The run's own evaluators show
 * as picked and cannot be removed here.
 */
export const RunEvaluatorPicker = ({
    human,
    selected,
    onPick,
    onRemove,
    onClear,
}: {
    human: boolean
    selected: readonly DraftEvaluator[]
    onPick: (evaluator: DraftEvaluator) => void
    onRemove: (revisionId: string) => void
    onClear: () => void
}) => {
    const Picker = human ? HumanEvaluatorPicker : AutoEvaluatorPicker
    return <Picker selected={selected} onPick={onPick} onRemove={onRemove} onClear={onClear} />
}
