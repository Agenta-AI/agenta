import {memo, useState, useCallback, useMemo} from "react"

import {CaretDown} from "@phosphor-icons/react"
import {Button, Popover} from "antd"

import {getPromptById, getLLMConfig} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"
import {getEnhancedProperties} from "@/oss/lib/shared/variant"

import ModelConfigModal from "./assets/ModelConfigModal"
import PlaygroundVariantModelConfigTitle from "./assets/PlaygroundVariantModelConfigTitle"
import type {PlaygroundVariantModelConfigProps} from "./types"

// Deprecated local selector: replaced by direct computation from unified prompts source

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
    viewOnly,
    ...popoverProps // Collect remaining props for Popover
}) => {
    // Compute model config from unified prompts source (provider-aware)
    const prompts = usePromptsSource(variantId)
    const {propertyIds, resolvedModelName} = useMemo(() => {
        const prompt = getPromptById(prompts, promptId)
        const llm = getLLMConfig(prompt) || {}
        const properties =
            getEnhancedProperties(llm, [
                "tools",
                "toolChoice",
                "responseFormat",
                "stream",
                // Entity layer uses snake_case keys from the OpenAPI schema
                "tool_choice",
                "response_format",
            ]) || []
        const ids = properties.map((p: any) => p?.__id).filter(Boolean)

        // Prefer enhanced model value; fallback to raw string
        const name =
            (llm?.model &&
                (llm.model.value ?? (typeof llm.model === "string" ? llm.model : undefined))) ||
            undefined

        return {
            propertyIds: ids,
            resolvedModelName: name,
        }
    }, [prompts, promptId])

    // Reset no-op for now (mutation removed). Kept to avoid UI breakage.

    // Local state for modal visibility
    const [isModalOpen, setIsModalOpen] = useState(false)

    // Keep click noop to let Popover's onOpenChange manage visibility
    const handleModalOpen = useCallback((e?: React.MouseEvent): void => {
        e?.preventDefault()
        e?.stopPropagation()
    }, [])

    const handleResetDefaults = useCallback(() => {
        if (!variantId || !promptId || !propertyIds || propertyIds.length === 0) {
            console.warn("[RESET-SIMPLE] ⚠️ Missing required parameters for reset")
            return
        }
    }, [variantId, promptId, propertyIds])

    const displayModel = resolvedModelName ?? "Choose a model"
    const canOpen = (propertyIds?.length || 0) > 0

    return (
        <Popover
            {...popoverProps} // Pass through Popover props
            open={canOpen && !viewOnly ? isModalOpen : false}
            onOpenChange={
                canOpen
                    ? (open) => {
                          if (viewOnly) {
                              setIsModalOpen(false)
                              return
                          }
                          setIsModalOpen(open)
                      }
                    : undefined
            }
            classNames={{
                root: "w-full max-w-[300px]",
            }}
            destroyOnHidden
            trigger={["click"]}
            placement="bottomRight"
            arrow={false}
            title={
                <PlaygroundVariantModelConfigTitle
                    disabled={viewOnly}
                    handleReset={handleResetDefaults}
                />
            }
            content={
                <ModelConfigModal
                    variantId={variantId}
                    propertyIds={propertyIds || []}
                    disabled={viewOnly}
                    promptId={promptId}
                />
            }
            className={className}
        >
            <Button onClick={handleModalOpen} disabled={!canOpen || viewOnly}>
                {displayModel} <CaretDown size={14} />
            </Button>
        </Popover>
    )
}

export default memo(PlaygroundVariantModelConfig)
