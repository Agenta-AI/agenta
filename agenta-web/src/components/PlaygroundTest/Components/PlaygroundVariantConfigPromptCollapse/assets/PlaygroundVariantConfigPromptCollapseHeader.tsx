import {memo} from "react"
import dynamic from "next/dynamic"
import { PromptConfigType } from "@/components/PlaygroundTest/hooks/useAgentaConfig/types"

const PlaygroundVariantModelConfig = dynamic(
    () => import("../../PlaygroundVariantModelConfig"),
    {
        ssr: false,
    },
)

const PlaygroundVariantConfigPromptCollapseHeader = ({prompt, variantId}: {
    prompt: PromptConfigType
    variantId: string
}) => {
    console.log('render PlaygroundVariantConfigPromptCollapse - Header')
    return (
        <div className="w-full flex items-center justify-between">
            <div>Prompt</div>
            <PlaygroundVariantModelConfig
                variantId={variantId}
                modelProperties={prompt.modelProperties}
            />
        </div>
    )
}

export default memo(PlaygroundVariantConfigPromptCollapseHeader)