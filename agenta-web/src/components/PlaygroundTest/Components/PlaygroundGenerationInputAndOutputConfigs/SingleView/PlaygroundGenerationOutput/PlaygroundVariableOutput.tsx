import PlaygroundGenerationOutputText from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationOutputText/PlaygroundGenerationOutputText"
import PlaygroundGenerationOutputUtils from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationOutputUtils/PlaygroundGenerationOutputUtils"
import {PlaygroundVariableOutputProps} from "./types"

const PlaygroundVariableOutput: React.FC<PlaygroundVariableOutputProps> = ({isOutput}) => {
    return (
        <div className="flex flex-col gap-3">
            <PlaygroundGenerationOutputText isOutput="success" text="Output generated" />

            <PlaygroundGenerationOutputUtils />
        </div>
    )
}

export default PlaygroundVariableOutput
