import PlaygroundVariableOutput from "../PlaygroundGenerationOutput/PlaygroundVariableOutput"
import PlaygroundVariableMenu from "../../PlaygroundVariableMenu/PlaygroundVariableMenu"
import {PlaygroundVariableChatInputProps} from "./types"
import PlaygroundGenerationChatSelectOptions from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationChatSelectOptions/PlaygroundGenerationChatSelectOptions"
import PlaygroundGenerationChatInput from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationChatInput/PlaygroundGenerationChatInput"
import PlaygroundGenerationOutputText from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationOutputText/PlaygroundGenerationOutputText"

const PlaygroundVariableChatInput: React.FC<PlaygroundVariableChatInputProps> = ({
    type,
    className,
}) => {
    return (
        <div className="w-full flex items-start justify-between gap-4 group/item">
            <div className="w-full flex flex-col xl:flex-row xl:items-start gap-4">
                <PlaygroundGenerationChatSelectOptions />

                {type === "input" ? (
                    <PlaygroundGenerationChatInput />
                ) : type === "output" ? (
                    <PlaygroundVariableOutput isOutput={"generated"} />
                ) : (
                    <PlaygroundGenerationOutputText
                        className="w-[90%] xl:w-[80%]"
                        isOutput="success"
                        text=" Lorem ipsum dolor sit amet. Lorem ipsum, dolor sit amet consectetur
                        adipisicing elit. Qui commodi aperiam a architecto similique nemo recusandae
                        expedita nobis sint velit, tempore magnam ad fugiat, assumenda quasi sed
                        repellat dignissimos veritatis!"
                    />
                )}
            </div>

            {type !== "input" && (
                <PlaygroundVariableMenu className="invisible group-hover/item:visible" />
            )}
        </div>
    )
}

export default PlaygroundVariableChatInput
