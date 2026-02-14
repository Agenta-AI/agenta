import {type FC, useState, useCallback, useMemo} from "react"

import {appRevisionsWithDraftsAtomFamily} from "@agenta/entities/legacyAppRevision"
import {playgroundController} from "@agenta/playground"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"
import groupBy from "lodash/groupBy"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {selectedAppIdAtom} from "@/oss/state/app/selectors/app"

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
    const [isSubmitting, setIsSubmitting] = useState(false)

    const rawAppId = useAtomValue(selectedAppIdAtom)
    const appId = typeof rawAppId === "string" ? rawAppId : null
    const revisions = useAtomValue(appRevisionsWithDraftsAtomFamily(appId || ""))
    const createVariant = useSetAtom(playgroundController.actions.createVariant)
    const currentSelectedVariants = useAtomValue(playgroundController.selectors.entityIds())

    const {baseVariant, variantOptions} = useMemo(() => {
        const parents = groupBy(revisions, "variantId")
        const baseVariant = revisions.find((variant) => variant.variantName === baseVariantName)

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
    }, [revisions, baseVariantName])
    // Validate and create new variants based on selected template
    const addNewVariant = useCallback(async () => {
        if (!baseVariant || !baseVariant.variantName) {
            message.error("Template variant not found. Please choose a valid variant.")
            return
        }

        try {
            setIsSubmitting(true)
            const result = await createVariant({
                baseVariantName: baseVariant.variantName,
                newVariantName: newVariantName,
                note: note,
                callback: (newRevision, state) => {
                    if (isCompareMode) {
                        // Add new variant to existing selection (comparison mode)
                        state.selected = [...currentSelectedVariants, newRevision.id]
                    } else {
                        // Replace current selection with new variant (single mode)
                        state.selected = [newRevision.id]
                    }
                },
            })

            if (!result || !result.success) {
                const errMsg = result?.error || "Failed to create variant"
                message.error(errMsg)
                return
            }

            // Close modal on success (now that UI can render the new variant)
            propsSetIsModalOpen(false)
            message.success(`Variant "${newVariantName}" created successfully`)
        } catch (error) {
            message.error(`Failed to create variant: ${error.message}`)
        } finally {
            setIsSubmitting(false)
        }
    }, [
        isCompareMode,
        baseVariant,
        createVariant,
        newVariantName,
        note,
        currentSelectedVariants,
        propsSetIsModalOpen,
    ])

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
                    addNewVariant()
                }
            }}
            okText="Confirm"
            onCancel={() => setIsModalOpen(false)}
            okButtonProps={{
                disabled: !isInputValid || !baseVariantName || isSubmitting,
                loading: isSubmitting,
            }} // Disable OK button if input is not valid
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
