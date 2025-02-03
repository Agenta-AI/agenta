import {cloneElement, isValidElement, useState} from "react"
import dynamic from "next/dynamic"
import {Button} from "antd"
import {Trash} from "@phosphor-icons/react"
import {DeleteVariantButtonProps} from "./types"
const DeleteVariantModal = dynamic(() => import("../.."), {ssr: false})

const DeleteVariantButton = ({
    variantId,
    label,
    icon = true,
    children,
    ...props
}: DeleteVariantButtonProps) => {
    const [isDeleteVariantModalOpen, setIsDeleteVariantModalOpen] = useState(false)

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsDeleteVariantModalOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    type="text"
                    icon={icon && <Trash size={14} />}
                    onClick={() => setIsDeleteVariantModalOpen(true)}
                    {...props}
                >
                    {label}
                </Button>
            )}

            {isDeleteVariantModalOpen && (
                <DeleteVariantModal
                    open={isDeleteVariantModalOpen}
                    onCancel={() => setIsDeleteVariantModalOpen(false)}
                    variantId={variantId}
                />
            )}
        </>
    )
}

export default DeleteVariantButton
