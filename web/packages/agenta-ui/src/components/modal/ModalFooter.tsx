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

import {cn, flexLayouts, gapClasses, justifyClasses} from "../../utils/styles"
import {Button} from "../ui/button"
import {LoadingButton} from "../ui/button-composed"

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
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    isLoading = false,
    canConfirm = true,
    danger = false,
    className,
}: ModalFooterProps) {
    return (
        <div
            className={cn(
                flexLayouts.rowCenter,
                gapClasses.sm,
                "w-full",
                justifyClasses.end,
                className,
            )}
        >
            <Button variant="outline" onClick={onCancel} disabled={isLoading}>
                {cancelLabel}
            </Button>
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
