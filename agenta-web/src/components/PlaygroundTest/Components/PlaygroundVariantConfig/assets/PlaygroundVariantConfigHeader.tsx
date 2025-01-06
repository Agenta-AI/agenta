import {useCallback, useState} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {Button, Select} from "antd"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import {Variant} from "@/lib/Types"
import {ArrowsOut, FloppyDiskBack} from "@phosphor-icons/react"

import DeployButton from "@/components/PlaygroundTest/assets/DeployButton"
import Version from "@/components/PlaygroundTest/assets/Version"
import { EnhancedVariant } from "@/components/PlaygroundTest/assets/utilities/transformer/types"

const PlaygroundVariantHeaderMenu = dynamic(
    () => import("../../Menus/PlaygroundVariantHeaderMenu"),
    {ssr: false},
)
const DeployVariantModal = dynamic(() => import("../../Modals/DeployVariantModal"), {ssr: false})
const PlaygroundPromptFocusDrawer = dynamic(
    () => import("../../Drawers/PlaygroundPromptFocusDrawer"),
    {ssr: false},
)
const PlaygroundComparisionPromptFocusDrawer = dynamic(
    () => import("../../Drawers/PlaygroundComparisionPromptFocusDrawer"),
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

const PlaygroundVariantConfigHeader: React.FC<any> = ({
    variantId,
    className,
    ...divProps
}) => {
    const [isDeployOpen, setIsDeployOpen] = useState(false)
    const [isFocusMoodOpen, setIsFocusMoodOpen] = useState(false)
    const [isCommitModalOpen, setIsCommitModalOpen] = useState(false)
    const [isVariantRenameOpen, setIsVariantRenameOpen] = useState(false)
    const [isResetModalOpen, setIsResetModalOpen] = useState(false)
    const [isdeleteVariantModalOpen, setIsDeleteVariantModalOpen] = useState(false)
    const {variantName, revision, variants} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantConfigHeader",
        variantSelector: useCallback(
            (variant: EnhancedVariant) => ({
                variantName: variant?.variantName,
                revision: variant?.revision,
            }),
            [],
        ),
    })

    return (
        <section
            className={clsx(
                "w-full h-[48px] px-2.5",
                "flex items-center justify-between",
                "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                "sticky top-0 z-[1]",
                "bg-white",
                className,
            )}
            {...divProps}
        >
            <div className="flex items-center gap-2">
                <Select
                    style={{width: 120}}
                    value={variantId}
                    placeholder="Select a person"
                    options={variants?.map((variant) => ({
                        label: variant.variantName,
                        value: variant.baseId,
                    }))}
                />

                <Version revision={revision} />
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
            />

            <VariantResetChangesModal
                open={isResetModalOpen}
                onCancel={() => setIsResetModalOpen(false)}
            />

            <VariantRenameModal
                open={isVariantRenameOpen}
                onCancel={() => setIsVariantRenameOpen(false)}
            />

            <CommitVariantChangesModal
                open={isCommitModalOpen}
                onCancel={() => setIsCommitModalOpen(false)}
            />

            <PlaygroundPromptFocusDrawer
                variantId={variantId}
                open={isFocusMoodOpen}
                onClose={() => setIsFocusMoodOpen(false)}
            />

            <DeployVariantModal
                open={isDeployOpen}
                onCancel={() => setIsDeployOpen(false)}
                variant={variants?.[0] as any}
                environments={[]}
            />
        </section>
    )
}

export default PlaygroundVariantConfigHeader
