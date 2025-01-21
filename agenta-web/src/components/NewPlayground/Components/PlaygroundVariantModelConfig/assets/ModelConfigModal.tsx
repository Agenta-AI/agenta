import {memo, useCallback, type MouseEvent} from "react"

import clsx from "clsx"
import {Button} from "antd"

import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"

import type {
    PlaygroundVariantModelConfigModalProps,
    ModelConfigModalContentProps,
    ModelConfigModalActionsProps,
} from "../types"

/**
 * Renders the modal action buttons for saving and canceling changes
 */
const ModalActions: React.FC<ModelConfigModalActionsProps> = ({
    className,
    hasChanges,
    handleSave,
    handleClose,
    ...props
}) => (
    <div className={clsx("flex items-center justify-end gap-2 mt-4", className)} {...props}>
        <Button onClick={handleClose}>Cancel</Button>
        <Button disabled={!hasChanges} onClick={handleSave} variant="solid" color="default">
            Save
        </Button>
    </div>
)

/**
 * Wraps the modal content and handles click event bubbling
 */
const ModalContent: React.FC<ModelConfigModalContentProps> = ({
    children,
    className,
    onClick,
    ...props
}) => (
    <div onClick={onClick} className={className} {...props}>
        {children}
    </div>
)

/**
 * ModelConfigModal provides an interface for configuring model-specific parameters.
 *
 * Features:
 * - Displays configurable model properties
 * - Prevents click event bubbling
 * - Handles save and cancel actions
 * - Memoized to prevent unnecessary re-renders
 *
 * @component
 * @example
 * ```tsx
 * <ModelConfigModal
 *   variantId="variant-123"
 *   properties={[...]}
 *   handleSave={onSave}
 *   handleClose={onClose}
 * />
 * ```
 */
const ModelConfigModal: React.FC<PlaygroundVariantModelConfigModalProps> = ({
    variantId,
    propertyIds,
    hasChanges,
    state,
    onChange,
    handleSave,
    handleClose,
}) => {
    const preventClickBubble = useCallback((e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    return (
        <ModalContent onClick={preventClickBubble}>
            {propertyIds.map((propertyId) => {
                return (
                    <PlaygroundVariantPropertyControl
                        key={propertyId}
                        value={state[propertyId]?.value}
                        variantId={variantId}
                        propertyId={propertyId}
                        onChange={onChange}
                        withTooltip
                    />
                )
            })}

            <ModalActions
                handleSave={handleSave}
                handleClose={handleClose}
                hasChanges={hasChanges}
            />
        </ModalContent>
    )
}

export default memo(ModelConfigModal)
