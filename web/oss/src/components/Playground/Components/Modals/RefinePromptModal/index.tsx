/**
 * RefinePromptModal - Modal for AI-powered prompt refinement
 *
 * This modal provides a two-panel interface:
 * - Left panel: Instructions/guidelines input with conversation-like display
 * - Right panel: Refined prompt preview with diff toggle
 */

import {useCallback, useEffect} from "react"

import {EnhancedModal} from "@agenta/ui"
import {useAtom, useSetAtom} from "jotai"

import RefinePromptModalContent from "./assets/RefinePromptModalContent"
import {refineModalOpenAtomFamily, resetRefineModalAtomFamily} from "./store/refinePromptStore"
import type {RefinePromptModalProps} from "./types"

const RefinePromptModal: React.FC<RefinePromptModalProps> = ({
    open,
    onClose,
    variantId,
    promptId,
}) => {
    const [isOpen, setIsOpen] = useAtom(refineModalOpenAtomFamily(promptId))
    const resetModal = useSetAtom(resetRefineModalAtomFamily(promptId))

    // Sync external open prop with internal state
    useEffect(() => {
        setIsOpen(open)
    }, [open, setIsOpen])

    const handleClose = useCallback(() => {
        onClose()
    }, [onClose])

    const handleAfterClose = useCallback(() => {
        resetModal()
    }, [resetModal])

    return (
        <EnhancedModal
            open={isOpen}
            onCancel={handleClose}
            afterClose={handleAfterClose}
            title={null}
            footer={null}
            closable={false}
            width={1040}
            styles={{
                container: {
                    height: "min(90vh, 720px)",
                },
                body: {
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    overscrollBehavior: "contain",
                },
            }}
            destroyOnClose
        >
            <RefinePromptModalContent
                variantId={variantId}
                promptId={promptId}
                onClose={handleClose}
            />
        </EnhancedModal>
    )
}

export default RefinePromptModal
