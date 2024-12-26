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
            <section className="flex flex-col gap-4">
                <div className="w-full flex flex-col gap-1">
                    <Text>Model</Text>
                    <Select
                        showSearch
                        placeholder="Selecct a model"
                        className="w-full"
                        popupClassName="w-full"
                        value={model}
                        onChange={(value) => setModel(value)}
                        filterOption={(input, option) =>
                            (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
                        }
                        options={[
                            {value: "1", label: "Jack"},
                            {value: "2", label: "Lucy"},
                            {value: "3", label: "Tom"},
                        ]}
                    />
                </div>

                <div className="w-full flex flex-col gap-2">
                    <div className="flex flex-col">
                        <div className="w-full flex items-center justify-between">
                            <Text>Temprature</Text>
                            <InputNumber min={1} max={10} defaultValue={3} />
                        </div>
                        <Slider min={1} max={20} value={2} />
                    </div>

                    <div className="flex flex-col">
                        <div className="w-full flex items-center justify-between">
                            <Text>Max Tokens</Text>
                            <InputNumber min={1} max={10} defaultValue={3} />
                        </div>
                        <Slider min={1} max={20} value={2} />
                    </div>
                </div>

                <div className="flex items-center justify-between">
                    <Text>Force JSON</Text>
                    <Switch defaultChecked />
                </div>
            </section>

            {/* {properties.map((property) => {
                return (
                    <PlaygroundVariantPropertyControl
                        key={property.key}
                        variantId={variantId}
                        configKey={property.configKey as Path<StateVariant>}
                        valueKey={property.valueKey as Path<StateVariant>}
                    />
                )
            })} */}

            <ModalActions handleSave={handleSave} handleClose={handleClose} />
        </ModalContent>
    )
}

export default memo(ModelConfigModal)
