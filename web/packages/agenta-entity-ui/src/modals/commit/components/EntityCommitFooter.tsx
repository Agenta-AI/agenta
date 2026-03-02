/**
 * EntityCommitFooter Component
 *
 * Modal footer with cancel and commit buttons.
 */

import {useCallback} from "react"

import {message} from "@agenta/ui/app-message"
import {ModalFooter} from "@agenta/ui/components/modal"
import {useAtomValue, useSetAtom} from "jotai"

import {commitModalLoadingAtom, commitModalCanProceedAtom, executeCommitAtom} from "../state"

interface EntityCommitFooterProps {
    /** Callback when modal is closed/cancelled */
    onClose: () => void
    /** Callback when commit succeeds */
    onSuccess?: (result: {newRevisionId?: string}) => void
}

/**
 * EntityCommitFooter
 *
 * Footer with:
 * - Cancel button
 * - Commit button (disabled if no message or cannot commit)
 * - Loading state during commit
 */
export function EntityCommitFooter({onClose, onSuccess}: EntityCommitFooterProps) {
    const isLoading = useAtomValue(commitModalLoadingAtom)
    const canProceed = useAtomValue(commitModalCanProceedAtom)
    const executeCommit = useSetAtom(executeCommitAtom)

    const handleCommit = useCallback(async () => {
        const result = await executeCommit()
        if (result.success) {
            message.success("Changes committed successfully")
            onSuccess?.({})
        }
    }, [executeCommit, onSuccess])

    return (
        <ModalFooter
            onCancel={onClose}
            onConfirm={handleCommit}
            confirmLabel="Commit"
            isLoading={isLoading}
            canConfirm={canProceed}
        />
    )
}
