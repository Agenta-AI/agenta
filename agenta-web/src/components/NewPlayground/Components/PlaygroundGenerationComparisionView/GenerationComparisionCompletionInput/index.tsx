import PlaygroundComparisionGenerationInputHeader from "../assets/GenerationComparisionInputHeader/index."
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import {GenerationComparisionCompletionInputProps} from "./types"

const GenerationComparisionCompletionInput = ({
    rowClassName,
}: GenerationComparisionCompletionInputProps) => {
    return (
        <div>
            <PlaygroundComparisionGenerationInputHeader />
            <GenerationCompletion className={rowClassName} />
        </div>
    )
}

export default GenerationComparisionCompletionInput
