/**
 * EntityCommitModal Component
 *
 * Performance-optimized modal shell for committing entity changes.
 * Uses EnhancedModal for lazy rendering and consistent styling.
 */

import {useEffect, useCallback, useRef, useState, type ReactNode} from "react"

import {extractApiErrorMessage, generateSlugWithSuffix, isValidSlug} from "@agenta/shared/utils"
import {message} from "@agenta/ui/app-message"
import {EnhancedModal} from "@agenta/ui/components/modal"
import {useAtomValue, useSetAtom} from "jotai"

import {revisionModalAdapter, testsetModalAdapter, variantModalAdapter} from "../../../adapters"
import type {
    EntityReference,
    CommitSubmitResult,
    CommitSubmitParams,
    CommitCreateFieldsConfig,
} from "../../types"
import {
    commitModalOpenAtom,
    commitModalContextAtom,
    commitModalEntityAtom,
    commitModalEntityNameAtom,
    commitModalMessageAtom,
    commitModalCanProceedAtom,
    commitModalEntitySlugAtom,
    commitModalLoadingAtom,
    commitModalActionLabelAtom,
    resetCommitModalAtom,
    closeCommitModalAtom,
    executeCommitAtom,
    setCommitErrorAtom,
    setCommitLoadingAtom,
    setCommitEntityNameAtom,
    setCommitEntitySlugAtom,
    setCommitSlugEditingAtom,
    setCommitSlugFieldErrorAtom,
} from "../state"

import {EntityCommitContent, type CommitModeOption} from "./EntityCommitContent"
import {EntityCommitFooter} from "./EntityCommitFooter"
import {EntityCommitTitle} from "./EntityCommitTitle"

// Ensure modal adapters are registered even when side-effect imports are tree-shaken.
void testsetModalAdapter
void revisionModalAdapter
void variantModalAdapter

export type {CommitSubmitResult, CommitSubmitParams, CommitCreateFieldsConfig}

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
    /** Called whenever the selected commit mode changes */
    onModeChange?: (mode: string | undefined) => void
    /** Additional submit guard from caller (e.g. requires variant name or environment) */
    canSubmit?: (params: {mode?: string; entityName?: string; entitySlug?: string}) => boolean
    /**
     * Enables the reusable create-name + slug fields.
     *
     * Usage:
     * - `createEntityFields` for create flows without modes.
     * - `createEntityFields={{modes: ["variant"], nameLabel: "Variant name"}}` for mode-based creates.
     */
    createEntityFields?: boolean | CommitCreateFieldsConfig
    /** Whether a commit message is required to proceed. Defaults to false. */
    commitMessageRequired?: boolean
    /** Label for the target in the version display when a non-default mode is selected (e.g. new variant name) */
    modeLabel?: string
    /**
     * Action label used throughout the modal (title, subtitle, message label, button).
     * Defaults to "Commit". Set to "Create" for entity creation flows.
     */
    actionLabel?: string
    /**
     * @deprecated Use `createEntityFields` instead.
     * When true, the entity name is shown as an editable input field.
     */
    entityNameEditable?: boolean
    /** Modes where the modal should show editable name + slug fields. */
    entityNameEditableModes?: string[]
    /** Label for the editable entity name field. Defaults to "Name". */
    entityNameLabel?: string
}

const SLUG_CONFLICT_MESSAGE = "A resource with this slug already exists in this project."

function getErrorStatus(error: unknown): number | undefined {
    return (error as {response?: {status?: number}})?.response?.status
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
    submitLabel,
    commitModes,
    defaultCommitMode,
    renderModeContent,
    onModeChange,
    canSubmit,
    commitMessageRequired = false,
    modeLabel,
    actionLabel = "Commit",
    createEntityFields,
    entityNameEditable = false,
    entityNameEditableModes,
    entityNameLabel = "Name",
}: EntityCommitModalProps) {
    const internalOpen = useAtomValue(commitModalOpenAtom)
    const context = useAtomValue(commitModalContextAtom)
    const currentEntity = useAtomValue(commitModalEntityAtom)
    const entityName = useAtomValue(commitModalEntityNameAtom)
    const entitySlug = useAtomValue(commitModalEntitySlugAtom)
    const commitMessage = useAtomValue(commitModalMessageAtom)
    const canProceed = useAtomValue(commitModalCanProceedAtom)
    const isLoading = useAtomValue(commitModalLoadingAtom)
    const resetModal = useSetAtom(resetCommitModalAtom)
    const setEntity = useSetAtom(commitModalEntityAtom)
    const setMessage = useSetAtom(commitModalMessageAtom)
    const setActionLabel = useSetAtom(commitModalActionLabelAtom)
    const closeModal = useSetAtom(closeCommitModalAtom)
    const executeCommit = useSetAtom(executeCommitAtom)
    const setCommitError = useSetAtom(setCommitErrorAtom)
    const setCommitLoading = useSetAtom(setCommitLoadingAtom)
    const setEntityName = useSetAtom(setCommitEntityNameAtom)
    const setEntitySlug = useSetAtom(setCommitEntitySlugAtom)
    const setSlugEditing = useSetAtom(setCommitSlugEditingAtom)
    const setSlugFieldError = useSetAtom(setCommitSlugFieldErrorAtom)
    const wasExternallyOpenRef = useRef(false)
    const syncedEntityRef = useRef<{id: string; type: string} | null>(null)
    const previousCreateFieldsEnabledRef = useRef(false)
    // Track current externalOpen value in a ref to avoid stale closures in afterClose callbacks
    const externalOpenRef = useRef(externalOpen)
    externalOpenRef.current = externalOpen

    const [selectedMode, setSelectedMode] = useState<string | undefined>(
        defaultCommitMode ?? commitModes?.[0]?.id,
    )

    const isExternallyControlled = externalOpen !== undefined
    // Determine actual open state
    const isOpen = isExternallyControlled ? Boolean(externalOpen) : internalOpen
    const createFieldsEntity = currentEntity ?? externalEntity ?? null
    const createFieldsConfig =
        typeof createEntityFields === "object" ? createEntityFields : undefined
    const createFieldsModes = createFieldsConfig?.modes
    const createFieldsEnabled =
        createEntityFields === true ||
        Boolean(
            createFieldsConfig &&
            (!createFieldsModes?.length ||
                (selectedMode && createFieldsModes.includes(selectedMode))),
        )
    const isEntityNameEditable =
        entityNameEditable ||
        createFieldsEnabled ||
        Boolean(selectedMode && entityNameEditableModes?.includes(selectedMode))
    const configuredNameLabel = createFieldsConfig?.nameLabel
    const resolvedEntityNameLabel =
        typeof configuredNameLabel === "function"
            ? configuredNameLabel({entity: createFieldsEntity, mode: selectedMode})
            : (configuredNameLabel ?? entityNameLabel)

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
            setActionLabel(actionLabel)
            setCommitError(null)
            setCommitLoading(false)
            setEntityName(null)
            setEntitySlug(null)
            setSlugEditing(false)
            setSlugFieldError(null)
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
        actionLabel,
        setEntity,
        setMessage,
        setActionLabel,
        setCommitError,
        setCommitLoading,
        setEntityName,
        setEntitySlug,
        setSlugEditing,
        setSlugFieldError,
    ])

    useEffect(() => {
        if (isOpen) {
            setSelectedMode(defaultCommitMode ?? commitModes?.[0]?.id)
        }
    }, [isOpen, defaultCommitMode, commitModes])

    useEffect(() => {
        onModeChange?.(selectedMode)
    }, [selectedMode, onModeChange])

    useEffect(() => {
        if (!isOpen) {
            previousCreateFieldsEnabledRef.current = false
            return
        }

        const wasCreateFieldsEnabled = previousCreateFieldsEnabledRef.current
        previousCreateFieldsEnabledRef.current = isEntityNameEditable

        if (isEntityNameEditable && !wasCreateFieldsEnabled) {
            const configuredDefaultName = createFieldsConfig?.defaultName
            const defaultCreateName =
                typeof configuredDefaultName === "function"
                    ? configuredDefaultName({entity: createFieldsEntity, mode: selectedMode})
                    : configuredDefaultName !== undefined
                      ? configuredDefaultName
                      : createFieldsModes?.length || entityNameEditableModes?.length
                        ? createFieldsEntity?.name
                            ? `${createFieldsEntity.name} copy`
                            : ""
                        : (createFieldsEntity?.name ?? "")
            setEntityName(defaultCreateName)
            setEntitySlug(
                defaultCreateName.trim() ? generateSlugWithSuffix(defaultCreateName) : null,
            )
            setSlugEditing(false)
            setSlugFieldError(null)
        }

        if (!isEntityNameEditable && wasCreateFieldsEnabled) {
            setEntityName(null)
            setEntitySlug(null)
            setSlugEditing(false)
            setSlugFieldError(null)
        }
    }, [
        isOpen,
        selectedMode,
        isEntityNameEditable,
        createFieldsConfig?.defaultName,
        createFieldsModes,
        entityNameEditableModes,
        createFieldsEntity,
        setEntityName,
        setEntitySlug,
        setSlugEditing,
        setSlugFieldError,
    ])

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

    const messageValid = !commitMessageRequired || commitMessage.trim().length > 0
    const nameSlugValid =
        !isEntityNameEditable ||
        (entityName.trim().length > 0 && Boolean(entitySlug) && isValidSlug(entitySlug ?? ""))
    const canProceedWithExtension =
        canProceed &&
        messageValid &&
        nameSlugValid &&
        (canSubmit
            ? canSubmit({
                  mode: selectedMode,
                  entityName: entityName || undefined,
                  entitySlug: entitySlug || undefined,
              })
            : true)

    const handleConfirm = useCallback(async () => {
        if (onSubmit) {
            if (!currentEntity) return

            setCommitLoading(true)
            setCommitError(null)
            setSlugFieldError(null)

            try {
                const result = await onSubmit({
                    entity: currentEntity,
                    message: commitMessage.trim() || null,
                    mode: selectedMode,
                    entityName: entityName || undefined,
                    entitySlug: entitySlug || undefined,
                })

                if (!result.success) {
                    const isSlugConflict = result.slugConflict || result.errorStatus === 409
                    if (isSlugConflict) {
                        setSlugFieldError(SLUG_CONFLICT_MESSAGE)
                        setSlugEditing(true)
                    }
                    setCommitError(
                        new Error(extractApiErrorMessage(result.error || "Commit failed")),
                    )
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
                const msg = extractApiErrorMessage(error)
                if (getErrorStatus(error) === 409) {
                    setSlugFieldError(SLUG_CONFLICT_MESSAGE)
                    setSlugEditing(true)
                }
                setCommitError(
                    error instanceof Error ? Object.assign(error, {message: msg}) : new Error(msg),
                )
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
        entityName,
        entitySlug,
        setCommitLoading,
        setCommitError,
        setSlugFieldError,
        setSlugEditing,
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
                    confirmLabel={submitLabel ?? actionLabel}
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
                modeLabel={modeLabel}
                entityNameEditable={isEntityNameEditable}
                entityNameLabel={resolvedEntityNameLabel}
            />
        </EnhancedModal>
    )
}
