import clsx from "clsx"
import PlaygroundComparisionGenerationInputHeader from "../assets/PlaygroundComparisionGenerationInputHeader"
import {useStyles} from "../styles"
import PlaygroundGenerationChatSelectOptions from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationChatSelectOptions/PlaygroundGenerationChatSelectOptions"
import PlaygroundGenerationChatInput from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationChatInput/PlaygroundGenerationChatInput"
import PlaygroundGenerationOutputText from "../../../PlaygroundGenerationInputsAndOutputs/PlaygroundGenerationOutputText/PlaygroundGenerationOutputText"

const PlaygroundComparisionChatInput = () => {
    const classes = useStyles()

    return (
        <div className={clsx("w-[400px] h-full overflow-y-auto *:!overflow-x-hidden")}>
            <PlaygroundComparisionGenerationInputHeader />
            <div className={clsx("w-ful h-[42px] px-4 flex items-center", classes.container)}>
                <PlaygroundGenerationChatSelectOptions disabled={true} />
            </div>
            <div className={clsx("w-full py-2 px-4", classes.container)}>
                <PlaygroundGenerationOutputText
                    disabled={true}
                    isOutput="stale"
                    text="Lorem ipsum dolor sit amet consectetur adipisicing elit. Neque, nulla. Lorem
                    ipsum dolor, sit amet consectetur adipisicing elit. Voluptatem quasi error
                    pariatur deleniti asperiores nisi animi reprehenderit, voluptate officia eos?"
                />
            </div>

            <div className={clsx("w-ful h-[42px] px-4 flex items-center", classes.container)}>
                <PlaygroundGenerationChatSelectOptions />
            </div>
            <div className={clsx("w-full py-2 px-4", classes.container)}>
                <PlaygroundGenerationOutputText
                    isOutput="stale"
                    text="  Lorem ipsum dolor sit amet consectetur adipisicing elit. Neque, nulla. Lorem
                    ipsum dolor, sit amet consectetur adipisicing elit. Voluptatem quasi error
                    pariatur deleniti asperiores nisi animi reprehenderit, voluptate officia eos?"
                />
            </div>
            <div className={clsx("w-ful h-[42px] px-4 flex items-center")}>
                <PlaygroundGenerationChatSelectOptions />
            </div>
            <div className={clsx("w-full py-2 px-4")}>
                <PlaygroundGenerationChatInput />
            </div>
        </div>
    )
}

export default PlaygroundComparisionChatInput
