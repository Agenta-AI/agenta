import {useMemo} from "react"

import {workflowLatestRevisionIdAtomFamily} from "@agenta/entities/workflow"
import {
    createWorkflowRevisionAdapter,
    TreeSelectPopupContent,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {playgroundController} from "@agenta/playground"
import {useAtomValue} from "jotai"

export interface RevisionTreeProps {
    /** The app whose variants and revisions the list shows. */
    appId: string
    /** The revision marked as the current one, if any. */
    selectedValue?: string
    onSelect: (revisionId: string) => void
}

/**
 * The app's variants with their revisions under each. Revisions already on screen are disabled.
 * It fetches the lists when it mounts, so the popovers mount it only while open.
 */
export const RevisionTree = ({appId, selectedValue, onSelect}: RevisionTreeProps) => {
    const shown = useAtomValue(playgroundController.selectors.entityIds())
    const latestId = useAtomValue(workflowLatestRevisionIdAtomFamily(appId))

    const adapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                workflowId: appId,
                excludeRevisionZero: true,
                variantOverrides: {
                    getLabel: (entity: unknown) => {
                        const variant = entity as {name?: string; id?: string}
                        return variant.name ?? variant.id ?? "Unnamed"
                    },
                },
                revisionOverrides: {
                    getLabel: (entity: unknown) =>
                        `v${(entity as {version?: number}).version ?? 0}`,
                },
                emptyMessage: "No variants found",
                loadingMessage: "Loading variants...",
            }),
        [appId],
    )
    const disabledIds = useMemo(() => new Set(shown), [shown])

    return (
        <TreeSelectPopupContent<WorkflowRevisionSelectionResult>
            adapter={adapter}
            selectedValue={selectedValue}
            disabledChildIds={disabledIds}
            renderChildTitle={(child) => {
                const revision = child as {
                    id: string
                    version?: number
                    variantName?: string
                }
                return (
                    <VariantDetailsWithStatus
                        className="w-full"
                        variantName={revision.variantName ?? ""}
                        revision={revision.version ?? 0}
                        variant={revision}
                        hideName
                        showBadges
                        isLatest={revision.id === latestId}
                    />
                )
            }}
            onSelect={(selection) => onSelect(selection.id)}
            width={280}
            maxHeight={400}
        />
    )
}
