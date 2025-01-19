import {useCallback, useMemo} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {Select} from "antd"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

import Version from "@/components/NewPlayground/assets/Version"
import DeployVariantButton from "../../Modals/DeployVariantModal/assets/DeployVariantButton"
import PromptFocusButton from "../../Drawers/PromptFocusDrawer/assets/PromptFocusButton"
import PromptComparisonFocusButton from "../../Drawers/PromptComparisonFocusDrawer/assets/PromptComparisonFocusButton"
import CommitVariantChangesButton from "../../Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import {PlaygroundVariantConfigHeaderProps} from "./types"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"

const PlaygroundVariantHeaderMenu = dynamic(
    () => import("../../Menus/PlaygroundVariantHeaderMenu"),
    {ssr: false},
)

const PlaygroundVariantConfigHeader = ({
    variantId,
    className,
    ...divProps
}: PlaygroundVariantConfigHeaderProps) => {
    const {variantOptions, setSelectedVariant, _variantId, variantRevision, viewType, isDirty} =
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
                        variantOptions: (variants || []).map((variant) => ({
                            label: variant.variantName,
                            value: variant.id,
                        })),
                    }
                },
                [variantId],
            ),
        })

    return (
        <section
            className={clsx(
                "w-full h-[48px] px-2.5",
                "flex items-center justify-between",
                "sticky top-0 z-[1]",
                "bg-white",
                "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                className,
            )}
            {...divProps}
        >
            <div className="flex items-center gap-2">
                <Select
                    showSearch
                    style={{width: 120}}
                    value={_variantId}
                    onChange={(value) => setSelectedVariant?.(value)}
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
                {viewType == "comparison" ? (
                    <PromptComparisonFocusButton variantId={variantId} />
                ) : (
                    <PromptFocusButton variantId={variantId} />
                )}

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
