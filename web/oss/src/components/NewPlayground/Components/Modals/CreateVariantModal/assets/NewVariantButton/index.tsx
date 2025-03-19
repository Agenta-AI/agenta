import {isValidElement, cloneElement, useState, useTransition, useCallback} from "react"

import {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"

import CreateVariantModal from "../.."
import AddButton from "../../../../../assets/AddButton"
import usePlayground from "../../../../../hooks/usePlayground"
import {message} from "../../../../../state/messageContext"

import {NewVariantButtonProps} from "./types"

/**
 * Button to add a new variant
 */
const NewVariantButton = ({children, ...buttonProps}: NewVariantButtonProps) => {
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

    const {addVariant, baseVariant, variantOptions} = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const baseVariant = state.variants.find(
                    (variant) => variant.variantName === baseVariantName,
                )
                return {
                    baseVariant,
                    variantOptions: state.variants.map((variant) => {
                        return {
                            id: variant.id,
                            variantName: variant.variantName,
                        }
                    }),
                }
            },
            [baseVariantName],
        ),
    })

    // Validate and create new variants based on selected template
    const addNewVariant = useCallback(() => {
        if (!baseVariant) {
            message.error("Template variant not found. Please choose a valid variant.")
            return
        }

        addVariant?.({
            baseVariantName: baseVariant.variantName,
            newVariantName: newVariantName,
            callback: (variant, state) => {
                state.selected = [...state.selected, variant.id]
            },
        })
    }, [baseVariant, addVariant, newVariantName])

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
                    {...buttonProps}
                />
            )}
            <CreateVariantModal
                variants={variantOptions}
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
