import {memo} from "react"
import PlaygroundVariantPropertyControl from "../../PlaygroundVariantPropertyControl"
import AddButton from "../../../assets/AddButton"
import useAgentaConfig from "@/components/PlaygroundTest/hooks/useAgentaConfig"

const PlaygroundVariantConfigPromptCollapseContent = ({
    promptIndex,
    variantId,
}: {
    variantId: string
    promptIndex: number
}) => {
    const {prompt} = useAgentaConfig({variantId, promptIndex})  
    console.log("render PlaygroundVariantConfigPromptCollapse - Content")
    return (
        <div className="flex flex-col gap-4">
            {prompt?.promptDefaults.map((property) => {
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
