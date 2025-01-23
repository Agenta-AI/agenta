import PlaygroundComparisonGenerationInputHeader from "../assets/GenerationComparisonInputHeader/index."
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import {GenerationComparisonCompletionInputProps} from "./types"

const GenerationComparisonCompletionInput = ({
    rowClassName,
    variantId,
    className,
}: GenerationComparisonCompletionInputProps) => {
    return (
        <div>
            <PlaygroundComparisonGenerationInputHeader className="sticky top-0 z-[2]" />
            <GenerationCompletion
                variantId={variantId}
                className={className}
                rowClassName={rowClassName}
            />
        </div>
    )
}

export default GenerationComparisonCompletionInput
