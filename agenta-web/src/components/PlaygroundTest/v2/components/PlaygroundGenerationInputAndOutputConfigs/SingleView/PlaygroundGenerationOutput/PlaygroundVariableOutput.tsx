import GenerationOutputText from "@/components/PlaygroundTest/Components/PlaygroundGenerations/assets/GenerationOutputText"
import {PlaygroundVariableOutputProps} from "./types"
import GenerationResultUtils from "@/components/PlaygroundTest/Components/PlaygroundGenerations/assets/GenerationResultUtils"

const PlaygroundVariableOutput: React.FC<PlaygroundVariableOutputProps> = ({isOutput}) => {
    return (
        <div className="flex flex-col gap-3">
            <GenerationOutputText type="success" text="Output generated" />

            <GenerationResultUtils />
        </div>
    )
}

export default PlaygroundVariableOutput
