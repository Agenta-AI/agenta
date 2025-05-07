import {isValidElement, cloneElement, useState, useTransition, useCallback} from "react"

import CreateVariantModal from "../.."
import AddButton from "../../../../../assets/AddButton"
import {NewVariantButtonProps} from "../types"

/**
 * Button to add a new variant
 */
const NewVariantButton = ({
    children,
    onClick: propsHandleClick,
    label = "Variant",
    ...buttonProps
}: NewVariantButtonProps) => {
    const [displayModal, _setDisplayModal] = useState(false)
    const [, startTransition] = useTransition()

    // Wrap modal state updates in transitions to prevent UI blocking
    const setDisplayModal = useCallback((value: boolean) => {
        startTransition(() => {
            _setDisplayModal(value)
        })
    }, [])

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            propsHandleClick?.()
                            setDisplayModal(true)
                        },
                        ...buttonProps,
                    },
                )
            ) : (
                <AddButton
                    label={label}
                    onClick={() => {
                        propsHandleClick?.()
                        setDisplayModal(true)
                    }}
                    {...buttonProps}
                />
            )}
            <CreateVariantModal isModalOpen={displayModal} setIsModalOpen={setDisplayModal} />
        </>
    )
}

export default NewVariantButton
