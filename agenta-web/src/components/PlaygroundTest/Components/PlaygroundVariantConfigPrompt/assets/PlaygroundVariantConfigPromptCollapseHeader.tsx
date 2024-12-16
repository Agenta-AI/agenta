import {memo} from "react"
import dynamic from "next/dynamic"
import {type PromptConfigType} from "../../../state/types"

const PlaygroundVariantModelConfig = dynamic(() => import("../../PlaygroundVariantModelConfig"), {
    ssr: false,
})

const PlaygroundVariantConfigPromptCollapseHeader = ({
    prompt,
    variantId,
}: {
    prompt: PromptConfigType
    variantId: string
}) => {
    console.log("render PlaygroundVariantConfigPromptCollapse - Header")
    return (
        <div className="w-full flex items-center justify-between">
            <div>Prompt</div>
            <PlaygroundVariantModelConfig
                variantId={variantId}
                modelProperties={prompt.modelDefaults}
            />
        </div>
    )
}

export default memo(PlaygroundVariantConfigPromptCollapseHeader)
