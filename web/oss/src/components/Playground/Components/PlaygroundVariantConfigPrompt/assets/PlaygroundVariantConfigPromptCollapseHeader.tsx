import {useCallback} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import {EnhancedVariant} from "../../../../../lib/shared/variant/transformer/types"
import usePlayground from "../../../hooks/usePlayground"
import type {PromptCollapseHeaderProps} from "../types"

const {Text} = Typography

// Load model config component dynamically
const PlaygroundVariantModelConfig = dynamic(() => import("../../PlaygroundVariantModelConfig"), {
    ssr: false,
})

/**
 * PlaygroundVariantConfigPromptCollapseHeader renders the header section of a prompt configuration collapse.
 *
 * Features:
 * - Displays prompt label
 * - Integrates model configuration component
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantConfigPromptCollapseHeader
 *   variantId="variant-123"
 *   promptIndex={0}
 * />
 * ```
 */
const PlaygroundVariantConfigPromptCollapseHeader: React.FC<PromptCollapseHeaderProps> = ({
    variantId,
    className,
    promptId,
    ...props
}) => {
    const {promptName} = usePlayground({
        variantId,
        variantSelector: useCallback((variant: EnhancedVariant) => {
            const prompt = variant?.prompts?.find((p) => p.__id === promptId)
            return {promptName: prompt?.__name}
        }, []),
    })
    return (
        <div className={clsx("w-full flex items-center justify-between", className)} {...props}>
            <Text className="capitalize">{promptName || "Prompt"}</Text>
            <PlaygroundVariantModelConfig variantId={variantId} promptId={promptId} />
        </div>
    )
}

// Memoize the component to prevent unnecessary re-renders
export default PlaygroundVariantConfigPromptCollapseHeader
