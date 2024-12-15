import {memo} from "react"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"
import AddButton from "../../../assets/AddButton"
import { PromptConfigType } from "@/components/PlaygroundTest/hooks/useAgentaConfig/types"

const PlaygroundVariantConfigPromptCollapseContent = ({prompt, variantId}: {
    variantId: string
    prompt: PromptConfigType
}) => {
    console.log('render PlaygroundVariantConfigPromptCollapse - Content')
    return (
        <div className="flex flex-col gap-4">
            {prompt.promptProperties.map((property) => {
                return (
                    <PlaygroundVariantPropertyControl
                        key={[property.configKey, variantId].join("-")}
                        variantId={variantId}
                        configKey={property.configKey}
                    />
                )
            })}

            <AddButton label={"Message"} />
        </div>
    )
}

export default memo(PlaygroundVariantConfigPromptCollapseContent)