import {Input, Typography} from "antd"
import PlaygroundPromptToolsOptions from "./assets/PlaygroundPromptToolsOptions"

const PlaygroundPromptTool = () => {
    return (
        <section className="w-full flex flex-col gap-2 group/item">
            <div className="w-full flex items-center justify-between">
                <Typography.Text>Tool name</Typography.Text>
                <PlaygroundPromptToolsOptions className="invisible group-hover/item:visible" />
            </div>

            <Input.TextArea placeholder="Type your JSON here" className="!h-[250px]" />
        </section>
    )
}

export default PlaygroundPromptTool
