import PlaygroundComparisionGenerationInputHeader from "../assets/GenerationComparisionInputHeader/index."
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import {GenerationComparisionCompletionInputProps} from "./types"

const GenerationComparisionCompletionInput = ({
    rowClassName,
    variantId,
}: GenerationComparisionCompletionInputProps) => {
    return (
        <div>
            <PlaygroundComparisionGenerationInputHeader />
            <GenerationCompletion variantId={variantId} className={rowClassName} />
        </div>
    )
}

export default GenerationComparisionCompletionInput
