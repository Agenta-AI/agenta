import GenerationCompletion from "./assets/GenerationCompletion"
import GeneratoinHeader from "./assets/GeneratoinHeader"
import {PlaygroundGenerationsProps} from "./types"

const PlaygroundGenerations: React.FC<PlaygroundGenerationsProps> = ({variantId}) => {
    return (
        <div>
            <GeneratoinHeader />
            <GenerationCompletion variantId={variantId} />
        </div>
    )
}

export default PlaygroundGenerations
