import {useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import {getPromptById} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"

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
    viewOnly,
    ...props
}) => {
    const prompts = usePromptsSource(variantId)
    const promptName = useMemo(() => {
        const item = getPromptById(prompts, promptId)
        return (item?.__name as string | undefined) ?? "Prompt"
    }, [prompts, promptId])
    return (
        <div className={clsx("w-full flex items-center justify-between", className)} {...props}>
            <Text className="capitalize whitespace-nowrap">{promptName || "Prompt"}</Text>
            <PlaygroundVariantModelConfig
                variantId={variantId}
                promptId={promptId}
                viewOnly={viewOnly}
            />
        </div>
    )
}

// Memoize the component to prevent unnecessary re-renders
export default PlaygroundVariantConfigPromptCollapseHeader
