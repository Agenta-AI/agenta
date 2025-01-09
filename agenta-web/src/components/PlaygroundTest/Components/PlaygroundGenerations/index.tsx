import PlaygroundGenerationCompletion from "./assets/PlaygroundGenerationCompletion"
import PlaygroundGenerationHeader from "./assets/PlaygroundGenerationHeader"
import PlaygroundGenerationVariableConfig from "./assets/PlaygroundGenerationVariableConfig"
import {PlaygroundGenerationsProps} from "./types"

const PlaygroundGenerations: React.FC<PlaygroundGenerationsProps> = ({variantId}) => {
    return (
        <div>
            <PlaygroundGenerationHeader />
            <PlaygroundGenerationCompletion variantId={variantId} />
        </div>
    )
}

export default PlaygroundGenerations
