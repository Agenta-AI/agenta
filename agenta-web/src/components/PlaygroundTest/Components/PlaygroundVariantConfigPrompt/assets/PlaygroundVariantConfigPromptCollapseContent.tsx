import {memo} from "react"
import AddButton from "../../../assets/AddButton"
import useAgentaConfig from "@/components/PlaygroundTest/hooks/useAgentaConfig"
import PromptMessageConfig from "../../PromptMessageConfig"

const PlaygroundVariantConfigPromptCollapseContent = ({
    promptIndex,
    variantId,
}: {
    variantId: string
    promptIndex: number
}) => {
    const {prompt} = useAgentaConfig({variantId, promptIndex})
    if (!prompt) return null
    const messages = prompt.messages || []
    console.log("render PlaygroundVariantConfigPromptCollapse - Content")
    return (
        <div className="flex flex-col gap-4">
            {(Array.isArray(messages.value)
                ? messages.value
                : [messages.value]
            ).map((_, index) => {
                return (
                    <PromptMessageConfig
                        key={[messages.valueKey, index, variantId].join("-")}
                        variantId={variantId}
                        configKey={messages.configKey || ""}
                        valueKey={`${messages.valueKey}.[${index}]`}
                    />
                )
            })}

            <AddButton label={"Message"} />
        </div>
    )
}

export default memo(PlaygroundVariantConfigPromptCollapseContent)
