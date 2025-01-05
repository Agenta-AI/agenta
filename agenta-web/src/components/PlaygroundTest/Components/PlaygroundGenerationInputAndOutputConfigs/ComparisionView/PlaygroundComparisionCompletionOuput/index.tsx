import clsx from "clsx"
import {useStyles} from "../styles"
import PlaygroundComparisionGenerationOutputHeader from "../assets/PlaygroundComparisionGenerationOutputHeader"
import PlaygroundGenerationOutputUtils from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationOutputUtils/PlaygroundGenerationOutputUtils"
import PlaygroundGenerationOutputText from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationOutputText/PlaygroundGenerationOutputText"

const PlaygroundComparisionCompletionOutput = () => {
    const classes = useStyles()
    return (
        <div className={clsx("w-[400px] h-full overflow-y-auto *:!overflow-x-hidden")}>
            <PlaygroundComparisionGenerationOutputHeader />
            <div className={clsx("w-full h-24 p-2", classes.containerBorder)}>
                <PlaygroundGenerationOutputText
                    isOutput="stale"
                    text="Capital of Bangladesh is Dhaka"
                />
            </div>
            <div className={clsx("w-ful h-[42px] p-2", classes.containerBorder)}>
                <PlaygroundGenerationOutputUtils />
            </div>
        </div>
    )
}

export default PlaygroundComparisionCompletionOutput
