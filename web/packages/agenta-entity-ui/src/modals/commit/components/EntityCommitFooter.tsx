/**
 * EntityCommitFooter Component
 *
 * Modal footer with cancel and commit buttons.
 */

import {useCallback} from "react"

import {ModalFooter} from "@agenta/ui/components/modal"

interface EntityCommitFooterProps {
    /** Callback when modal is closed/cancelled */
    onClose: () => void
    /** Callback when commit is confirmed */
    onConfirm: () => Promise<void> | void
    /** Loading state */
    isLoading: boolean
    /** Whether commit can proceed */
    canProceed: boolean
    /** Confirm button label */
    confirmLabel?: string
}

/**
 * EntityCommitFooter
 *
 * Footer with:
 * - Cancel button
 * - Commit button (disabled if no message or cannot commit)
 * - Loading state during commit
 */
export function EntityCommitFooter({
    onClose,
    onConfirm,
    isLoading,
    canProceed,
    confirmLabel = "Commit",
}: EntityCommitFooterProps) {
    const handleCommit = useCallback(async () => {
        await onConfirm()
    }, [onConfirm])

    return (
        <ModalFooter
            onCancel={onClose}
            onConfirm={handleCommit}
            confirmLabel={confirmLabel}
            isLoading={isLoading}
            canConfirm={canProceed}
        />
    )
}
