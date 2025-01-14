import clsx from "clsx"
import PlaygroundComparisionGenerationInputHeader from "../assets/GenerationComparisionInputHeader/index."
import {useStyles} from "../styles"
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import {GenerationComparisionCompletionInputProps} from "./types"

const GenerationComparisionCompletionInput = ({
    variantId,
    className,
    rowClassName,
}: GenerationComparisionCompletionInputProps) => {
    const classes = useStyles()

    return (
        <div>
            <PlaygroundComparisionGenerationInputHeader />
            <GenerationCompletion
                variantId={variantId}
                className={clsx(className)}
                rowClassName={rowClassName}
            />
        </div>
    )
}

export default GenerationComparisionCompletionInput
