import PlaygroundComparisonGenerationInputHeader from "../assets/GenerationComparisonInputHeader/index."
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import {GenerationComparisonCompletionInputProps} from "./types"

const GenerationComparisonCompletionInput = ({
    rowClassName,
    variantId,
}: GenerationComparisonCompletionInputProps) => {
    return (
        <div>
            <PlaygroundComparisonGenerationInputHeader />
            <GenerationCompletion variantId={variantId} className={rowClassName} />
        </div>
    )
}

export default GenerationComparisonCompletionInput
