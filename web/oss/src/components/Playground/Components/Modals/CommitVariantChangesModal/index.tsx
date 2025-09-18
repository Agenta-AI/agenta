import {useCallback, useEffect, useState} from "react"

import {FloppyDiskBack} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {
    revisionListAtom,
    saveVariantMutationAtom,
    createVariantMutationAtom,
    selectedVariantsAtom,
    variantByRevisionIdAtomFamily,
} from "@/oss/components/Playground/state/atoms"

import {CommitVariantChangesModalProps, SelectedCommitType} from "./assets/types"
const CommitVariantChangesModalContent = dynamic(
    () => import("./assets/CommitVariantChangesModalContent"),
    {ssr: false},
)

const CommitVariantChangesModal: React.FC<CommitVariantChangesModalProps> = ({
    variantId,
    onSuccess,
    commitType,
    ...props
}) => {
    // Get variant metadata from revision list
    const revisions = useAtomValue(revisionListAtom)
    const variant = revisions?.find((rev: any) => rev.id === variantId)

    // Extract values from variant
    const variantName = variant?.variantName

    // Get mutation functions
    const saveVariant = useSetAtom(saveVariantMutationAtom)
    const createVariant = useSetAtom(createVariantMutationAtom)

    // Track loading state for mutations
    const [isMutating, setIsMutating] = useState(false)
    // Defer closing the modal until the UI actually swaps to target
    const [waitForRevisionId, setWaitForRevisionId] = useState<string | undefined>(undefined)
    const [waitForVariantId, setWaitForVariantId] = useState<string | undefined>(undefined)

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

    // Observe current selected revision(s) to know when swap completes
    const selectedRevisionIds = useAtomValue(selectedVariantsAtom)
    const currentSelectedRevisionId = selectedRevisionIds?.[0] || ""
    const currentSelectedVariant = useAtomValue(
        variantByRevisionIdAtomFamily(currentSelectedRevisionId),
    )

    // Close when the swap we wait for is satisfied
    useEffect(() => {
        if (waitForRevisionId && selectedRevisionIds?.includes(waitForRevisionId)) {
            setIsMutating(false)
            onClose()
            setWaitForRevisionId(undefined)
        } else if (
            waitForVariantId &&
            currentSelectedVariant?._parentVariant?.id &&
            currentSelectedVariant?._parentVariant?.id === waitForVariantId
        ) {
            setIsMutating(false)
            onClose()
            setWaitForVariantId(undefined)
        }
    }, [
        selectedRevisionIds,
        currentSelectedVariant?._parentVariant?.id,
        waitForRevisionId,
        waitForVariantId,
    ])

    const onSaveVariantChanges = useCallback(async () => {
        try {
            setIsMutating(true)

            if (selectedCommitType?.type === "version") {
                const result = await saveVariant?.({
                    variantId,
                    note,
                    commitType,
                })

                if (result?.success) {
                    // Reset commit-ready state after successful commit
                    onSuccess?.({
                        revisionId: result.variant?.id,
                        variantId: result.variant?.variantId,
                    })

                    // Wait for the selected revision to reflect the new revision id
                    if (result.variant?.id) {
                        setWaitForRevisionId(result.variant.id)
                    }
                }
            } else if (selectedCommitType?.type === "variant" && selectedCommitType?.name) {
                const result = await createVariant?.({
                    revisionId: variantId,
                    baseVariantName: variantName || "",
                    newVariantName: selectedCommitType?.name as string,
                    note,
                    callback: (newVariant, state) => {
                        // For new variant creation, switch to display ONLY the newly created variant
                        // This is different from revision creation where we stay on the same variant
                        state.selected = [newVariant.id]
                        state.variants = [newVariant.id]
                    },
                })

                if (result?.success) {
                    // For variant creation, we get a variant object back, not a revision
                    // The variant creation atom handles finding the matching revision and updating the URL
                    // We just need to pass the variant ID to the onSuccess callback
                    const newVariantId = result.variant?.variant_id

                    // The onSuccess callback doesn't need a revisionId for variant creation
                    // since the variant creation atom handles the UI switch via URL update
                    onSuccess?.({
                        revisionId: undefined, // Will be determined by variant creation atom
                        variantId: newVariantId,
                    })

                    // Wait for the selected revision to belong to the newly created variant id
                    if (newVariantId) {
                        setWaitForVariantId(newVariantId)
                    }
                }
            }
        } catch (error) {
            console.error("Failed to commit variant changes:", error)
            // TODO: Show error message to user
        } finally {
            // Only close immediately if we're not waiting for the UI to reflect the swap
            // (Keep isMutating true while waiting to prevent interactions)
            if (!waitForRevisionId && !waitForVariantId) {
                setIsMutating(false)
                onClose()
            }
        }

        onClose()
    }, [selectedCommitType, saveVariant, createVariant, note, variantName, onSuccess])

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
            width="100%"
            style={{
                maxWidth: "calc(250px + 65ch)",
            }}
            {...props}
        >
            <CommitVariantChangesModalContent
                variantId={variantId}
                note={note}
                setNote={setNote}
                setSelectedCommitType={setSelectedCommitType}
                selectedCommitType={selectedCommitType}
                commitType={commitType}
            />
        </EnhancedModal>
    )
}

export default CommitVariantChangesModal
