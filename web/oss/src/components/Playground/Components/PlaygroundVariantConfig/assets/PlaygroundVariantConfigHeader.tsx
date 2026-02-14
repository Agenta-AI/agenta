import {useCallback, useMemo} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {getSourceRevisionId} from "@agenta/entities/legacyAppRevision"
import {isLocalDraftId} from "@agenta/entities/shared"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {DraftTag} from "@agenta/ui/components"
import {Trash} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"

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
    ...divProps
}: PlaygroundVariantConfigHeaderProps & {embedded?: boolean}) => {
    const classes = useStyles()
    const setSelectedVariants = useSetAtom(playgroundController.actions.setEntityIds)

    // Check if this is a local draft
    const isLocalDraftVariant = variantId ? isLocalDraftId(variantId) : false

    // Read baseline revision directly from the source of truth (appRevisionsWithDraftsAtomFamily)
    // For local drafts, use molecule data instead
    const baseline = useAtomValue(legacyAppRevisionMolecule.atoms.data(variantId || ""))
    const moleculeData = useAtomValue(legacyAppRevisionMolecule.atoms.data(variantId || ""))
    const deployment = useAtomValue(
        environmentMolecule.atoms.revisionDeployment((baseline?.id as string) || ""),
    )
    const latestAppRevisionId = useAtomValue(legacyAppRevisionMolecule.atoms.latestRevisionId)

    // For local drafts, get data from molecule
    const effectiveData = isLocalDraftVariant ? moleculeData : baseline
    const _sourceRevisionId = isLocalDraftVariant ? getSourceRevisionId(variantId || "") : null

    // Extract revision display data with fallbacks for embedded usage
    const _variantId = effectiveData?.id ?? (isLocalDraftVariant ? variantId : null)
    const variantRevision = revisionOverride ?? (effectiveData as any)?.revision ?? null
    // For local drafts, strip the "(Draft)" suffix from variant name since we show DraftTag separately
    const rawVariantName =
        variantNameOverride ??
        (effectiveData as any)?.variantName ??
        (effectiveData as any)?.name ??
        "Variant"
    const displayName = isLocalDraftVariant
        ? String(rawVariantName).replace(/\s*\(Draft\)$/, "")
        : rawVariantName
    // latestAppRevisionIdAtom is now cheap (1 API call via /preview/applications/revisions/query)
    const isLatestRevision =
        typeof (effectiveData as any)?.isLatestRevision === "boolean"
            ? (effectiveData as any).isLatestRevision
            : _variantId === latestAppRevisionId
    const hasChanges = useAtomValue(
        legacyAppRevisionMolecule.atoms.hasChanges((_variantId as string) || ""),
    )
    // Keep the full deployment objects so downstream components (e.g., EnvironmentStatus)
    // can access env.name and other fields.
    // Local drafts have no deployments
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

    const handleSwitchVariant = useCallback(
        (newVariantId: string) => {
            switchEntity({
                currentEntityId: variantId || "",
                newEntityId: newVariantId,
            })
        },
        [switchEntity, variantId],
    )

    const handleDiscardDraft = useCallback(() => {
        if (!variantId || !isLocalDraftVariant) return
        // When discarding the last entity, fall back to source revision
        // instead of leaving the playground empty
        setSelectedVariants((prev) => {
            const updated = prev.filter((id) => id !== variantId)
            if (updated.length === 0 && _sourceRevisionId) {
                return [_sourceRevisionId]
            }
            return updated
        })
        // Discard draft
        legacyAppRevisionMolecule.set.discard(variantId)
    }, [variantId, isLocalDraftVariant, setSelectedVariants, _sourceRevisionId])

    // Discard handler for regular revisions (shown in DraftTag dropdown)
    const handleRevisionDiscardDraft = useCallback(() => {
        if (!_variantId) return
        try {
            legacyAppRevisionMolecule.set.discard(_variantId as string)
            message.success("Draft changes discarded")
        } catch (e) {
            message.error("Failed to discard draft changes")
            console.error(e)
        }
    }, [_variantId])

    return (
        <section
            className={clsx(
                "w-full",
                "h-[48px]",
                "flex items-center justify-between",
                embedded ? undefined : "sticky top-0 z-[10]",
                classes.container,
                className,
            )}
            {...divProps}
        >
            <div className="flex items-center gap-2 grow">
                {!embedded && !isLocalDraftVariant && (
                    <SelectVariant
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
                                from {displayName} v{variantRevision}
                            </span>
                        )}
                    </div>
                )}
                {/* Don't show VariantDetailsWithStatus for local drafts - we already show source info above */}
                {!isLocalDraftVariant && (
                    <>
                        {embedded && !effectiveData ? (
                            <div className="flex items-center gap-2 grow mr-4">
                                <span className="text-sm text-gray-700 truncate">
                                    {displayName as any}
                                </span>
                                {variantRevision !== null && variantRevision !== undefined && (
                                    <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                                        rev {String(variantRevision)}
                                    </span>
                                )}
                            </div>
                        ) : (
                            <VariantDetailsWithStatus
                                className="grow mr-4"
                                revision={variantRevision ?? null}
                                variant={variantMin}
                                showBadges={true}
                                hideName={!embedded}
                                variantName={displayName as any}
                                showRevisionAsTag={true}
                                hasChanges={hasChanges}
                                isLatest={isLatestRevision}
                                onDiscardDraft={handleRevisionDiscardDraft}
                            />
                        )}
                    </>
                )}
            </div>
            {!embedded && (
                <div className="flex items-center gap-2">
                    {isLocalDraftVariant ? (
                        // Local draft actions
                        <>
                            <CommitVariantChangesButton
                                variantId={variantId}
                                label="Commit"
                                type="primary"
                                size="small"
                            />
                            <Tooltip title="Discard draft">
                                <Button
                                    type="text"
                                    size="small"
                                    danger
                                    icon={<Trash size={16} />}
                                    onClick={handleDiscardDraft}
                                />
                            </Tooltip>
                        </>
                    ) : (
                        // Regular revision actions
                        <>
                            <DeployVariantButton revisionId={variantId} />

                            <CommitVariantChangesButton
                                variantId={variantId}
                                label="Commit"
                                type="primary"
                                size="small"
                                data-tour="commit-button"
                            />

                            <PlaygroundVariantHeaderMenu variantId={variantId} />
                        </>
                    )}
                </div>
            )}
        </section>
    )
}

export default PlaygroundVariantConfigHeader
