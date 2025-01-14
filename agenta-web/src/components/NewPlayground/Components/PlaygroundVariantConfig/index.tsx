import {useCallback, memo} from "react"

import clsx from "clsx"

import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import PlaygroundVariantConfigPrompt from "../PlaygroundVariantConfigPrompt"
import usePlayground from "../../hooks/usePlayground"
import {componentLogger} from "../../assets/utilities/componentLogger"

import type {VariantConfigComponentProps} from "./types"
import type {EnhancedVariant} from "../../assets/utilities/transformer/types"
import useDelayChildren from "../../hooks/useDelayChildren"

/**
 * PlaygroundVariantConfig manages the configuration interface for a single variant.
 *
 * Features:
 * - Displays variant configuration header
 * - Renders prompt configuration interface
 * - Handles styling for collapsed sections
 *
 * @component
 * @example
 * ```tsx
 * <PlaygroundVariantConfig variantId="variant-123" />
 * ```
 */
const PlaygroundVariantConfig: React.FC<VariantConfigComponentProps> = ({
    variantId,
    className,
    ...divProps
}) => {
    const {promptIds = []} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: useCallback((variant: EnhancedVariant) => {
            const promptIds = (variant?.prompts || [])?.map((prompt) => prompt.__id) ?? []
            return {promptIds}
        }, []),
    })

    const showChildren = useDelayChildren(10)

    componentLogger("PlaygroundVariantConfig", variantId, promptIds)

    return (
        <div
            className={clsx(
                "w-full",
                "[&_.ant-collapse]:!bg-[transparent]",
                "[&_.ant-collapse-expand-icon]:!self-center",
                "[&_.ant-collapse-content-box]:!px-4",
                "[&_.ant-collapse-header]:!pl-3 [&_.ant-collapse-header]:!pr-4",
                className,
            )}
            {...divProps}
        >
            {showChildren && (
                <>
                    <PlaygroundVariantConfigHeader variantId={variantId} />
                    {promptIds.map((promptId) => (
                        <PlaygroundVariantConfigPrompt
                            key={promptId as string}
                            promptId={promptId}
                            variantId={variantId}
                        />
                    ))}
                </>
            )}
        </div>
    )
}

export default memo(PlaygroundVariantConfig)
