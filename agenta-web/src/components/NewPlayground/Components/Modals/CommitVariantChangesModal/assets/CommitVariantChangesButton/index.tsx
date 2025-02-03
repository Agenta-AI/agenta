import {cloneElement, isValidElement, useState} from "react"
import dynamic from "next/dynamic"
import {Button} from "antd"
import {FloppyDiskBack} from "@phosphor-icons/react"
import {CommitVariantChangesButtonProps} from "./types"
const CommitVariantChangesModal = dynamic(() => import("../.."), {ssr: false})

const CommitVariantChangesButton = ({
    variantId,
    label,
    icon = true,
    children,
    ...props
}: CommitVariantChangesButtonProps) => {
    const [isDeployModalOpen, setIsDeployModalOpen] = useState(false)

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsDeployModalOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    type="text"
                    icon={icon && <FloppyDiskBack size={14} />}
                    onClick={() => setIsDeployModalOpen(true)}
                    {...props}
                >
                    {label}
                </Button>
            )}

            {isDeployModalOpen && (
                <CommitVariantChangesModal
                    open={isDeployModalOpen}
                    onCancel={() => setIsDeployModalOpen(false)}
                    variantId={variantId}
                />
            )}
        </>
    )
}

export default CommitVariantChangesButton
