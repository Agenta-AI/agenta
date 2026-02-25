/**
 * EntityCommitModal Component
 *
 * Performance-optimized modal shell for committing entity changes.
 * Uses EnhancedModal for lazy rendering and consistent styling.
 */

import {useEffect, useCallback, useRef, useState, type ReactNode} from "react"

import {message} from "@agenta/ui/app-message"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {useAtomValue, useSetAtom} from "jotai"

import {revisionModalAdapter, testsetModalAdapter, variantModalAdapter} from "../../../adapters"
import type {EntityReference, CommitSubmitResult, CommitSubmitParams} from "../../types"
import {
    commitModalOpenAtom,
    commitModalContextAtom,
    commitModalEntityAtom,
    commitModalMessageAtom,
    commitModalCanProceedAtom,
    commitModalLoadingAtom,
    resetCommitModalAtom,
    closeCommitModalAtom,
    executeCommitAtom,
    setCommitErrorAtom,
    setCommitLoadingAtom,
} from "../state"

import {EntityCommitContent, type CommitModeOption} from "./EntityCommitContent"
import {EntityCommitFooter} from "./EntityCommitFooter"
import {EntityCommitTitle} from "./EntityCommitTitle"

// Ensure modal adapters are registered even when side-effect imports are tree-shaken.
void testsetModalAdapter
void revisionModalAdapter
void variantModalAdapter

export type {CommitSubmitResult, CommitSubmitParams}

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
    /** Optional custom submit flow (replaces default adapter commitAtom call) */
    onSubmit?: (params: CommitSubmitParams) => Promise<CommitSubmitResult>
    /** Optional callback invoked after successful submit and modal close */
    onAfterSuccess?: (result: CommitSubmitResult) => Promise<void> | void
    /** Custom success toast message. Pass null to disable. */
    successMessage?: string | null
    /** Custom confirm button label */
    submitLabel?: string
    /** Optional mode selector shown in content */
    commitModes?: CommitModeOption[]
    /** Default selected mode */
    defaultCommitMode?: string
    /** Optional extra content rendered between mode selector and commit message */
    renderModeContent?: (params: {mode?: string}) => ReactNode
    /** Additional submit guard from caller (e.g. requires variant name or environment) */
    canSubmit?: (params: {mode?: string}) => boolean
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
    onSubmit,
    onAfterSuccess,
    successMessage = "Changes committed successfully",
    submitLabel = "Commit",
    commitModes,
    defaultCommitMode,
    renderModeContent,
    canSubmit,
}: EntityCommitModalProps) {
    const internalOpen = useAtomValue(commitModalOpenAtom)
    const context = useAtomValue(commitModalContextAtom)
    const currentEntity = useAtomValue(commitModalEntityAtom)
    const commitMessage = useAtomValue(commitModalMessageAtom)
    const canProceed = useAtomValue(commitModalCanProceedAtom)
    const isLoading = useAtomValue(commitModalLoadingAtom)
    const resetModal = useSetAtom(resetCommitModalAtom)
    const setEntity = useSetAtom(commitModalEntityAtom)
    const setMessage = useSetAtom(commitModalMessageAtom)
    const closeModal = useSetAtom(closeCommitModalAtom)
    const executeCommit = useSetAtom(executeCommitAtom)
    const setCommitError = useSetAtom(setCommitErrorAtom)
    const setCommitLoading = useSetAtom(setCommitLoadingAtom)
    const wasExternallyOpenRef = useRef(false)
    const syncedEntityRef = useRef<{id: string; type: string} | null>(null)
    // Track current externalOpen value in a ref to avoid stale closures in afterClose callbacks
    const externalOpenRef = useRef(externalOpen)
    externalOpenRef.current = externalOpen

    const [selectedMode, setSelectedMode] = useState<string | undefined>(
        defaultCommitMode ?? commitModes?.[0]?.id,
    )

    const isExternallyControlled = externalOpen !== undefined
    // Determine actual open state
    const isOpen = isExternallyControlled ? Boolean(externalOpen) : internalOpen

    // Check if diff data is available for dynamic width
    const hasDiffData = context?.diffData?.original && context?.diffData?.modified

    // Initialize controlled modal state without toggling global modal open state.
    // Uses a ref to track the last synced entity to avoid re-triggering from
    // our own setEntity() call (which would cause currentEntity to change).
    useEffect(() => {
        if (!isExternallyControlled) return

        const isOpening = Boolean(externalOpen) && !wasExternallyOpenRef.current
        const entityChanged =
            externalEntity &&
            (syncedEntityRef.current?.id !== externalEntity.id ||
                syncedEntityRef.current?.type !== externalEntity.type)

        if (externalOpen && externalEntity && (isOpening || entityChanged)) {
            syncedEntityRef.current = {id: externalEntity.id, type: externalEntity.type}
            setEntity(externalEntity)
            setMessage(initialMessage ?? "")
            setCommitError(null)
            setCommitLoading(false)
        }

        if (!externalOpen) {
            syncedEntityRef.current = null
        }

        wasExternallyOpenRef.current = Boolean(externalOpen)
    }, [
        isExternallyControlled,
        externalOpen,
        externalEntity,
        initialMessage,
        setEntity,
        setMessage,
        setCommitError,
        setCommitLoading,
    ])

    useEffect(() => {
        if (isOpen) {
            setSelectedMode(defaultCommitMode ?? commitModes?.[0]?.id)
        }
    }, [isOpen, defaultCommitMode, commitModes])

    const handleClose = useCallback(() => {
        if (!isExternallyControlled) {
            closeModal()
        }
        onClose?.()
    }, [isExternallyControlled, closeModal, onClose])

    const handleAfterClose = useCallback(() => {
        // In externally controlled mode, only reset if the modal is actually closed.
        // This prevents a stale afterClose animation callback from clobbering state
        // when the modal has already been re-opened by the parent.
        // Use ref to get the current value, avoiding stale closure issues.
        if (isExternallyControlled && externalOpenRef.current) return
        resetModal()
    }, [resetModal, isExternallyControlled])

    const handleSuccess = useCallback(
        (result: {newRevisionId?: string}) => {
            onSuccess?.(result)
        },
        [onSuccess],
    )

    const canProceedWithExtension =
        canProceed && (canSubmit ? canSubmit({mode: selectedMode}) : true)

    const handleConfirm = useCallback(async () => {
        if (onSubmit) {
            if (!currentEntity) return

            setCommitLoading(true)
            setCommitError(null)

            try {
                const result = await onSubmit({
                    entity: currentEntity,
                    message: commitMessage.trim(),
                    mode: selectedMode,
                })

                if (!result.success) {
                    setCommitError(new Error(result.error || "Commit failed"))
                    setCommitLoading(false)
                    return
                }

                if (isExternallyControlled) {
                    onClose?.()
                } else {
                    closeModal()
                }
                resetModal()

                if (successMessage) {
                    message.success(successMessage)
                }

                handleSuccess({newRevisionId: result.newRevisionId})
                await onAfterSuccess?.(result)
                return
            } catch (error) {
                setCommitError(error instanceof Error ? error : new Error(String(error)))
                setCommitLoading(false)
                return
            }
        }

        const result = await executeCommit()
        if (result.success) {
            if (isExternallyControlled) {
                onClose?.()
            }
            if (successMessage) {
                message.success(successMessage)
            }
            handleSuccess({})
        }
    }, [
        onSubmit,
        currentEntity,
        setCommitLoading,
        setCommitError,
        commitMessage,
        selectedMode,
        isExternallyControlled,
        onClose,
        closeModal,
        resetModal,
        successMessage,
        handleSuccess,
        onAfterSuccess,
        executeCommit,
    ])

    return (
        <EnhancedModal
            open={isOpen}
            onCancel={handleClose}
            afterClose={handleAfterClose}
            title={<EntityCommitTitle />}
            footer={
                <EntityCommitFooter
                    onClose={handleClose}
                    onConfirm={handleConfirm}
                    isLoading={isLoading}
                    canProceed={canProceedWithExtension}
                    confirmLabel={submitLabel}
                />
            }
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
            <EntityCommitContent
                commitModes={commitModes}
                selectedMode={selectedMode}
                onModeChange={setSelectedMode}
                extraContent={renderModeContent?.({mode: selectedMode})}
            />
        </EnhancedModal>
    )
}
