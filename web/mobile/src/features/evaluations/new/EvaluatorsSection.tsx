import {evaluatorsListQueryAtom} from "@agenta/entities/workflow"
import {useEnsureEvaluatorEnrichment} from "@agenta/entity-ui/selection"
import {LoadError} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {AutoEvaluatorPicker} from "./AutoEvaluatorPicker"
import {EvaluatorsEmpty} from "./EvaluatorsEmpty"
import {HumanEvaluatorPicker} from "./HumanEvaluatorPicker"
import type {DraftEvaluator, NewEvaluationKind} from "./newEvaluationDraft"
import {SectionHint} from "./SectionHint"

/** Pick the evaluators that score the run. The header chips show and remove the picks. */
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
    /** Where "Open evaluators" goes. Null while the evaluators view is off: no link then. */
    evaluatorsHref: string | null
    onPick: (evaluator: DraftEvaluator) => void
    onRemove: (revisionId: string) => void
    onClear: () => void
}) => {
    // The sheet mounts this only while open, so the revision counts load only then.
    useEnsureEvaluatorEnrichment()
    // The count of the project's evaluators, of any kind: the pickers say what they lack themselves.
    const list = useAtomValue(evaluatorsListQueryAtom)
    const count = list.data?.refs?.length ?? 0

    if (!hasApp) return <SectionHint>Select an application first to load this section.</SectionHint>
    if (list.isError) {
        return <LoadError title="Could not load evaluators" onRetry={() => void list.refetch()} />
    }
    if (!list.isPending && count === 0) return <EvaluatorsEmpty evaluatorsHref={evaluatorsHref} />

    const Picker = kind === "human" ? HumanEvaluatorPicker : AutoEvaluatorPicker
    return (
        <Picker
            selected={selected}
            disabled={disabled}
            onPick={onPick}
            onRemove={onRemove}
            onClear={onClear}
        />
    )
}
