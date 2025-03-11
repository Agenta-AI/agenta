import {useCallback, memo} from "react"

import clsx from "clsx"

import {componentLogger} from "../../assets/utilities/componentLogger"
import type {EnhancedVariant} from "../../assets/utilities/transformer/types"
import usePlayground from "../../hooks/usePlayground"
import PlaygroundVariantConfigPrompt from "../PlaygroundVariantConfigPrompt"
import PlaygroundVariantCustomProperties from "../PlaygroundVariantCustomProperties"

import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import type {VariantConfigComponentProps} from "./types"

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

    componentLogger("PlaygroundVariantConfig", variantId, promptIds)

    return (
        <div
            className={clsx(
                "w-full",
                "relative",
                "flex flex-col",
                "[&_.ant-collapse]:!bg-[transparent]",
                "[&_.ant-collapse-expand-icon]:!self-center",
                "[&_.ant-collapse-content-box]:!px-4",
                "[&_.ant-collapse-header]:!pl-3 [&_.ant-collapse-header]:!pr-4",
                "[&_.ant-collapse-header]:!top-[48px] [&_.ant-collapse-header]:!z-[2]",
                "[&_.ant-collapse-header]:!sticky [&_.ant-collapse-header]:!bg-white",
                className,
            )}
            {...divProps}
        >
            <PlaygroundVariantConfigHeader variantId={variantId} />
            {promptIds.map((promptId) => (
                <PlaygroundVariantConfigPrompt
                    key={promptId as string}
                    promptId={promptId}
                    variantId={variantId}
                />
            ))}
            <PlaygroundVariantCustomProperties
                variantId={variantId}
                initialOpen={promptIds.length === 0}
            />
        </div>
    )
}

export default memo(PlaygroundVariantConfig)
