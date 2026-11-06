import {useState} from "react"

import {evaluatorsListQueryAtom} from "@agenta/entities/workflow"
import {useEnsureEvaluatorEnrichment} from "@agenta/entity-ui/selection"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {LoadError} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {AutoEvaluatorPicker} from "./AutoEvaluatorPicker"
import {EvaluatorsEmpty} from "./EvaluatorsEmpty"
import {HumanEvaluatorPicker} from "./HumanEvaluatorPicker"
import type {DraftEvaluator, NewEvaluationKind} from "./newEvaluationDraft"
import {SectionHint} from "./SectionHint"

// The create flow is its own chunk: it downloads only when a user creates an evaluator here.
const CreateEvaluatorFlow = dynamic(
    () =>
        import("../../evaluators/create/CreateEvaluatorFlow").then(
            (module) => module.CreateEvaluatorFlow,
        ),
    {ssr: false},
)

/**
 * Pick the evaluators that score the run. The header chips show and remove the picks. In beta
 * developer mode the picker and the empty state also create one, which is then picked: a human
 * evaluator with its form, an automatic one in the editable drawer where the host allows it.
 */
export const EvaluatorsSection = ({
    kind,
    hasApp,
    selected,
    disabled,
    evaluatorsHref,
    onPick,
    onRemove,
    onClear,
    allowAutomaticCreate = false,
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
    /** The automatic create drawer uses the playground state: a host inside a playground says no. */
    allowAutomaticCreate?: boolean
}) => {
    // The sheet mounts this only while open, so the revision counts load only then.
    useEnsureEvaluatorEnrichment()
    // The count of the project's evaluators, of any kind: the pickers say what they lack themselves.
    const list = useAtomValue(evaluatorsListQueryAtom)
    const count = list.data?.refs?.length ?? 0
    const beta = useAtomValue(betaDeveloperModeActiveAtom)
    const [creating, setCreating] = useState(false)
    const canCreate = beta && (kind === "human" || allowAutomaticCreate)
    const onCreate = canCreate ? () => setCreating(true) : undefined
    const createFlow = creating ? (
        <CreateEvaluatorFlow
            kind={kind === "human" ? "human" : "automatic"}
            onClose={() => setCreating(false)}
            onCreated={(created) =>
                onPick({
                    revisionId: created.revisionId,
                    evaluatorId: created.workflowId,
                    name: created.name,
                    version: created.version,
                })
            }
        />
    ) : null

    if (!hasApp) return <SectionHint>Select an application first to load this section.</SectionHint>
    if (list.isError) {
        return <LoadError title="Could not load evaluators" onRetry={() => void list.refetch()} />
    }
    if (!list.isPending && count === 0) {
        return (
            <>
                <EvaluatorsEmpty evaluatorsHref={evaluatorsHref} onCreate={onCreate} />
                {createFlow}
            </>
        )
    }

    const Picker = kind === "human" ? HumanEvaluatorPicker : AutoEvaluatorPicker
    return (
        <>
            <Picker
                selected={selected}
                disabled={disabled}
                onPick={onPick}
                onRemove={onRemove}
                onClear={onClear}
                onCreateNew={onCreate}
            />
            {createFlow}
        </>
    )
}
