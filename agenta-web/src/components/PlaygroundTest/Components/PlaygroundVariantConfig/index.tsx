import clsx from "clsx"
import PlaygroundVariantConfigHeader from "./assets/PlaygroundVariantConfigHeader"
import PlaygroundVariantConfigPrompt from "../PlaygroundVariantConfigPrompt"
import usePlayground from "../../hooks/usePlayground"
import {variantToPromptsSelector} from "./assets/helpers"
import type {PlaygroundVariantConfigProps} from "./types"

/**
 * Renders the prompts section of a variant configuration
 * Uses the variantToPromptsSelector to get relevant prompt data
 */
// const PlaygroundConfigVariantPrompts = ({
//     variantId,
// }: Pick<PlaygroundVariantConfigProps, "variantId">) => {
//     const {prompts = []} = usePlayground({
//         variantId,
//         hookId: "PlaygroundConfigVariantPrompts",
//         variantSelector: variantToPromptsSelector,
//     })

//     return (
//         <div className="div flex flex-col gap-2 pb-10">
//             {prompts.map((prompt, promptIndex) => (
//                 <PlaygroundVariantConfigPrompt
//                     key={prompt.key as string}
//                     promptIndex={promptIndex}
//                     variantId={variantId}
//                 />
//             ))}
//         </div>
//     )
// }

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
const PlaygroundVariantConfig: React.FC<PlaygroundVariantConfigProps> = ({
    variantId,
    className,
    ...divProps
}) => {
    const {promptIds = []} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: (variant) => {
            const promptIds = (variant?.prompts || [])?.map((prompt) => prompt.__id) ?? []
            return {
                promptIds,
            }
        }
    })

    console.log(
        "usePlayground[%cComponent%c] - PlaygroundVariantConfig - RENDER!",
        "color: orange",
        "",
        promptIds
    )
    
    return (
        <div
            className={clsx(
                "grow w-full h-full overflow-y-auto",
                "[&_.ant-collapse]:!bg-[transparent]",
                "[&_.ant-collapse-expand-icon]:!self-center",
                "[&_.ant-collapse-content-box]:!px-4",
                "[&_.ant-collapse-header]:!pl-3 [&_.ant-collapse-header]:!pr-4",
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
        </div>
    )
}

export default PlaygroundVariantConfig
