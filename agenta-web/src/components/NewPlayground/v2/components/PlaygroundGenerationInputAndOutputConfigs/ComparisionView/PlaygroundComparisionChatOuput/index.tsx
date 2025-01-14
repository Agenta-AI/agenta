import clsx from "clsx"
import {useStyles} from "../styles"
import PlaygroundComparisionGenerationOutputHeader from "../assets/PlaygroundComparisionGenerationOutputHeader"
import PlaygroundGenerationChatSelectOptions from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationChatSelectOptions/PlaygroundGenerationChatSelectOptions"
import GenerationOutputText from "@/components/NewPlayground/Components/PlaygroundGenerations/assets/GenerationOutputText"
import GenerationResultUtils from "@/components/NewPlayground/Components/PlaygroundGenerations/assets/GenerationResultUtils"

const PlaygroundComparisionChatOutput = () => {
    const classes = useStyles()
    return (
        <div className={clsx("w-[400px] h-full overflow-y-auto *:!overflow-x-hidden")}>
            <PlaygroundComparisionGenerationOutputHeader />
            <div className={clsx("w-ful h-[42px] px-4 flex items-center", classes.containerBorder)}>
                <PlaygroundGenerationChatSelectOptions />
            </div>
            <div className={clsx("w-full py-2 px-4", classes.containerBorder)}>
                <GenerationOutputText
                    text=" Lorem ipsum dolor sit amet consectetur adipisicing elit. Neque, nulla. Lorem
                    ipsum dolor, sit amet consectetur adipisicing elit. Voluptatem quasi error
                    pariatur deleniti asperiores nisi animi reprehenderit, voluptate officia eos?"
                />
            </div>
            <div className={clsx("w-ful h-[42px] px-4 flex items-center", classes.containerBorder)}>
                <GenerationResultUtils />
            </div>

            <div className={clsx("w-ful h-[42px] px-4 flex items-center", classes.containerBorder)}>
                <PlaygroundGenerationChatSelectOptions />
            </div>
            <div className={clsx("w-full py-2 px-4", classes.containerBorder)}>
                <GenerationOutputText
                    text="Lorem ipsum dolor sit amet consectetur adipisicing elit. Neque, nulla. Lorem
                    ipsum dolor, sit amet consectetur adipisicing elit. Voluptatem quasi error Lorem
                    ipsum dolor sit, amet consectetur adipisicing elit. Voluptatum impedit,
                    blanditiis repudiandae pariatur, ipsam perspiciatis modi ea harum dignissimos
                    est voluptatem vel quidem natus eum quasi perferendis beatae culpa voluptates.
                    pariatur deleniti asperiores nisi animi reprehenderit, voluptate officia eos?"
                />
            </div>
            <div className={clsx("w-ful h-[42px] px-4 flex items-center", classes.containerBorder)}>
                <GenerationResultUtils />
            </div>
        </div>
    )
}

export default PlaygroundComparisionChatOutput
