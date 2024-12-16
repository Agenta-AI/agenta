import {memo} from "react"
import dynamic from "next/dynamic"

const PlaygroundVariantModelConfig = dynamic(() => import("../../PlaygroundVariantModelConfig"), {
    ssr: false,
})

const PlaygroundVariantConfigPromptCollapseHeader = ({
    promptIndex,
    variantId,
}: {
    promptIndex: number
    variantId: string
}) => {
    console.log("render PlaygroundVariantConfigPromptCollapse - Header")
    return (
        <div className="w-full flex items-center justify-between">
            <div>Prompt</div>
            <PlaygroundVariantModelConfig
                variantId={variantId}
                promptIndex={promptIndex}
            />
        </div>
    )
}

export default memo(PlaygroundVariantConfigPromptCollapseHeader)
