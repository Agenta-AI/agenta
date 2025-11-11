import {useCallback} from "react"

import clsx from "clsx"
import dynamic from "next/dynamic"

import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {PlaygroundStateData} from "@/oss/components/Playground/hooks/usePlayground/types"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {atomStore, allRevisionsAtom} from "@/oss/lib/hooks/useStatelessVariants/state"

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
    ...divProps
}: PlaygroundVariantConfigHeaderProps) => {
    const classes = useStyles()
    const {deployedIn, isLatestRevision, variantRevision, isDirty, mutate, _variantId} =
        usePlayground({
            variantId,
            hookId: "PlaygroundVariantConfigHeader",
            stateSelector: useCallback(
                (state: PlaygroundStateData) => {
                    const variants = state.variants
                    const variant = variants.find((v) => v.id === variantId)
                    const isDirty = state.dirtyStates?.[variantId]

                    return {
                        isDirty,
                        _variantId: variant?.id,
                        variantRevision: variant?.revision,
                        deployedIn: variant?.deployedIn,
                        isLatestRevision: variant?.isLatestRevision,
                    }
                },
                [variantId],
            ),
        })

    const switchVariant = useCallback(
        (newVariantId: string) => {
            // Get all revisions from atom store
            const allRevisions = atomStore.get(allRevisionsAtom) || []

            mutate((clonedState) => {
                if (!clonedState) return clonedState

                // Update selected variants array by replacing the current variant with the new one
                const previousSelected = [...clonedState.selected]
                previousSelected.splice(
                    previousSelected.findIndex((id) => id === variantId),
                    1,
                    newVariantId,
                )
                clonedState.selected = previousSelected

                // Find the new variant in the atom store
                const revisionToAdd = allRevisions.find(
                    (rev: {id: string}) => rev.id === newVariantId,
                )

                // Add the new variant to the variants array if it's not already there
                if (revisionToAdd && !clonedState.variants.some((v) => v.id === newVariantId)) {
                    clonedState.variants = [...clonedState.variants, revisionToAdd]
                    console.log("Added variant from atom store in switchVariant:", newVariantId)
                }

                return clonedState
            })
        },
        [mutate, variantId],
    )

    return (
        <section
            className={clsx(
                "w-full h-[48px]",
                "flex items-center justify-between",
                "sticky top-0 z-[10]",
                classes.container,
                className,
            )}
            {...divProps}
        >
            <div className="flex items-center gap-2 grow">
                <SelectVariant onChange={(value) => switchVariant?.(value)} value={_variantId} />
                <VariantDetailsWithStatus
                    className="grow mr-4"
                    revision={variantRevision ?? null}
                    variant={{
                        deployedIn: deployedIn,
                        isLatestRevision: isLatestRevision ?? false,
                        isDraft: isDirty ?? false,
                    }}
                    showBadges
                    hideName
                />
            </div>
            <div className="flex items-center gap-2">
                <DeployVariantButton revisionId={variantId} />

                <CommitVariantChangesButton
                    variantId={variantId}
                    label="Commit"
                    type="primary"
                    size="small"
                    disabled={!isDirty}
                />

                <PlaygroundVariantHeaderMenu variantId={variantId} />
            </div>
        </section>
    )
}

export default PlaygroundVariantConfigHeader
