import {Plus} from "@phosphor-icons/react"
import {Divider, Typography} from "antd"
import PlaygroundVariable from "../../PlaygroundVariables/PlaygroundVariable/PlaygroundVariable"
import PlaygroundVariableChatInput from "../../PlaygroundVariables/PlaygroundGenerationChatInput/PlaygroundVariableChatInput"

const PlaygroundGenerationChat = () => {
    const envVariables = ["country", "name", "emal"]

    return (
        <section className="flex flex-col gap-6">
            <PlaygroundVariable variables={envVariables} />

            <div className="flex flex-col gap-2">
                <Typography.Text>Chats</Typography.Text>
                <div className="flex flex-col gap-6">
                    <PlaygroundVariableChatInput type="text" />
                </div>
            </div>

            <div className="flex items-center gap-1">
                <div className="w-1/2 h-[1px] bg-slate-200" /> <Plus size={14} />{" "}
                <div className="w-1/2 h-[1px] bg-slate-200" />
            </div>

            <PlaygroundVariableChatInput type="output" />
            <PlaygroundVariableChatInput type="input" />

            <div className="-mx-3">
                <Divider className="!my-2 !mx-0" />
            </div>
        </section>
    )
}

export default PlaygroundGenerationChat
