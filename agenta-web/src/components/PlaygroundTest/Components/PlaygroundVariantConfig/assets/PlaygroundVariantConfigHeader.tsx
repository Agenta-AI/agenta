import {useCallback, useMemo, useState} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {Button, Select} from "antd"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import {ArrowsOut, FloppyDiskBack} from "@phosphor-icons/react"

import DeployButton from "@/components/PlaygroundTest/assets/DeployButton"
import Version from "@/components/PlaygroundTest/assets/Version"
import {PlaygroundStateData} from "@/components/PlaygroundTest/hooks/usePlayground/types"

const PlaygroundVariantHeaderMenu = dynamic(
    () => import("../../Menus/PlaygroundVariantHeaderMenu"),
    {ssr: false},
)
const DeployVariantModal = dynamic(() => import("../../Modals/DeployVariantModal"), {ssr: false})
const PromptFocusDrawer = dynamic(() => import("../../Drawers/PromptFocusDrawer"), {ssr: false})
const PromptComparisionFocusDrawer = dynamic(
    () => import("../../Drawers/PromptComparisionFocusDrawer"),
    {ssr: false},
)
const CommitVariantChangesModal = dynamic(() => import("../../Modals/CommitVariantChangesModal"), {
    ssr: false,
})
const VariantRenameModal = dynamic(() => import("../../Modals/VariantRenameModal"), {ssr: false})
const VariantResetChangesModal = dynamic(() => import("../../Modals/VariantResetChangesModal"), {
    ssr: false,
})
const DeleteVariantModal = dynamic(() => import("../../Modals/DeleteVariantModal"), {ssr: false})

const PlaygroundVariantConfigHeader: React.FC<any> = ({variantId, className, ...divProps}) => {
    const [isDeployOpen, setIsDeployOpen] = useState(false)
    const [isFocusMoodOpen, setIsFocusMoodOpen] = useState(false)
    const [isCommitModalOpen, setIsCommitModalOpen] = useState(false)
    const [isVariantRenameOpen, setIsVariantRenameOpen] = useState(false)
    const [isResetModalOpen, setIsResetModalOpen] = useState(false)
    const [isdeleteVariantModalOpen, setIsDeleteVariantModalOpen] = useState(false)
    const {variantsList, setSelectedVariant, variant} = usePlayground({
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
                <Button
                    icon={<ArrowsOut size={14} />}
                    type="text"
                    onClick={() => setIsFocusMoodOpen(true)}
                />

                <DeployButton onClick={() => setIsDeployOpen(true)} />

                <Button
                    icon={<FloppyDiskBack size={14} />}
                    type="primary"
                    onClick={() => setIsCommitModalOpen(true)}
                    size="small"
                >
                    Commit
                </Button>

                <PlaygroundVariantHeaderMenu
                    setIsDeployOpen={setIsDeployOpen}
                    setIsFocusMoodOpen={setIsFocusMoodOpen}
                    setIsCommitModalOpen={setIsCommitModalOpen}
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

            <CommitVariantChangesModal
                open={isCommitModalOpen}
                onCancel={() => setIsCommitModalOpen(false)}
                variantId={variantId}
            />

            <PromptFocusDrawer
                variantId={variantId}
                open={isFocusMoodOpen}
                onClose={() => setIsFocusMoodOpen(false)}
            />

            <DeployVariantModal
                open={isDeployOpen}
                onCancel={() => setIsDeployOpen(false)}
                variantId={variantId}
                environments={[]}
            />
        </section>
    )
}

export default PlaygroundVariantConfigHeader
