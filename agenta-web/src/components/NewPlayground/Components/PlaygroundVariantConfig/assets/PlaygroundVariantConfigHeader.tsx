import {useCallback, useMemo, useState} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {Select} from "antd"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

import Version from "@/components/NewPlayground/assets/Version"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import DeployVariantButton from "../../Modals/DeployVariantModal/assets/DeployVariantButton"
import PromptFocusButton from "../../Drawers/PromptFocusDrawer/assets/PromptFocusButton"
import PromptComparisonFocusButton from "../../Drawers/PromptComparisionFocusDrawer/assets/PromptComparisonFocusButton"
import CommitVariantChangesButton from "../../Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"

const PlaygroundVariantHeaderMenu = dynamic(
    () => import("../../Menus/PlaygroundVariantHeaderMenu"),
    {ssr: false},
)

const VariantRenameModal = dynamic(() => import("../../Modals/VariantRenameModal"), {ssr: false})
const VariantResetChangesModal = dynamic(() => import("../../Modals/VariantResetChangesModal"), {
    ssr: false,
})
const DeleteVariantModal = dynamic(() => import("../../Modals/DeleteVariantModal"), {ssr: false})

const PlaygroundVariantConfigHeader: React.FC<any> = ({variantId, className, ...divProps}) => {
    const [isVariantRenameOpen, setIsVariantRenameOpen] = useState(false)
    const [isResetModalOpen, setIsResetModalOpen] = useState(false)
    const [isdeleteVariantModalOpen, setIsDeleteVariantModalOpen] = useState(false)
    const {variantsList, setSelectedVariant, variant, viewType} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantConfigHeader",
        stateSelector: useCallback(
            (state: PlaygroundStateData) => ({
                variantsList: state.variants.map((variant) => ({
                    variantId: variant.id,
                    variantName: variant.variantName,
                    revision: variant?.revision,
                })),
            }),
            [],
        ),
    })

    const listOfVariants = useMemo(
        () =>
            variantsList?.map((variant) => ({
                label: variant.variantName,
                value: variant.variantId,
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
                className,
            )}
            {...divProps}
        >
            <div className="flex items-center gap-2">
                <Select
                    style={{width: 120}}
                    value={variant?.variantName}
                    onChange={(value) => setSelectedVariant?.(value)}
                    placeholder="Select variant"
                    options={listOfVariants}
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

                <PlaygroundVariantHeaderMenu
                    setIsResetModalOpen={setIsResetModalOpen}
                    setIsVariantRenameOpen={setIsVariantRenameOpen}
                    setIsDeleteVariantModalOpen={setIsDeleteVariantModalOpen}
                />
            </div>

            <DeleteVariantModal
                open={isdeleteVariantModalOpen}
                onCancel={() => setIsDeleteVariantModalOpen(false)}
                variantId={variantId}
            />

            <VariantResetChangesModal
                open={isResetModalOpen}
                onCancel={() => setIsResetModalOpen(false)}
            />

            <VariantRenameModal
                open={isVariantRenameOpen}
                onCancel={() => setIsVariantRenameOpen(false)}
                variantId={variantId}
            />
        </section>
    )
}

export default PlaygroundVariantConfigHeader
