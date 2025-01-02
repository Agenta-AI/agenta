import {useState} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {Button, Select} from "antd"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import type {VariantHeaderProps, VariantActionButtonProps} from "../types"
import {Variant} from "@/lib/Types"
import {ArrowsOut, FloppyDiskBack} from "@phosphor-icons/react"

import DeployButton from "@/components/PlaygroundTest/assets/DeployButton"
import Version from "@/components/PlaygroundTest/assets/Version"
import PlaygroundVariantHeaderMenu from "./PlaygroundVariantHeaderMenu"

const DeployVariantModal = dynamic(() => import("../../Modals/DeployVariantModal"), {ssr: false})
const PlaygroundVariantFocusMood = dynamic(() => import("../../PlaygroundVariantFocusMood"), {
    ssr: false,
})
const CommitVariantChangesModal = dynamic(() => import("../../Modals/CommitVariantChangesModal"), {
    ssr: false,
})
const VariantRenameModal = dynamic(() => import("../../Modals/VariantRenameModal"), {ssr: false})
const VariantResetChangesModal = dynamic(() => import("../../Modals/VariantResetChangesModal"), {
    ssr: false,
})
const DeleteVariantModal = dynamic(() => import("../../Modals/DeleteVariantModal"), {ssr: false})

/**
 * Button to save variant changes when modifications are detected
 */
const PlaygroundVariantSaveButton: React.FC<VariantActionButtonProps> = ({variantId}) => {
    const {saveVariant, isDirty} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantSaveButton",
    })

    return isDirty ? (
        <Button type="primary" size="small" onClick={saveVariant}>
            Save
        </Button>
    ) : null
}

/**
 * Button to delete variant if it's not the last variant of an app
 */
const PlaygroundVariantDeleteButton: React.FC<VariantActionButtonProps> = ({variantId}) => {
    const {variantIds, deleteVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantDeleteButton",
    })

    return !!variantIds && variantIds.length > 1 ? (
        <Button type="default" color="primary" size="small" onClick={deleteVariant}>
            Delete
        </Button>
    ) : null
}

/**
 * PlaygroundVariantConfigHeader displays the variant name, revision,
 * and action buttons for saving/deleting the variant.
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantConfigHeader variantId="variant-123" />
 * ```
 */
const PlaygroundVariantConfigHeader: React.FC<VariantHeaderProps> = ({
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
        variantSelector: (variant) => ({
            variantName: variant?.variantName,
            revision: variant?.revision,
        }),
    })

    return (
        <section
            className={clsx(
                "w-full h-12 px-2.5",
                "flex items-center justify-between",
                "sticky top-0 z-[1]",
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
                        value: variant.variantId,
                    }))}
                />

                <Version revision={revision} />
            </div>
            <div className="flex items-center gap-2">
                {/* <PlaygroundVariantSaveButton variantId={variantId} />
                <PlaygroundVariantDeleteButton variantId={variantId} /> */}
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

            <PlaygroundVariantFocusMood
                variantId={variantId}
                open={isFocusMoodOpen}
                onClose={() => setIsFocusMoodOpen(false)}
            />

            <DeployVariantModal
                open={isDeployOpen}
                onCancel={() => setIsDeployOpen(false)}
                variant={variants?.[0] as Variant}
                environments={[]}
            />
        </section>
    )
}

export default PlaygroundVariantConfigHeader
