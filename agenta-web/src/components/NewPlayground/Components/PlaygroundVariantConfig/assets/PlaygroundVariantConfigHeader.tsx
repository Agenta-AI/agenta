import {useMemo} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {Select} from "antd"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

import Version from "@/components/NewPlayground/assets/Version"
import DeployVariantButton from "../../Modals/DeployVariantModal/assets/DeployVariantButton"
import PromptFocusButton from "../../Drawers/PromptFocusDrawer/assets/PromptFocusButton"
import PromptComparisonFocusButton from "../../Drawers/PromptComparisionFocusDrawer/assets/PromptComparisonFocusButton"
import CommitVariantChangesButton from "../../Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
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
    const {setSelectedVariant, variant, viewType, variants} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantConfigHeader",
    })

    const listOfVariants = useMemo(
        () =>
            variants?.map((variant) => ({
                label: variant.variantName,
                value: variant.id,
            })),
        [],
    )

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
                    value={variant?.id}
                    onChange={(value) => setSelectedVariant?.(value)}
                    placeholder="Select variant"
                    options={listOfVariants}
                    filterOption={(input, option) =>
                        (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                    }
                />

                <Version revision={variant?.revision as number} />
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
                />

                <PlaygroundVariantHeaderMenu variantId={variantId} />
            </div>
        </section>
    )
}

export default PlaygroundVariantConfigHeader
