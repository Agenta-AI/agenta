import {type FC, useState, useCallback} from "react"

import groupBy from "lodash/groupBy"
import dynamic from "next/dynamic"

import {message} from "@/oss/components/AppMessageContext"
import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import usePlayground from "../../../hooks/usePlayground"
import {PlaygroundStateData} from "../../../hooks/usePlayground/types"

import {CreateVariantModalProps} from "./types"

const CreateVariantModalContent = dynamic(() => import("./assets/CreateVariantModalContent"), {
    ssr: false,
})

const CreateVariantModal: FC<CreateVariantModalProps> = ({
    isModalOpen,
    setIsModalOpen: propsSetIsModalOpen,
}) => {
    const [isInputValid, setIsInputValid] = useState(false)
    const [nameExists, setNameExists] = useState(false)
    const [isCompareMode, setIsCompareMode] = useState(false)
    const [newVariantName, setNewVariantName] = useState("")
    const [baseVariantName, setBaseVariantName] = useState("default")
    const [note, setNote] = useState("")

    const {addVariant, baseVariant, variantOptions} = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const parents = groupBy(state.availableRevisions, "variantId")
                const baseVariant = (state.availableRevisions || []).find(
                    (variant) => variant.variantName === baseVariantName,
                )

                return {
                    baseVariant: {
                        id: baseVariant?.variantId,
                        variantName: baseVariant?.variantName,
                    },
                    variantOptions: Object.values(parents).map((variantRevisions) => {
                        const rev = variantRevisions[0]
                        return {
                            id: rev.id,
                            variantName: rev.variantName,
                        }
                    }),
                }
            },
            [baseVariantName],
        ),
    })
    // Validate and create new variants based on selected template
    const addNewVariant = useCallback(() => {
        if (!baseVariant || !baseVariant.variantName) {
            message.error("Template variant not found. Please choose a valid variant.")
            return
        }

        addVariant?.({
            baseVariantName: baseVariant.variantName,
            newVariantName: newVariantName,
            note: note,
            callback: (variant, state) => {
                if (isCompareMode) {
                    state.selected = [...state.selected, variant.id]
                    state.variants = [...state.variants, variant]
                } else {
                    // remove existing variant

                    state.selected = [variant.id]
                    state.variants = [variant]
                }
            },
        })
    }, [isCompareMode, baseVariant, addVariant, newVariantName])

    const setIsModalOpen = useCallback(
        (value: boolean) => {
            if (!value) {
                setNewVariantName("")
                setBaseVariantName("default")
                setNameExists((oldValue) => false)
                setIsCompareMode(false)
                setNote("")
            }

            propsSetIsModalOpen(value)
        },
        [propsSetIsModalOpen, setNewVariantName, setBaseVariantName],
    )

    return (
        <EnhancedModal
            title="Create a new variant"
            open={isModalOpen}
            onOk={() => {
                if (isInputValid) {
                    setIsModalOpen(false)
                    addNewVariant()
                }
            }}
            okText="Confirm"
            onCancel={() => setIsModalOpen(false)}
            okButtonProps={{disabled: !isInputValid || !baseVariantName}} // Disable OK button if input is not valid
        >
            <CreateVariantModalContent
                setTemplateVariantName={setBaseVariantName}
                templateVariantName={baseVariantName}
                setIsInputValid={setIsInputValid}
                newVariantName={newVariantName}
                setNewVariantName={setNewVariantName}
                setNameExists={setNameExists}
                variants={variantOptions}
                nameExists={nameExists}
                note={note}
                setNote={setNote}
                setIsCompareMode={setIsCompareMode}
                isCompareMode={isCompareMode}
            />
        </EnhancedModal>
    )
}

export default CreateVariantModal
