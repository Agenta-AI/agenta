/**
 * EntityCommitModal Component
 *
 * Performance-optimized modal shell for committing entity changes.
 * Uses EnhancedModal for lazy rendering and consistent styling.
 */

import {useEffect, useCallback} from "react"

import {EnhancedModal} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"

import type {EntityReference} from "../../types"
import {
    commitModalOpenAtom,
    commitModalContextAtom,
    resetCommitModalAtom,
    openCommitModalAtom,
    closeCommitModalAtom,
} from "../state"

import {EntityCommitContent} from "./EntityCommitContent"
import {EntityCommitFooter} from "./EntityCommitFooter"
import {EntityCommitTitle} from "./EntityCommitTitle"

export interface EntityCommitModalProps {
    /** External control - override atom state */
    open?: boolean
    /** Callback when modal closes */
    onClose?: () => void
    /** Entity to commit (alternative to using atoms) */
    entity?: EntityReference
    /** Initial commit message */
    initialMessage?: string
    /** Callback after successful commit */
    onSuccess?: (result: {newRevisionId?: string}) => void
}

/**
 * EntityCommitModal
 *
 * A performance-optimized modal for committing entity changes.
 *
 * Features:
 * - Lazy rendering: content only mounts when modal opens
 * - Atom-based state: no prop drilling
 * - Adapter pattern: works with any registered entity type
 *
 * Usage:
 * ```tsx
 * // Method 1: Using atoms (recommended)
 * const openModal = useSetAtom(openCommitModalAtom)
 * openModal({type: 'revision', id: revisionId, name: revisionName})
 *
 * // Render modal anywhere in tree
 * <EntityCommitModal />
 *
 * // Method 2: External control
 * <EntityCommitModal
 *   open={isOpen}
 *   entity={{type: 'revision', id: revisionId}}
 *   onClose={() => setIsOpen(false)}
 *   onSuccess={(result) => console.log('Committed!')}
 * />
 * ```
 */
export function EntityCommitModal({
    open: externalOpen,
    onClose,
    entity: externalEntity,
    initialMessage,
    onSuccess,
}: EntityCommitModalProps) {
    const internalOpen = useAtomValue(commitModalOpenAtom)
    const context = useAtomValue(commitModalContextAtom)
    const resetModal = useSetAtom(resetCommitModalAtom)
    const openModal = useSetAtom(openCommitModalAtom)
    const closeModal = useSetAtom(closeCommitModalAtom)

    // Determine actual open state
    const isOpen = externalOpen ?? internalOpen

    // Check if diff data is available for dynamic width
    const hasDiffData = context?.diffData?.original && context?.diffData?.modified

    // Initialize with external entity if provided
    useEffect(() => {
        if (externalOpen && externalEntity) {
            openModal(externalEntity, initialMessage)
        }
    }, [externalOpen, externalEntity, initialMessage, openModal])

    const handleClose = useCallback(() => {
        closeModal()
        onClose?.()
    }, [closeModal, onClose])

    const handleAfterClose = useCallback(() => {
        resetModal()
    }, [resetModal])

    const handleSuccess = useCallback(
        (result: {newRevisionId?: string}) => {
            onSuccess?.(result)
        },
        [onSuccess],
    )

    return (
        <EnhancedModal
            open={isOpen}
            onCancel={handleClose}
            afterClose={handleAfterClose}
            title={<EntityCommitTitle />}
            footer={<EntityCommitFooter onClose={handleClose} onSuccess={handleSuccess} />}
            width={hasDiffData ? 900 : 520}
            styles={{
                body: {
                    maxHeight: "calc(80vh - 110px)",
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                },
            }}
        >
            <EntityCommitContent />
        </EnhancedModal>
    )
}
