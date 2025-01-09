import {Button, Typography} from "antd"
import PlaygroundComparisionCompletionInput from "../PlaygroundGenerationInputAndOutputConfigs/ComparisionView/PlaygroundComparisionCompletionInput"
import PlaygroundComparisionCompletionOutput from "../PlaygroundGenerationInputAndOutputConfigs/ComparisionView/PlaygroundComparisionCompletionOuput"
import {Play} from "@phosphor-icons/react"
import {PlaygroundComparisionViewProps} from "./types"

const PlaygroundComparisionView: React.FC<PlaygroundComparisionViewProps> = ({variantIds}) => {
    return (
        <section className="w-full flex-1">
            <div className="flex items-center gap-2 px-4 py-2 bg-[#F5F7FA]">
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Generations
                </Typography>

                <Button>Clear</Button>

                <Button type="primary" icon={<Play size={14} />} size="small">
                    Run
                </Button>
            </div>

            <div className="w-full flex items-start overflow-x-auto">
                <PlaygroundComparisionCompletionInput />

                <PlaygroundComparisionCompletionOutput />
            </div>
        </section>
    )
}

export default PlaygroundComparisionView
