import dynamic from "next/dynamic"

import clsx from "clsx"

import type {PromptCollapseHeaderProps} from "../types"

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
    return (
        <div className={clsx("w-full flex items-center justify-between", className)} {...props}>
            <div>Prompt</div>
            <PlaygroundVariantModelConfig variantId={variantId} promptId={promptId} />
        </div>
    )
}

// Memoize the component to prevent unnecessary re-renders
export default PlaygroundVariantConfigPromptCollapseHeader
