import {cloneElement, isValidElement, useState} from "react"

import {FloppyDiskBack} from "@phosphor-icons/react"
import {Button} from "antd"
import dynamic from "next/dynamic"

import {CommitVariantChangesButtonProps} from "../types"
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

            {variantId ? (
                <CommitVariantChangesModal
                    open={isDeployModalOpen}
                    onCancel={() => setIsDeployModalOpen(false)}
                    variantId={variantId}
                />
            ) : null}
        </>
    )
}

export default CommitVariantChangesButton
