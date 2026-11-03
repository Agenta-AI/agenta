import {useMemo} from "react"

import {
    createWorkflowRevisionAdapter,
    EntityPicker,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {PlusIcon} from "@phosphor-icons/react"

import type {DraftRevision, NewEvaluationKind} from "./newEvaluationDraft"
import {SectionHint} from "./SectionHint"

const toDraftRevision = (result: WorkflowRevisionSelectionResult): DraftRevision => ({
    id: result.id,
    variantName: result.metadata.variantName || "default",
    version: result.metadata.revision ?? 0,
})

/**
 * Pick the revisions to evaluate. An auto evaluation takes several, a human evaluation one.
 * Without an app the section only asks for one.
 */
export const RevisionSection = ({
    kind,
    appId,
    selected,
    disabled,
    onPick,
}: {
    kind: NewEvaluationKind
    appId: string | null
    selected: readonly DraftRevision[]
    disabled?: boolean
    onPick: (revision: DraftRevision) => void
}) => {
    const adapter = useMemo(
        () =>
            appId
                ? createWorkflowRevisionAdapter({
                      workflowId: appId,
                      excludeRevisionZero: true,
                      emptyMessage: "No available revisions found to display",
                  })
                : null,
        [appId],
    )
    const selectedIds = useMemo(() => new Set(selected.map((revision) => revision.id)), [selected])

    if (!adapter)
        return <SectionHint>Select an application first to load this section.</SectionHint>

    const multiple = kind === "auto"
    return (
        <div className="flex flex-col gap-3">
            <div className="w-full min-w-0">
                <EntityPicker<WorkflowRevisionSelectionResult>
                    key={appId}
                    variant="popover-cascader"
                    adapter={adapter}
                    instanceId={`new-evaluation-revision-${appId}`}
                    onSelect={(result) => onPick(toDraftRevision(result))}
                    className="!w-full !justify-start"
                    placeholder={multiple ? "Add revisions" : "Select a revision"}
                    icon={<PlusIcon size={14} />}
                    showDropdownIcon={false}
                    panelMinWidth={240}
                    disabled={disabled}
                    openChildOnHover
                    size="middle"
                    {...(multiple
                        ? {
                              multiSelect: true,
                              selectedChildIds: selectedIds,
                              showChildSelectAll: false,
                          }
                        : {selectedChildId: selected[0]?.id ?? null})}
                />
            </div>
        </div>
    )
}
