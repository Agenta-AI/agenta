import {memo, useState, useCallback} from "react"

import {Button, Popover} from "antd"
import {CaretDown} from "@phosphor-icons/react"

import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import usePlayground from "../../hooks/usePlayground"
import ModelConfigModal from "./assets/ModelConfigModal"

import {getEnhancedProperties} from "../../assets/utilities/genericTransformer/utilities/enhanced"
import {componentLogger} from "../../assets/utilities/componentLogger"

import type {PlaygroundVariantModelConfigProps} from "./types"
import type {EnhancedVariant} from "../../assets/utilities/transformer/types"

/**
 * PlaygroundVariantModelConfig Component
 *
 * A component that manages model-specific configuration settings through a modal interface.
 *
 * Features:
 * - Toggle modal for model configuration
 * - Manages model-specific parameters
 * - Integrates with playground state management
 * - Handles configuration persistence
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantModelConfig
 *   variantId="variant-123"
 *   promptIndex={0}
 *   className="custom-class"
 * />
 * ```
 */
const PlaygroundVariantModelConfig: React.FC<PlaygroundVariantModelConfigProps> = ({
    variantId,
    promptId,
    className,
    ...popoverProps // Collect remaining props for Popover
}) => {
    const variantSelector = useCallback(
        (variant: EnhancedVariant) => {
            const prompt = variant.prompts.find((p) => p.__id === promptId)
            const llmConfig = prompt?.llmConfig

            const properties =
                getEnhancedProperties(llmConfig, [
                    "tools",
                    "toolChoice",
                    "responseFormat",
                    "stream",
                ]) || []

            return {
                propertyIds: properties.map((p) => p.__id),
                modelName: llmConfig?.model?.value,
                isMutating: variant.__isMutating,
            }
        },
        [promptId],
    )

    const {propertyIds, modelName, isMutating, saveVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantModelConfig",
        variantSelector,
    })

    // Local state for modal visibility
    const [isModalOpen, setIsModalOpen] = useState(false)

    componentLogger("PlaygroundVariantModelConfig", variantId, promptId, propertyIds, modelName)

    const saveModelConfig = useCallback(() => saveVariant?.(), [saveVariant])

    const handleModalOpen = useCallback((e?: React.MouseEvent): void => {
        e?.preventDefault()
        e?.stopPropagation()
    }, [])
    const handleModalClose = useCallback(() => setIsModalOpen(false), [])

    // Save handler with automatic modal close
    const handleSave = useCallback(async () => {
        await saveModelConfig?.()
        handleModalClose()
    }, [saveModelConfig, handleModalClose])

    const handleResetDefaults = useCallback(async () => {
        // await saveModelConfig?.()
        handleModalClose()
    }, [handleModalClose])

    return (
        <Popover
            {...popoverProps} // Pass through Popover props
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            trigger={["click"]}
            arrow={false}
            title={<PlaygroundVariantModelConfigTitle handleReset={handleResetDefaults} />}
            content={
                isModalOpen ? (
                    <ModelConfigModal
                        variantId={variantId}
                        propertyIds={propertyIds || []}
                        handleClose={handleModalClose}
                        handleSave={handleSave}
                    />
                ) : null
            }
            className={className}
        >
            <Button onClick={handleModalOpen}>
                {modelName ?? "Choose a model"} <CaretDown size={14} />
            </Button>
        </Popover>
    )
}

export default memo(PlaygroundVariantModelConfig)
