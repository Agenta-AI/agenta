import {Select, Input, Typography} from "antd"
import PlaygroundVariableOutput from "../PlaygroundGenerationOutput/PlaygroundVariableOutput"
import PlaygroundVariableMenu from "../PlaygroundVariableMenu/PlaygroundVariableMenu"
import {PlaygroundVariableChatInputProps} from "./types"

const PlaygroundVariableChatInput: React.FC<PlaygroundVariableChatInputProps> = ({
    type,
    className,
}) => {
    const options = [
        {label: "USER", value: "user"},
        {label: "SYSTEM", value: "system"},
    ]
    return (
        <div className="w-full flex items-start justify-between gap-4 group/item">
            <div className="w-full flex items-start gap-4">
                <Select defaultValue="system" style={{width: 100}} options={options} />

                {type === "input" ? (
                    <Input placeholder="Type your message here" className="w-full border-none" />
                ) : type === "output" ? (
                    <PlaygroundVariableOutput isOutput={"generated"} />
                ) : (
                    <Typography.Text className="w-[80%]">
                        Lorem ipsum dolor sit amet. Lorem ipsum, dolor sit amet consectetur
                        adipisicing elit. Qui commodi aperiam a architecto similique nemo recusandae
                        expedita nobis sint velit, tempore magnam ad fugiat, assumenda quasi sed
                        repellat dignissimos veritatis!
                    </Typography.Text>
                )}
            </div>

            {type !== "input" && (
                <PlaygroundVariableMenu className="invisible group-hover/item:visible" />
            )}
        </div>
    )
}

export default PlaygroundVariableChatInput
