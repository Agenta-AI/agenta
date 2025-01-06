import {Button, Typography} from "antd"
import PlaygroundVariantConfig from "../PlaygroundVariantConfig"
import PlaygroundComparisionCompletionInput from "../PlaygroundGenerationInputAndOutputConfigs/ComparisionView/PlaygroundComparisionCompletionInput"
import PlaygroundComparisionCompletionOutput from "../PlaygroundGenerationInputAndOutputConfigs/ComparisionView/PlaygroundComparisionCompletionOuput"
import {Play} from "@phosphor-icons/react"
import {PlaygroundComparisionViewProps} from "./types"
import PlaygroundComparisionVariantNavigation from "./assets/PlaygroundComparisionVariantNavigation/PlaygroundComparisionVariantNavigation"
import PlaygroundComparisionPromptConfig from "./assets/PlaygroundComparisionPromptConfig/PlaygroundComparisionPromptConfig"

const PlaygroundComparisionView: React.FC<PlaygroundComparisionViewProps> = ({variantIds}) => {
    return (
        <main className="w-full h-full flex flex-col">
            <section className="w-full flex-1 overflow-hidden flex items-start">
                <PlaygroundComparisionVariantNavigation />

                {(variantIds || []).map((variantId) => (
                    <PlaygroundComparisionPromptConfig>
                        <PlaygroundVariantConfig variantId={variantId as string} />
                    </PlaygroundComparisionPromptConfig>
                ))}
            </section>

            <section className="w-full flex-1">
                <div className="flex items-center gap-2 px-4 py-2 bg-[#F5F7FA]">
                    <Typography className="text-[16px] leading-[18px] font-[600]">
                        Generations
                    </Typography>

                    <Button>Clear</Button>

                    <Button type="primary" icon={<Play size={14} />}>
                        Run
                    </Button>
                </div>

                <div className="w-full flex items-start overflow-x-auto">
                    <PlaygroundComparisionCompletionInput />

                    <PlaygroundComparisionCompletionOutput />
                </div>
            </section>
        </main>
    )
}

export default PlaygroundComparisionView
