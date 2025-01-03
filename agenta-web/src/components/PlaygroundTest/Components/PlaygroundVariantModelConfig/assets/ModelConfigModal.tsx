import {memo, useCallback, useState, type MouseEvent} from "react"
import clsx from "clsx"
import {Button, InputNumber, Select, Slider, Switch, Typography} from "antd"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"

import type {
    PlaygroundVariantModelConfigModalProps,
    ModelConfigModalContentProps,
    ModelConfigModalActionsProps,
} from "../types"
import type {Path} from "../../../types/pathHelpers"
import type {StateVariant} from "../../../state/types"

const {Text} = Typography

/**
 * Renders the modal action buttons for saving and canceling changes
 */
const ModalActions: React.FC<ModelConfigModalActionsProps> = ({
    handleSave,
    handleClose,
    className,
    ...props
}) => (
    <div className={clsx("flex items-center justify-end gap-2 mt-5", className)} {...props}>
        <Button onClick={handleClose}>Cancel</Button>
        <Button onClick={handleSave} variant="solid" color="default">
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
    properties,
    handleSave,
    handleClose,
}) => {
    const [model, setModel] = useState("")

    const preventClickBubble = useCallback((e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    return (
        <ModalContent onClick={preventClickBubble} className="!w-[300px]">
            {properties.map((property) => {
                return (
                    <PlaygroundVariantPropertyControl
                        key={property.key}
                        variantId={variantId}
                        configKey={property.configKey as Path<StateVariant>}
                        valueKey={property.valueKey as Path<StateVariant>}
                    />
                )
            })}

            <ModalActions handleSave={handleSave} handleClose={handleClose} />
        </ModalContent>
    )
}

export default memo(ModelConfigModal)
