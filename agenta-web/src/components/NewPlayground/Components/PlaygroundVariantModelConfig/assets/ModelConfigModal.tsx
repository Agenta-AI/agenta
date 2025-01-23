import {memo, useCallback, type MouseEvent} from "react"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"
import type {PlaygroundVariantModelConfigModalProps, ModelConfigModalContentProps} from "../types"

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
                        variantId={variantId}
                        propertyId={propertyId}
                        withTooltip
                    />
                )
            })}
        </ModalContent>
    )
}

export default memo(ModelConfigModal)
