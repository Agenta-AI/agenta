import {memo, useState, useCallback} from "react"
import {Button, Popover} from "antd"
import usePlayground from "../../hooks/usePlayground"
import ModelConfigModal from "./assets/ModelConfigModal"
import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import type {PlaygroundVariantModelConfigProps} from "./types"
import {CaretDown} from "@phosphor-icons/react"
import {EnhancedVariant} from "../../betterTypes/types"
import { getEnhancedProperties } from "../../betterTypes/utilities/enhanced"

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
            return {
                propertyIds: (
                    getEnhancedProperties(llmConfig, ["tools", "toolChoice", "responseFormat"]) ||
                    []
                ).map((p) => p.__id),
                modelName: llmConfig?.model?.value,
            }
        },
        [promptId],
    )

    const {propertyIds, modelName, saveVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantModelConfig",
        variantSelector,
    })

    // Local state for modal visibility
    const [isModalOpen, setIsModalOpen] = useState(false)

    console.log(
        "usePlayground[%cComponent%c] - PlaygroundVariantModelConfig - RENDER!",
        "color: orange",
        "",
        promptId,
        propertyIds.length,
        modelName,
    )

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
    }, [])

    return (
        <Popover
            {...popoverProps} // Pass through Popover props
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            trigger={["click"]}
            arrow={false}
            title={<PlaygroundVariantModelConfigTitle handleReset={handleResetDefaults} />}
            content={
                <ModelConfigModal
                    variantId={variantId}
                    propertyIds={propertyIds || []}
                    handleClose={handleModalClose}
                    handleSave={handleSave}
                />
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
