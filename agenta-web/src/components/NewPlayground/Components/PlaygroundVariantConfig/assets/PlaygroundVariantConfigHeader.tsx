import {useCallback} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {Select} from "antd"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

import Version from "@/components/NewPlayground/assets/Version"
import DeployVariantButton from "../../Modals/DeployVariantModal/assets/DeployVariantButton"
import CommitVariantChangesButton from "../../Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import {PlaygroundVariantConfigHeaderProps} from "./types"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {useStyles} from "./styles"

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
    const {variantOptions, mutate, _variantId, variantRevision, isDirty} = usePlayground({
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
                    variantOptions: (variants || []).map((variant) => ({
                        label: variant.variantName,
                        value: variant.id,
                        disabled: state.selected.includes(variant.id),
                    })),
                }
            },
            [variantId],
        ),
    })

    const switchVariant = useCallback(
        (newVariantId: string) => {
            mutate((clonedState) => {
                if (!clonedState) return clonedState
                const previousSelected = [...clonedState.selected]
                previousSelected.splice(
                    previousSelected.findIndex((id) => id === variantId),
                    1,
                    newVariantId,
                )
                clonedState.selected = previousSelected
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
                "sticky top-0 z-[1]",
                classes.container,
                className,
            )}
            {...divProps}
        >
            <div className="flex items-center gap-2">
                <Select
                    showSearch
                    style={{width: 120}}
                    value={_variantId}
                    onChange={(value) => switchVariant?.(value)}
                    size="small"
                    placeholder="Select variant"
                    options={variantOptions}
                    filterOption={(input, option) =>
                        (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                    }
                />

                <Version revision={variantRevision as number} />
            </div>
            <div className="flex items-center gap-2">
                <DeployVariantButton variantId={variantId} />

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
