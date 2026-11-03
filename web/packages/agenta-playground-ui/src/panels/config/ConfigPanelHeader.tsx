import type {ReactNode} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowLatestRevisionIdAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {message} from "@agenta/ui/app-message"
import {Tag} from "@agenta/ui/components"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

const VIEW_MODES: {value: ConfigViewMode; label: string}[] = [
    {value: "form", label: "Form"},
    {value: "json", label: "JSON"},
    {value: "yaml", label: "YAML"},
]

export interface ConfigPanelHeaderProps {
    revisionId: string
    viewMode: ConfigViewMode
    onViewModeChange: (mode: ConfigViewMode) => void
    /** Picks another revision. It shows the variant name, so the details leave the name out. */
    switcher?: ReactNode
    /** The host's buttons (Deploy, Commit, menu), before the view switch. */
    actions?: ReactNode
}

/**
 * The bar above one revision's config: which revision it is (variant name, version, the
 * environments it is deployed to, and a Draft tag with unsaved edits), the host's actions, and
 * the Form/JSON/YAML switch. A local draft names the revision it was copied from instead.
 *
 * The Draft tag's menu throws the unsaved edits away. That is local: nothing is sent.
 */
export const ConfigPanelHeader = ({
    revisionId,
    viewMode,
    onViewModeChange,
    switcher,
    actions,
}: ConfigPanelHeaderProps) => {
    const discard = useSetAtom(workflowMolecule.actions.discard)
    const discardDraft = () => {
        try {
            discard(revisionId)
            message.success("Draft changes discarded")
        } catch (error) {
            console.error("Discard draft failed", error)
            message.error("Failed to discard draft changes")
        }
    }
    const revision = useAtomValue(workflowMolecule.selectors.data(revisionId))
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId))
    const isLocalDraft = isLocalDraftId(revisionId)
    const deployedIn = useAtomValue(
        environmentMolecule.atoms.revisionDeployment(isLocalDraft ? "" : revisionId),
    )
    const latestId = useAtomValue(workflowLatestRevisionIdAtomFamily(revision?.workflow_id ?? ""))
    // The variant's own name: a revision's `name` is unreliable (SDK revisions carry none).
    const name = useAtomValue(workflowMolecule.selectors.variantLabel(revisionId)) ?? ""
    const version = revision?.version ?? null
    const isLatest = revisionId === latestId

    return (
        <div className="sticky top-0 z-10 flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border bg-background px-4">
            <div className="flex min-w-0 items-center gap-1 text-sm">
                {!isLocalDraft ? switcher : null}
                {isLocalDraft ? (
                    <>
                        <Tag draft />
                        {version !== null ? (
                            <span className="truncate text-muted-foreground">
                                from {name} v{version}
                            </span>
                        ) : null}
                    </>
                ) : (
                    <VariantDetailsWithStatus
                        className="min-w-0 gap-2 max-sm:[&_.environment-badges]:hidden"
                        hideName={Boolean(switcher)}
                        variantName={name}
                        revision={version}
                        variant={{id: revisionId, deployedIn, isLatestRevision: isLatest}}
                        showBadges
                        showRevisionAsTag
                        hasChanges={isDirty}
                        isLatest={isLatest}
                        onDiscardDraft={discardDraft}
                    />
                )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {actions}
                <Select
                    value={viewMode}
                    onValueChange={(value) => onViewModeChange(value as ConfigViewMode)}
                >
                    <SelectTrigger size="sm" aria-label="Config view" className="w-24 shrink-0">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {VIEW_MODES.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>
                                {mode.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
        </div>
    )
}
