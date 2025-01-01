import dynamic from "next/dynamic"
import type {PromptCollapseHeaderProps} from "../types"
import clsx from "clsx"

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
    promptIndex,
    variantId,
    className,
    ...props
}) => {
    return (
        <div className={clsx("w-full flex items-center justify-between", className)} {...props}>
            <div>Prompt</div>
            <PlaygroundVariantModelConfig variantId={variantId} promptIndex={promptIndex} />
        </div>
    )
}

// Memoize the component to prevent unnecessary re-renders
export default PlaygroundVariantConfigPromptCollapseHeader