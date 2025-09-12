import {memo, useCallback, type MouseEvent} from "react"

import {getLLMConfig, getPromptById} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"

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
    disabled,
    promptId,
}) => {
    const preventClickBubble = useCallback((e: MouseEvent<HTMLElement>) => {
        e.preventDefault()
        e.stopPropagation()
    }, [])

    // Always compute raw llm_config as a safety net (for provider-driven renders)
    const prompts = usePromptsSource(variantId)
    const llm = getLLMConfig(getPromptById(prompts, String(promptId))) || {}
    const pickVal = (v: any) =>
        typeof v === "object" && v && "value" in (v as any) ? (v as any).value : v
    const rows: [string, any][] = []

    // Include common knobs explicitly (shown in Playground modal)
    const KNOBS = [
        "temperature",
        "topP",
        "presencePenalty",
        "frequencyPenalty",
        "maxTokens",
        "stream",
        // keep others if present
    ] as const
    KNOBS.forEach((k) => {
        const val = pickVal((llm as any)?.[k as any])
        if (val !== undefined && val !== null) rows.push([String(k), val])
    })

    // Response format summary
    const rf = (llm as any)?.response_format || (llm as any)?.responseFormat
    if (rf) {
        const t = typeof rf === "object" && rf ? rf.type || pickVal((rf as any).type) : String(rf)
        let label = "text"
        if (t === "json_object") label = "json_object"
        else if (t === "json_schema") label = "json_schema"
        else if (t && typeof t === "string") label = t
        rows.push(["responseFormat", label])
    }

    // Fallback: include any other primitive knob not starting with __ and not complex objects
    Object.entries(llm).forEach(([k, v]) => {
        if (k.startsWith("__")) return
        if (["tools", "toolChoice", "responseFormat", "model"].includes(k)) return
        const val = pickVal(v)
        if (typeof val !== "object" && val !== undefined && val !== null) {
            if (!rows.find(([kk]) => kk === k)) rows.push([k, val])
        }
    })

    // If no enhanced property ids are available, show a clean read-only list
    if (!propertyIds || propertyIds.length === 0) {
        return (
            <ModalContent onClick={preventClickBubble}>
                {rows.length > 0 ? (
                    <div className="flex flex-col gap-2 p-2 text-sm">
                        {rows.map(([k, v]) => (
                            <div
                                key={String(k)}
                                className="flex items-center justify-between gap-4"
                            >
                                <span className="text-[#1C2C3D] capitalize">{String(k)}</span>
                                <span className="text-[#7E8B99]">{String(v)}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-gray-500 text-sm p-2">
                        No model configuration properties available
                    </div>
                )}
            </ModalContent>
        )
    }

    // Render actual model controls (disabled only affects interaction, not visibility)
    return (
        <ModalContent onClick={preventClickBubble}>
            {(propertyIds || []).map((propertyId, idx) => {
                return (
                    <PlaygroundVariantPropertyControl
                        key={propertyId}
                        variantId={variantId}
                        propertyId={propertyId}
                        withTooltip
                        disabled={disabled}
                    />
                )
            })}
        </ModalContent>
    )
}

export default memo(ModelConfigModal)
