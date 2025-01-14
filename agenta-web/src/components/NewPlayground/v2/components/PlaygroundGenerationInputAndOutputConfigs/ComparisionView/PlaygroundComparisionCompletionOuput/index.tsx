import clsx from "clsx"
import {useStyles} from "../styles"
import PlaygroundComparisionGenerationOutputHeader from "../assets/PlaygroundComparisionGenerationOutputHeader"
import GenerationOutputText from "@/components/NewPlayground/Components/PlaygroundGenerations/assets/GenerationOutputText"
import GenerationResultUtils from "@/components/NewPlayground/Components/PlaygroundGenerations/assets/GenerationResultUtils"

const GenerationComparisionCompletionOuput = () => {
    const classes = useStyles()
    return (
        <div className={clsx("w-[400px] h-full overflow-y-auto *:!overflow-x-hidden")}>
            <PlaygroundComparisionGenerationOutputHeader />
            <div className={clsx("w-full h-24 p-2", classes.containerBorder)}>
                <GenerationOutputText text="Capital of Bangladesh is Dhaka" />
            </div>
            <div className={clsx("w-ful h-[42px] p-2", classes.containerBorder)}>
                <GenerationResultUtils />
            </div>
        </div>
    )
}

export default GenerationComparisionCompletionOuput
