import {useCallback, useMemo} from "react"

import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {
    enhancedRevisionByIdAtomFamily,
    revisionDeploymentAtomFamily,
} from "@/oss/state/variant/atoms/fetcher"

// import {baselineVariantAtomFamily} from "../../../state/atoms/dirtyState"
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

    // Read baseline revision directly from the source of truth (revisionListAtom)
    const baseline = useAtomValue(enhancedRevisionByIdAtomFamily(variantId || ""))
    const deployment = useAtomValue(
        revisionDeploymentAtomFamily((baseline?.id as string) || ""),
    ) as any

    // Extract revision display data with fallbacks for embedded usage
    const _variantId = baseline?.id ?? variantId
    const variantRevision = revisionOverride ?? baseline?.revision ?? null
    const displayName =
        variantNameOverride ??
        (baseline as any)?.variantName ??
        (baseline as any)?.name ??
        _variantId
    const isLatestRevision = baseline?.isLatestRevision
    // Keep the full deployment objects so downstream components (e.g., EnvironmentStatus)
    // can access env.name and other fields.
    const deployedIn = Array.isArray(deployment) ? (deployment as any[]) : []

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
                {!embedded && (
                    <SelectVariant
                        onChange={(value) => handleSwitchVariant?.(value)}
                        value={_variantId}
                    />
                )}
                {embedded && !baseline ? (
                    <div className="flex items-center gap-2 grow mr-4">
                        <span className="text-sm text-gray-700 truncate">{displayName as any}</span>
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
                        showBadges
                        hideName={!embedded}
                        variantName={displayName as any}
                        showRevisionAsTag={true}
                    />
                )}
            </div>
            {!embedded && (
                <div className="flex items-center gap-2">
                    <DeployVariantButton revisionId={variantId} />

                    <CommitVariantChangesButton
                        variantId={variantId}
                        label="Commit"
                        type="primary"
                        size="small"
                        data-tour="commit-button"
                    />

                    <PlaygroundVariantHeaderMenu variantId={variantId} />
                </div>
            )}
        </section>
    )
}

export default PlaygroundVariantConfigHeader
