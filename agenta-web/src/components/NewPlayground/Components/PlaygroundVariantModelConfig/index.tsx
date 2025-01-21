import {memo, useState, useCallback, useRef, useMemo, useEffect} from "react"

import {Button, Popover} from "antd"
import {CaretDown} from "@phosphor-icons/react"

import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import usePlayground from "../../hooks/usePlayground"
import ModelConfigModal from "./assets/ModelConfigModal"

import {getEnhancedProperties} from "../../assets/utilities/genericTransformer/utilities/enhanced"
import {componentLogger} from "../../assets/utilities/componentLogger"

import type {PlaygroundVariantModelConfigProps} from "./types"
import type {EnhancedVariant} from "../../assets/utilities/transformer/types"
import {findVariantById, isPlaygroundEqual} from "../../hooks/usePlayground/assets/helpers"

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
                initialState: properties.reduce((acc, p) => {
                    acc[p.__id] = {
                        value: p.value,
                        id: p.__id,
                    }
                    return acc
                }, {}),
            }
        },
        [promptId],
    )

    const {propertyIds, modelName, mutate, isMutating, initialState, saveVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantModelConfig",
        variantSelector,
    })

    const initialStateRef = useRef(structuredClone(initialState))
    const [configState, setConfigState] = useState(initialState)
    // Local state for modal visibility
    const [isModalOpen, setIsModalOpen] = useState(false)

    const hasChanges = useMemo(() => {
        if (!isModalOpen) return false
        return !isPlaygroundEqual(configState, initialStateRef.current)
    }, [isModalOpen, configState])

    const handleConfigUpdate = useCallback(({value, id}) => {
        setConfigState((prev) => {
            if (!prev[id] && !value) return prev
            if (prev[id] === value) return prev

            const cloned = structuredClone(prev)
            cloned[id] = {
                value,
                id,
            }
            return cloned
        })
    }, [])

    componentLogger("PlaygroundVariantModelConfig", variantId, promptId, propertyIds, modelName)

    const saveModelConfig = useCallback(() => saveVariant?.(), [saveVariant])

    const handleModalOpen = useCallback((e?: React.MouseEvent): void => {
        e?.preventDefault()
        e?.stopPropagation()
    }, [])
    const handleModalClose = useCallback(() => setIsModalOpen(false), [])

    // Save handler with automatic modal close
    const handleSave = useCallback(async () => {
        mutate((clonedState) => {
            if (!clonedState) return clonedState
            const variant = findVariantById(clonedState, variantId)
            if (!variant) return clonedState

            const prompt = variant.prompts.find((p) => p.__id === promptId)
            const llmConfig = prompt?.llmConfig

            if (!llmConfig) return clonedState

            for (const propertyId of propertyIds) {
                const valueObject = Object.values(llmConfig).find((p) => p.__id === propertyId)
                valueObject.value = configState[propertyId]?.value
                initialStateRef.current[propertyId].value = configState[propertyId]?.value
            }

            return clonedState
        })

        // await saveModelConfig?.()
        handleModalClose()
    }, [mutate, handleModalClose, variantId, promptId, propertyIds, configState])

    const handleResetDefaults = useCallback(async () => {
        // await saveModelConfig?.()
        handleModalClose()
    }, [handleModalClose])

    const handleClose = useCallback(() => {
        setConfigState((prev) => {
            return structuredClone(initialStateRef.current)
        })
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
                <ModelConfigModal
                    variantId={variantId}
                    propertyIds={propertyIds || []}
                    handleClose={handleClose}
                    handleSave={handleSave}
                    onChange={handleConfigUpdate}
                    hasChanges={hasChanges}
                    state={configState}
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
