import {
    EntityPicker,
    testsetAdapter,
    type TestsetSelectionResult,
} from "@agenta/entity-ui/selection"
import {PlusIcon} from "@phosphor-icons/react"

import {ExpectedVariables} from "./ExpectedVariables"
import type {DraftRevision, DraftTestset} from "./newEvaluationDraft"
import {PickedCard} from "./PickedCard"
import {SectionHint} from "./SectionHint"

const toDraftTestset = (result: TestsetSelectionResult): DraftTestset => ({
    revisionId: result.metadata.revisionId || result.id,
    testsetId: result.metadata.testsetId,
    name: result.metadata.testsetName,
    version: result.metadata.version,
})

/** Pick the test set revision to run on. Picking the selected one again clears it. */
export const TestsetSection = ({
    hasApp,
    revisions,
    selected,
    disabled,
    onPick,
    onClear,
}: {
    hasApp: boolean
    revisions: readonly DraftRevision[]
    selected: DraftTestset | null
    disabled?: boolean
    onPick: (testset: DraftTestset) => void
    onClear: () => void
}) => {
    if (!hasApp) return <SectionHint>Select an application first to load this section.</SectionHint>

    return (
        <div className="flex flex-col gap-3">
            <ExpectedVariables revisions={revisions} />
            <div className="w-full min-w-0">
                <EntityPicker<TestsetSelectionResult>
                    variant="popover-cascader"
                    adapter={testsetAdapter}
                    instanceId="new-evaluation-testset"
                    onSelect={(result) => onPick(toDraftTestset(result))}
                    className="!w-full !justify-start"
                    placeholder="Select a test set"
                    icon={<PlusIcon size={14} />}
                    showDropdownIcon={false}
                    panelMinWidth={240}
                    disabled={disabled}
                    openChildOnHover
                    size="middle"
                    selectedChildId={selected?.revisionId ?? null}
                />
            </div>
            {selected ? (
                <PickedCard
                    removeLabel={`Remove ${selected.name}`}
                    disabled={disabled}
                    onRemove={onClear}
                >
                    {selected.name} - v{selected.version}
                </PickedCard>
            ) : null}
        </div>
    )
}
