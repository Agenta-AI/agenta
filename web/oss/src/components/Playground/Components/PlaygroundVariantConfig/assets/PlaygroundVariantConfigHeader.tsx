import {useCallback, useMemo} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule, workflowLatestRevisionIdAtomFamily} from "@agenta/entities/workflow"
import {
    createWorkflowRevisionAdapter,
    useEnrichedEvaluatorOnlyAdapter,
} from "@agenta/entity-ui/selection"
import {VariantDetailsWithStatus} from "@agenta/entity-ui/variant"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {DraftTag} from "@agenta/ui/components"
import {Trash} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {routerAppIdAtom} from "@/oss/state/app/atoms/fetcher"

import SelectVariant from "../../Menus/SelectVariant"
import CommitVariantChangesButton from "../../Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import DeployVariantButton from "../../Modals/DeployVariantModal/assets/DeployVariantButton"

import {useStyles} from "./styles"
import {PlaygroundVariantConfigHeaderProps} from "./types"

const PlaygroundVariantHeaderMenu = dynamic(
    () => import("../../Menus/PlaygroundVariantHeaderMenu"),
    {ssr: false},
)

const PlaygroundVariantConfigHeader = ({
    variantId,
    className,
    embedded,
    variantNameOverride,
    revisionOverride,
    evaluatorLabel,
    hasPresets,
    onLoadPreset,
    extraActions,
    ...divProps
}: PlaygroundVariantConfigHeaderProps & {embedded?: boolean}) => {
    const classes = useStyles()

    // Project-scoped playground (no app in URL) → browse all workflows
    // App-scoped playground → scoped to current app only
    const appId = useAtomValue(routerAppIdAtom)
    const isProjectScoped = !appId

    // Determine entity type from flags to pick the right browse adapter
    const entityData = useAtomValue(workflowMolecule.selectors.data(variantId || ""))
    const isEvaluatorEntity = Boolean(
        (entityData as {flags?: {is_evaluator?: boolean} | null} | null)?.flags?.is_evaluator,
    )

    // Browse adapters: evaluator-only or app-only (non-evaluator, non-human)
    const evaluatorOnlyAdapter = useEnrichedEvaluatorOnlyAdapter()
    const appOnlyAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: false, is_feedback: false},
            }),
        [],
    )

    // Select the appropriate browse adapter based on entity type
    const browseAdapter = isEvaluatorEntity ? evaluatorOnlyAdapter : appOnlyAdapter

    // Check if this is a local draft (browser-only clone)
    const isLocalDraftVariant = variantId ? isLocalDraftId(variantId) : false

    const runnableData = useAtomValue(workflowMolecule.selectors.data(variantId || ""))
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(variantId || ""))

    // Deployment info: look up which environments this revision is deployed to
    // Local drafts have no deployments
    const deploymentEntityId = (runnableData?.id as string) || ""
    const deployment = useAtomValue(
        environmentMolecule.atoms.revisionDeployment(deploymentEntityId),
    )

    // Extract revision display data with fallbacks for embedded usage
    const _variantId = runnableData?.id ?? null
    const variantRevision = revisionOverride ?? (runnableData?.version as number | null) ?? null
    const rawVariantName = variantNameOverride ?? runnableData?.name ?? "Variant"

    // Read workflow_id from the raw entity and compare against the latest revision
    // for this workflow. This avoids the bridge's probe loop (which triggers N queries
    // across all molecule types) and uses a single targeted query instead.
    const rawEntity = useAtomValue(workflowMolecule.selectors.data(variantId || ""))
    const workflowId = (rawEntity as {workflow_id?: string | null} | null)?.workflow_id ?? ""
    const latestRevisionId = useAtomValue(workflowLatestRevisionIdAtomFamily(workflowId))
    const isLatestRevision = !!variantId && variantId === latestRevisionId
    const hasChanges = isDirty

    const deployedIn = isLocalDraftVariant
        ? []
        : Array.isArray(deployment)
          ? (deployment as any[])
          : []

    // Stable minimal variant shape for presentational children
    const variantMin = useMemo(
        () => ({
            id: (_variantId as string) || "",
            deployedIn,
            isLatestRevision: isLatestRevision ?? false,
        }),
        [_variantId, deployedIn, isLatestRevision],
    )

    const switchEntity = useSetAtom(playgroundController.actions.switchEntity)
    const removeEntity = useSetAtom(playgroundController.actions.removeEntity)

    const handleSwitchVariant = useCallback(
        (newVariantId: string) => {
            switchEntity({
                currentEntityId: variantId || "",
                newEntityId: newVariantId,
            })
        },
        [switchEntity, variantId],
    )

    // Discard handler for local drafts — removes the draft from selection
    const handleDiscardLocalDraft = useCallback(() => {
        if (!variantId || !isLocalDraftVariant) return
        removeEntity(variantId)
        workflowMolecule.set.discard(variantId)
    }, [variantId, isLocalDraftVariant, removeEntity])

    // Discard handler for regular revisions (shown in DraftTag dropdown)
    const handleRevisionDiscardDraft = useCallback(() => {
        if (!_variantId) return
        try {
            workflowMolecule.set.discard(_variantId as string)
            message.success("Draft changes discarded")
        } catch (e) {
            message.error("Failed to discard draft changes")
            console.error(e)
        }
    }, [_variantId])

    return (
        <section
            className={`h-[48px] flex items-center justify-between overflow-hidden ${embedded ? "grow" : `sticky top-0 z-[10] w-full`} ${classes.container} ${className ?? ""}`}
            {...divProps}
        >
            <div className="flex items-center gap-2 grow min-w-0 overflow-hidden">
                {!embedded && !isLocalDraftVariant && (
                    <SelectVariant
                        mode={isProjectScoped ? "browse" : "scoped"}
                        customBrowseAdapter={isProjectScoped ? browseAdapter : undefined}
                        showCreateNew={!isEvaluatorEntity}
                        onChange={(value) => handleSwitchVariant?.(value)}
                        value={_variantId ?? undefined}
                    />
                )}
                {/* Local draft: show Draft tag then source revision info */}
                {isLocalDraftVariant && (
                    <div className="flex items-center gap-2">
                        <DraftTag />
                        {variantRevision !== null && variantRevision !== undefined && (
                            <span className="text-gray-500">
                                from {rawVariantName} v{variantRevision}
                            </span>
                        )}
                    </div>
                )}
                {/* Don't show VariantDetailsWithStatus for local drafts — source info is shown above */}
                {!isLocalDraftVariant && (
                    <>
                        {embedded && !runnableData ? (
                            <div className="flex items-center gap-2 grow mr-4">
                                <span className="text-sm text-gray-700 truncate">
                                    {rawVariantName as any}
                                </span>
                                {variantRevision !== null && variantRevision !== undefined && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                                        rev {String(variantRevision)}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <VariantDetailsWithStatus
                                className="mr-4 gap-2"
                                revision={variantRevision ?? null}
                                variant={variantMin}
                                showBadges
                                hideName={!embedded}
                                variantName={rawVariantName as any}
                                showRevisionAsTag={true}
                                hasChanges={hasChanges}
                                isLatest={isLatestRevision}
                                onDiscardDraft={handleRevisionDiscardDraft}
                            />
                        )}
                    </>
                )}
                {evaluatorLabel && !embedded && (
                    <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600 flex-shrink-0">
                        {evaluatorLabel}
                    </span>
                )}
            </div>
            <div className="flex items-center justify-end gap-2 shrink-0 grow min-w-0">
                {extraActions}
                {hasPresets && onLoadPreset && (
                    <Button size="small" onClick={onLoadPreset}>
                        Load Preset
                    </Button>
                )}
                {isLocalDraftVariant ? (
                    <>
                        <CommitVariantChangesButton
                            variantId={variantId}
                            label="Commit"
                            type="primary"
                            size="small"
                        />
                        {!rawEntity?.meta?.__ephemeral && (
                            <Tooltip title="Discard draft">
                                <Button
                                    type="text"
                                    size="small"
                                    danger
                                    icon={<Trash size={16} />}
                                    onClick={handleDiscardLocalDraft}
                                />
                            </Tooltip>
                        )}
                    </>
                ) : (
                    <>
                        {!embedded && <DeployVariantButton revisionId={variantId} />}

                        <CommitVariantChangesButton
                            variantId={variantId}
                            label="Commit"
                            type="primary"
                            size="small"
                            data-tour="commit-button"
                        />

                        {!embedded && <PlaygroundVariantHeaderMenu variantId={variantId} />}
                    </>
                )}
            </div>
        </section>
    )
}

export default PlaygroundVariantConfigHeader
