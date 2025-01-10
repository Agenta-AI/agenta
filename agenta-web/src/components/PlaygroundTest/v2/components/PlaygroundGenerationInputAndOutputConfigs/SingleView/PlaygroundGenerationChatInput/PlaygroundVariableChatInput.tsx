import PlaygroundVariableOutput from "../PlaygroundGenerationOutput/PlaygroundVariableOutput"
import {PlaygroundVariableChatInputProps} from "./types"
import PlaygroundGenerationChatSelectOptions from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationChatSelectOptions/PlaygroundGenerationChatSelectOptions"
import PlaygroundGenerationChatInput from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationChatInput/PlaygroundGenerationChatInput"
import GenerationOutputText from "@/components/PlaygroundTest/Components/PlaygroundGenerations/assets/GenerationOutputText"
import GenerationVariableOptions from "../../PlaygroundVariableMenu/PlaygroundVariableMenu"

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
                    <GenerationOutputText
                        className="w-[90%] xl:w-[80%]"
                        type="success"
                        text=" Lorem ipsum dolor sit amet. Lorem ipsum, dolor sit amet consectetur
                        adipisicing elit. Qui commodi aperiam a architecto similique nemo recusandae
                        expedita nobis sint velit, tempore magnam ad fugiat, assumenda quasi sed
                        repellat dignissimos veritatis!"
                    />
                )}
            </div>

            {type !== "input" && (
                <GenerationVariableOptions
                    variantId=""
                    rowId=""
                    className="invisible group-hover/item:visible"
                />
            )}
        </div>
    )
}

export default PlaygroundVariableChatInput
