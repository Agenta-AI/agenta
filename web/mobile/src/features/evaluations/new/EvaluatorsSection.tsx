import {evaluatorsListQueryAtom} from "@agenta/entities/workflow"
import {useEnsureEvaluatorEnrichment} from "@agenta/entity-ui/selection"
import {useAtomValue} from "jotai"

import {useDeveloperViewEnabled} from "../../developer/developerViewAccess"

import {AutoEvaluatorPicker} from "./AutoEvaluatorPicker"
import {EvaluatorsEmpty} from "./EvaluatorsEmpty"
import {HumanEvaluatorPicker} from "./HumanEvaluatorPicker"
import type {DraftEvaluator, NewEvaluationKind} from "./newEvaluationDraft"
import {PickedCard} from "./PickedCard"
import {SectionHint} from "./SectionHint"

/** Whether the project has any evaluator at all, and whether that is still loading. */
const useEvaluatorCount = () => {
    const query = useAtomValue(evaluatorsListQueryAtom)
    return {count: query.data?.refs?.length ?? 0, isPending: query.isPending ?? false}
}

/** Pick the evaluators that score the run, with a card for each pick. */
export const EvaluatorsSection = ({
    kind,
    hasApp,
    selected,
    disabled,
    evaluatorsHref,
    onPick,
    onRemove,
    onClear,
}: {
    kind: NewEvaluationKind
    hasApp: boolean
    selected: readonly DraftEvaluator[]
    disabled?: boolean
    /** Where "Open evaluators" goes. */
    evaluatorsHref: string
    onPick: (evaluator: DraftEvaluator) => void
    onRemove: (revisionId: string) => void
    onClear: () => void
}) => {
    // The sheet mounts this only while open, so the revision counts load only then.
    useEnsureEvaluatorEnrichment()
    const {count, isPending} = useEvaluatorCount()
    const evaluatorsViewOn = useDeveloperViewEnabled("evaluators") === true

    if (!hasApp) return <SectionHint>Select an application first to load this section.</SectionHint>
    if (!isPending && count === 0) {
        return <EvaluatorsEmpty evaluatorsHref={evaluatorsViewOn ? evaluatorsHref : null} />
    }

    const Picker = kind === "human" ? HumanEvaluatorPicker : AutoEvaluatorPicker
    return (
        <div className="flex flex-col gap-3">
            <Picker
                selected={selected}
                disabled={disabled}
                onPick={onPick}
                onRemove={onRemove}
                onClear={onClear}
            />
            {selected.map((evaluator) => (
                <PickedCard
                    key={evaluator.revisionId}
                    removeLabel={`Remove ${evaluator.name}`}
                    disabled={disabled}
                    onRemove={() => onRemove(evaluator.revisionId)}
                >
                    {evaluator.name} - v{evaluator.version}
                </PickedCard>
            ))}
        </div>
    )
}
