import {EvaluatorsSection} from "../evaluations/new/EvaluatorsSection"
import type {DraftEvaluator} from "../evaluations/new/newEvaluationDraft"

/**
 * The "Add evaluator" picker of the edit dialog: the new evaluation's evaluator table, human
 * evaluators for a human run and automatic ones for the others, as in the old app. The run's own
 * evaluators show as picked and cannot be removed here; a staged one is removed by picking it again.
 */
export const RunEvaluatorPicker = ({
    human,
    projectId,
    selected,
    onPick,
    onRemove,
}: {
    human: boolean
    projectId: string
    selected: readonly DraftEvaluator[]
    onPick: (evaluator: DraftEvaluator) => void
    onRemove: (revisionId: string) => void
}) => (
    <EvaluatorsSection
        kind={human ? "human" : "auto"}
        projectId={projectId}
        selected={selected}
        evaluatorsHref={null}
        onPick={(evaluator) =>
            selected.some((item) => item.revisionId === evaluator.revisionId)
                ? onRemove(evaluator.revisionId)
                : onPick(evaluator)
        }
    />
)
