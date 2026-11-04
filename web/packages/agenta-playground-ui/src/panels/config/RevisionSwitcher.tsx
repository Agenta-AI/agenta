import {useMemo, useState} from "react"

import {workflowLatestRevisionIdAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import {
    createWorkflowRevisionAdapter,
    TreeSelectPopupContent,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {playgroundController} from "@agenta/playground"
import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

export interface RevisionSwitcherProps {
    /** The app whose variants and revisions the list shows. */
    appId: string
    /** The revision the playground shows now. */
    revisionId: string
    /** The reader picked another revision. */
    onSwitch: (revisionId: string) => void
}

const triggerLabel = ({
    pending,
    name,
}: {
    pending: boolean
    name: string | null | undefined
}): string => (pending ? "Loading..." : name || "Select variant")

/**
 * The variant name with a chevron. It opens the app's variants and their revisions; picking a
 * revision hands it to `onSwitch`.
 *
 * The list loads only once the popover opens, so a playground that never switches never fetches
 * the variants.
 */
export const RevisionSwitcher = ({appId, revisionId, onSwitch}: RevisionSwitcherProps) => {
    const [open, setOpen] = useState(false)
    const query = useAtomValue(workflowMolecule.selectors.query(revisionId))
    const name = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId))
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
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="max-w-48 gap-1 px-2 font-medium"
                    aria-label="Switch revision"
                >
                    <span className="truncate">
                        {triggerLabel({pending: query.isPending, name})}
                    </span>
                    <CaretDown aria-hidden size={12} className="shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[296px] p-0">
                {open ? (
                    <TreeSelectPopupContent<WorkflowRevisionSelectionResult>
                        adapter={adapter}
                        selectedValue={revisionId}
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
                        onSelect={(selection) => {
                            setOpen(false)
                            onSwitch(selection.id)
                        }}
                        width={280}
                        maxHeight={400}
                    />
                ) : null}
            </PopoverContent>
        </Popover>
    )
}
