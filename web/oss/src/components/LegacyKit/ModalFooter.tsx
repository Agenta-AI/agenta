/**
 * ModalFooter Component
 *
 * Standardized modal footer with cancel and confirm buttons.
 * Provides consistent layout, loading states, and accessibility.
 *
 * @example
 * ```tsx
 * import {ModalFooter} from '@agenta/ui'
 *
 * <ModalFooter
 *   onCancel={handleClose}
 *   onConfirm={handleSave}
 *   confirmLabel="Save"
 *   isLoading={isSaving}
 *   canConfirm={isValid}
 * />
 * ```
 */

import {LoadingButton} from "@agenta/ui/composed"
import {cn} from "@agenta/ui/ui"
import {Button} from "@agenta/ui/ui"

// ============================================================================
// TYPES
// ============================================================================

export interface ModalFooterProps {
    /** Handler for cancel button click */
    onCancel: () => void
    /** Handler for confirm button click */
    onConfirm: () => void
    /** Label for the confirm button */
    confirmLabel?: string
    /** Label for the cancel button */
    cancelLabel?: string
    /** Whether the confirm action is in progress */
    isLoading?: boolean
    /** Whether the confirm button should be enabled */
    canConfirm?: boolean
    /** Whether to show the confirm button as a danger button */
    danger?: boolean
    /** Hides the cancel button, for a step whose only remaining action is to finish. */
    hideCancel?: boolean
    /** Additional class name for the footer container */
    className?: string
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * ModalFooter
 *
 * A standardized footer for modal dialogs with:
 * - Cancel button (always enabled unless loading)
 * - Confirm button (with loading, disabled, and danger states)
 * - Right-aligned layout
 */
export function ModalFooter({
    onCancel,
    onConfirm,
    confirmLabel: confirmLabelProp,
    cancelLabel: cancelLabelProp,
    isLoading = false,
    canConfirm = true,
    danger = false,
    hideCancel = false,
    className,
}: ModalFooterProps) {
    const confirmLabel = confirmLabelProp ?? "Confirm"
    const cancelLabel = cancelLabelProp ?? "Cancel"
    return (
        <div className={cn("flex items-center", "gap-2", "w-full", "justify-end", className)}>
            {hideCancel ? null : (
                <Button variant="outline" onClick={onCancel} disabled={isLoading}>
                    {cancelLabel}
                </Button>
            )}
            <LoadingButton
                variant={danger ? "destructive" : "default"}
                onClick={onConfirm}
                loading={isLoading}
                disabled={!canConfirm}
            >
                {confirmLabel}
            </LoadingButton>
        </div>
    )
}

export default ModalFooter
