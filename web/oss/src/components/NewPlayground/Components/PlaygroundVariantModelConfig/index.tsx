import {memo, useState, useCallback} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, Popover} from "antd"

import {getEnhancedProperties} from "@/oss/lib/shared/variant"
import type {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import {componentLogger} from "../../assets/utilities/componentLogger"
import usePlayground from "../../hooks/usePlayground"

import ModelConfigModal from "./assets/ModelConfigModal"
import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import type {PlaygroundVariantModelConfigProps} from "./types"

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
            }
        },
        [promptId],
    )

    const {propertyIds, modelName, mutateVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantModelConfig",
        variantSelector,
    })

    // Local state for modal visibility
    const [isModalOpen, setIsModalOpen] = useState(false)

    componentLogger("PlaygroundVariantModelConfig", variantId, promptId, propertyIds, modelName)

    const handleModalOpen = useCallback((e?: React.MouseEvent): void => {
        e?.preventDefault()
        e?.stopPropagation()
    }, [])

    const handleResetDefaults = useCallback(async () => {
        mutateVariant?.((variant) => {
            const prompt = variant?.prompts.find((p) => p.__id === promptId)
            const llmConfig = prompt?.llmConfig
            // @ts-ignore
            const resetModelName = variant.parameters?.agConfig?.prompt.llm_config?.model //TODO: Check this @ardaerzin

            if (!llmConfig) return variant

            const {model, ...restOfConfig} = llmConfig

            const properties =
                getEnhancedProperties(restOfConfig, [
                    "tools",
                    "toolChoice",
                    "responseFormat",
                    "stream",
                ]) || []

            properties.forEach((property) => {
                property.value = null
            })

            if (model.value !== resetModelName) {
                llmConfig.model.value = resetModelName
            }

            return variant
        })
    }, [variantId])

    return (
        <Popover
            {...popoverProps} // Pass through Popover props
            open={isModalOpen}
            onOpenChange={setIsModalOpen}
            overlayClassName="w-full max-w-[300px]"
            trigger={["click"]}
            placement="bottomRight"
            arrow={false}
            title={<PlaygroundVariantModelConfigTitle handleReset={handleResetDefaults} />}
            content={
                isModalOpen ? (
                    <ModelConfigModal variantId={variantId} propertyIds={propertyIds || []} />
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
