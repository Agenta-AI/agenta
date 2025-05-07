import {useCallback, useState} from "react"

import {FloppyDiskBack} from "@phosphor-icons/react"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {getAllRevisionsLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import {CommitVariantChangesModalProps, SelectedCommitType} from "./types"
const CommitVariantChangesModalContent = dynamic(
    () => import("./assets/CommitVariantChangesModalContent"),
    {ssr: false},
)

const CommitVariantChangesModal: React.FC<CommitVariantChangesModalProps> = ({
    variantId,
    onSuccess,
    ...props
}) => {
    const {saveVariant, addVariant, baseRevisionId, isMutating, variantName} = usePlayground({
        variantId,
        hookId: "CommitVariantChangesModal",
        variantSelector: useCallback(
            (variant: EnhancedVariant) => {
                return {
                    isMutating: variant.__isMutating,
                    variantName: variant.variantName,
                    baseRevisionId: variant.id,
                }
            },
            [variantId],
        ),
    })

    const [selectedCommitType, setSelectedCommitType] = useState<SelectedCommitType>({
        type: "version",
    })
    const [note, setNote] = useState("")

    const onClose = useCallback(() => {
        props.onCancel?.({} as any)
        setSelectedCommitType({
            type: "version",
        })
        setNote("")
    }, [])

    const onSaveVariantChanges = useCallback(async () => {
        if (selectedCommitType?.type === "version") {
            await saveVariant?.(note, (variant) => {
                onSuccess?.({revisionId: variant?._revisionId})
            })
        } else if (selectedCommitType?.type === "variant" && selectedCommitType?.name) {
            addVariant?.({
                note,
                baseVariantName: variantName,
                newVariantName: selectedCommitType?.name as string,
                callback: (variant, state) => {
                    state.selected = [
                        ...state.selected.filter((id) => id !== baseRevisionId),
                        variant.id,
                    ]

                    const originalBaseVariant = getAllRevisionsLazy().find(
                        (v) => v.id === baseRevisionId,
                    ) as EnhancedVariant

                    const newVariants = [...state.variants]
                    newVariants.splice(
                        newVariants.findIndex((v) => v.id === baseRevisionId),
                        1,
                        originalBaseVariant,
                    )

                    onSuccess?.({
                        revisionId: variant?._revisionId,
                        variantId: variant._parentVariant.variantId,
                    })

                    state.variants = newVariants

                    return state
                },
            })
        }

        onClose()
    }, [selectedCommitType, baseRevisionId, saveVariant, addVariant, note])

    return (
        <EnhancedModal
            title="Commit changes"
            onCancel={onClose}
            okText="Commit"
            confirmLoading={isMutating}
            onOk={onSaveVariantChanges}
            okButtonProps={{
                icon: <FloppyDiskBack size={14} />,
                disabled:
                    !selectedCommitType?.type ||
                    (selectedCommitType?.type == "variant" && !selectedCommitType?.name),
            }}
            classNames={{footer: "flex items-center justify-end"}}
            afterClose={() => onClose()}
            {...props}
        >
            <CommitVariantChangesModalContent
                variantId={variantId}
                note={note}
                setNote={setNote}
                setSelectedCommitType={setSelectedCommitType}
                selectedCommitType={selectedCommitType}
            />
        </EnhancedModal>
    )
}

export default CommitVariantChangesModal
