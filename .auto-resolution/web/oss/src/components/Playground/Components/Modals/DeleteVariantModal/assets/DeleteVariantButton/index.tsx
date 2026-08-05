import {cloneElement, isValidElement} from "react"

import {Trash} from "@phosphor-icons/react"
import {Button} from "antd"
import {useSetAtom} from "jotai"

import {openDeleteVariantModalAtom} from "../../store/deleteVariantModalStore"

import {DeleteVariantButtonProps} from "./types"

const DeleteVariantButton = ({
    variantId,
    label,
    icon = true,
    children,
    ...props
}: DeleteVariantButtonProps) => {
    const openDeleteModal = useSetAtom(openDeleteVariantModalAtom)
    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => openDeleteModal(variantId),
                    },
                )
            ) : (
                <Button
                    type="text"
                    icon={icon && <Trash size={14} />}
                    onClick={() => openDeleteModal(variantId)}
                    {...props}
                >
                    {label}
                </Button>
            )}
        </>
    )
}

export default DeleteVariantButton
