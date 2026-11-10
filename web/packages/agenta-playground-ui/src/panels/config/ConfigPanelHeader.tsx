import type {ReactNode} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowLatestRevisionIdAtomFamily, workflowMolecule} from "@agenta/entities/workflow"
import type {ConfigViewMode} from "@agenta/entity-ui/drill-in"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {message} from "@agenta/ui/app-message"
import {Tag} from "@agenta/ui/components"
import {useMediaQuery} from "@agenta/ui/hooks"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

const VIEW_MODES: {value: ConfigViewMode; label: string}[] = [
    {value: "form", label: "Form"},
    {value: "json", label: "JSON"},
    {value: "yaml", label: "YAML"},
]

/**
 * The revision details beside the switcher. They keep their size and the switcher's name truncates
 * instead, so the draft tag is never covered by the buttons. In a narrow panel (the compare view)
 * the version, "Last modified" and the deployment dots drop out, as in the old playground; the
 * draft tag stays (it is the menu trigger, not a plain badge).
 */
const NARROW_DETAILS = [
    "shrink-0 gap-2",
    "max-sm:[&_.environment-badges]:hidden",
    "@max-[32rem]/config-header:[&_.environment-badges]:hidden",
    "@max-[32rem]/config-header:[&_[data-slot=badge]]:hidden",
].join(" ")

export interface ConfigPanelHeaderProps {
    revisionId: string
    viewMode: ConfigViewMode
    onViewModeChange: (mode: ConfigViewMode) => void
    /** Picks another revision. It shows the variant name, so the details leave the name out. */
    switcher?: ReactNode
    /** The host's buttons (Deploy, Commit, menu), after the view switch, as in the old playground. */
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
    // On a phone the bar has no room for the "Last modified" tag.
    const showLatestTag = useMediaQuery("(min-width: 640px)")
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
        <div className="@container/config-header flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-border bg-background px-3 max-sm:min-h-12 max-sm:py-1.5 sm:sticky sm:top-0 sm:z-10 sm:h-12 sm:flex-nowrap sm:gap-2 sm:px-4">
            {/* The details shrink first (the switcher name truncates). Only in a very narrow pane,
                once they reach their minimum, do the buttons on the right shrink and scroll. */}
            <div className="flex min-w-[5.5rem] items-center gap-1 overflow-hidden text-sm">
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
                        className={NARROW_DETAILS}
                        hideName={Boolean(switcher)}
                        variantName={name}
                        revision={version}
                        variant={{id: revisionId, deployedIn, isLatestRevision: isLatest}}
                        showBadges
                        showRevisionAsTag
                        hasChanges={isDirty}
                        isLatest={isLatest}
                        showLatestTag={showLatestTag}
                        onDiscardDraft={discardDraft}
                    />
                )}
            </div>
            <div className="ml-auto flex min-w-0 shrink-[0.001] items-center gap-1 overflow-x-auto sm:gap-2 [&>*]:shrink-0">
                <Select
                    value={viewMode}
                    onValueChange={(value) => onViewModeChange(value as ConfigViewMode)}
                >
                    <SelectTrigger size="sm" aria-label="Config view" className="h-7 w-24 shrink-0">
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
                {actions}
            </div>
        </div>
    )
}
