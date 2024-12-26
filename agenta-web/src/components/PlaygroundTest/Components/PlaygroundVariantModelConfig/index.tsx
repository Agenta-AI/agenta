import {memo, useState, useCallback} from "react"
import {Button, Popover} from "antd"
import clsx from "clsx"
import usePlayground from "../../hooks/usePlayground"
import ModelConfigModal from "./assets/ModelConfigModal"
import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import type {PlaygroundVariantModelConfigProps, ModelConfigProperty} from "./types"
import {CaretDown} from "@phosphor-icons/react"
import {LLMConfig} from "../../types/openApiTypes"
import {StateVariant} from "../../state/types"

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
    promptIndex,
    className,
    ...props
}) => {
    // Local state for modal visibility
    const [isModalOpen, setIsModalOpen] = useState(false)

    // Get model configuration from playground state
    const {properties, modelName, saveVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantModelConfig",
        variantSelector: (variant) => {
            // Extract model configuration properties from variant
            const prompt = variant?.schema?.promptConfig?.[promptIndex]
            const llmConfig = prompt?.llm_config
            const llmConfigValue: LLMConfig = (llmConfig?.value as LLMConfig) || ({} as LLMConfig)
            const llmConfigProperties = llmConfig?.config

            // Transform configuration into property array
            return {
                properties: llmConfigProperties
                    ? (Object.keys(llmConfigProperties) as (keyof LLMConfig)[]).map((key) => {
                          return {
                              key,
                              configKey: `${llmConfig.configKey}.${key}` as keyof StateVariant,
                              valueKey: `${llmConfig.valueKey}.${key}` as keyof StateVariant,
                              value: llmConfigProperties[key]?.default || null,
                          }
                      })
                    : [],
                modelName: llmConfigValue?.model,
            }
        },
    })

    const saveModelConfig = useCallback(() => saveVariant?.(), [saveVariant, promptIndex])

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
        <>
            <Popover
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                trigger={["click"]}
                placement="bottomRight"
                arrow={false}
                title={<PlaygroundVariantModelConfigTitle handleReset={handleResetDefaults} />}
                content={
                    <ModelConfigModal
                        variantId={variantId}
                        properties={properties}
                        handleClose={handleModalClose}
                        handleSave={handleSave}
                    />
                }
                overlayClassName={clsx([
                    "[&_.ant-popover-inner-content]:px-3 [&_.ant-popover-inner-content]:pb-3 [&_.ant-popover-inner-content]:pt-1",
                    "[&._ant-popover-title]:mb-0",
                    "[&_.ant-popover-inner]:p-0",
                    "[&_.ant-popover-title_>_div]:p-2",
                    "[&_.ant-popover-title]:p-1 [&_.ant-popover-title]:border-solid [&_.ant-popover-title]:border-0 [&_.ant-popover-title]:border-b [&_.ant-popover-title]:border-[#0517290f]",
                ])}
            >
                <Button onClick={handleModalOpen}>
                    {modelName ?? "Choose a model"} <CaretDown size={14} />
                </Button>
            </Popover>
        </>
    )
}

export default memo(PlaygroundVariantModelConfig)
