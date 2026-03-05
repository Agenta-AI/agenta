import {useCallback, useMemo} from "react"

import {message} from "@agenta/ui/app-message"
import {DraftTag} from "@agenta/ui/components"
import {Trash} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {
    isLocalDraft,
    getSourceRevisionId,
    legacyAppRevisionMolecule,
    moleculeBackedVariantAtomFamily,
    discardRevisionDraftAtom,
    revisionIsDirtyAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"

import {selectedVariantsAtom, parametersOverrideAtomFamily} from "../../../state/atoms"
import {
    playgroundRevisionDeploymentAtomFamily,
    playgroundLatestAppRevisionIdAtom,
} from "../../../state/atoms/playgroundAppAtoms"
import {switchVariantAtom} from "../../../state/atoms/urlSync"
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
    const setSelectedVariants = useSetAtom(selectedVariantsAtom)

    // Check if this is a local draft
    const isLocalDraftVariant = variantId ? isLocalDraft(variantId) : false

    // Read baseline revision directly from the source of truth (revisionListAtom)
    // For local drafts, use molecule data instead
    const baseline = useAtomValue(moleculeBackedVariantAtomFamily(variantId || ""))
    const moleculeData = useAtomValue(legacyAppRevisionMolecule.atoms.data(variantId || ""))
    const deployment = useAtomValue(
        playgroundRevisionDeploymentAtomFamily((baseline?.id as string) || ""),
    ) as any
    const latestAppRevisionId = useAtomValue(playgroundLatestAppRevisionIdAtom)

    // For local drafts, get data from molecule
    const effectiveData = isLocalDraftVariant ? moleculeData : baseline
    const _sourceRevisionId = isLocalDraftVariant ? getSourceRevisionId(variantId || "") : null

    // Extract revision display data with fallbacks for embedded usage
    const _variantId = effectiveData?.id ?? variantId
    const variantRevision = revisionOverride ?? (effectiveData as any)?.revision ?? null
    // For local drafts, strip the "(Draft)" suffix from variant name since we show DraftTag separately
    const rawVariantName =
        variantNameOverride ??
        (effectiveData as any)?.variantName ??
        (effectiveData as any)?.name ??
        _variantId
    const displayName = isLocalDraftVariant
        ? String(rawVariantName).replace(/\s*\(Draft\)$/, "")
        : rawVariantName
    const isLatestRevision =
        typeof (effectiveData as any)?.isLatestRevision === "boolean"
            ? (effectiveData as any).isLatestRevision
            : _variantId === latestAppRevisionId
    const isDirty = useAtomValue(revisionIsDirtyAtomFamily((_variantId as string) || ""))
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

    // Use the reusable switchVariant atom
    const switchVariant = useSetAtom(switchVariantAtom)

    const handleSwitchVariant = useCallback(
        (newVariantId: string) => {
            switchVariant({
                currentVariantId: variantId || "",
                newVariantId,
            })
        },
        [switchVariant, variantId],
    )

    const discardDraft = useSetAtom(discardRevisionDraftAtom)
    const setParamsOverride = useSetAtom(parametersOverrideAtomFamily(variantId || "") as any)

    const handleDiscardDraft = useCallback(() => {
        if (!variantId || !isLocalDraftVariant) return
        // Remove from selection first
        setSelectedVariants((prev) => prev.filter((id) => id !== variantId))
        // Discard draft + clear parameters override
        discardDraft(variantId)
        setParamsOverride(null)
    }, [variantId, isLocalDraftVariant, setSelectedVariants, discardDraft, setParamsOverride])

    // Discard handler for regular revisions (shown in DraftTag dropdown)
    const handleRevisionDiscardDraft = useCallback(() => {
        if (!_variantId) return
        try {
            discardDraft(_variantId as string)
            setParamsOverride(null)
            message.success("Draft changes discarded")
        } catch (e) {
            message.error("Failed to discard draft changes")
            console.error(e)
        }
    }, [_variantId, discardDraft, setParamsOverride])

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
                        value={_variantId}
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
                                hasChanges={isDirty}
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
