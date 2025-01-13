import {isValidElement, cloneElement, useState, useTransition, useCallback, useMemo} from "react"

import {message} from "antd"

import usePlayground from "../../hooks/usePlayground"
import AddButton from "../../assets/AddButton"
import NewVariantModal from "../NewVariantModal"

import {NewVariantButtonProps} from "./types"

/**
 * Button to add a new variant
 */
const NewVariantButton = ({children}: NewVariantButtonProps) => {
    const [displayModal, _setDisplayModal] = useState(false)
    const [newVariantName, setNewVariantName] = useState("")
    const [baseVariantName, setBaseVariantName] = useState("")
    const [, startTransition] = useTransition()

    // Wrap modal state updates in transitions to prevent UI blocking
    const setDisplayModal = useCallback((value: boolean) => {
        startTransition(() => {
            _setDisplayModal(value)
        })
    }, [])

    const {addVariant, variants} = usePlayground()

    // Track the selected base variant for creating new variants
    const baseVariant = useMemo(() => {
        return (variants || []).find((variant) => variant.variantName === baseVariantName)
    }, [variants, baseVariantName])

    // Validate and create new variants based on selected template
    const addNewVariant = useCallback(() => {
        if (!baseVariant) {
            message.error("Template variant not found. Please choose a valid variant.")
            return
        }

        addVariant?.({
            baseVariantName: baseVariant.variantName,
            newVariantName: newVariantName,
        })
    }, [baseVariant, newVariantName, addVariant])

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setDisplayModal(true)
                        },
                    },
                )
            ) : (
                <AddButton
                    label={"Variant"}
                    onClick={() => {
                        setDisplayModal(true)
                    }}
                />
            )}
            <NewVariantModal
                variants={variants || []}
                isModalOpen={displayModal}
                setIsModalOpen={setDisplayModal}
                newVariantName={newVariantName}
                setNewVariantName={setNewVariantName}
                addTab={addNewVariant}
                setTemplateVariantName={setBaseVariantName}
            />
        </>
    )
}

export default NewVariantButton
