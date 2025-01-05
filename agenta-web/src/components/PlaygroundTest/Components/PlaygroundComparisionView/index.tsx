import {Button, Typography} from "antd"
import PlaygroundCreateNewVariant from "../PlaygroundCreateNewVariant"
import PlaygroundCompasisionNavigationCard from "./assets/PlaygroundCompasisionNavigationCard/PlaygroundCompasisionNavigationCard"
import PlaygroundVariantConfig from "../PlaygroundVariantConfig"
import PlaygroundComparisionCompletionInput from "../PlaygroundGenerationInputAndOutputConfigs/ComparisionView/PlaygroundComparisionCompletionInput"
import PlaygroundComparisionCompletionOutput from "../PlaygroundGenerationInputAndOutputConfigs/ComparisionView/PlaygroundComparisionCompletionOuput"
import {Play} from "@phosphor-icons/react"
import {PlaygroundComparisionViewProps} from "./types"

const {Text} = Typography

const PlaygroundComparisionView: React.FC<PlaygroundComparisionViewProps> = ({variantIds}) => {
    return (
        <main className="w-full h-full flex flex-col">
            <section className="w-full flex-1 overflow-hidden flex items-start">
                <div className="w-[400px] h-full overflow-y-auto">
                    <div className="w-full flex items-center justify-between p-2 !border-b border-gray-300">
                        <Text>Varaints</Text>
                        <PlaygroundCreateNewVariant />
                    </div>

                    <div className="flex flex-col gap-2 p-2">
                        <PlaygroundCompasisionNavigationCard />
                        <PlaygroundCompasisionNavigationCard />
                        <PlaygroundCompasisionNavigationCard />
                    </div>
                </div>

                {(variantIds || []).map((variantId) => (
                    <div
                        className="w-[400px] h-full overflow-y-auto *:!overflow-x-hidden"
                        key={variantId}
                    >
                        <PlaygroundVariantConfig variantId={variantId as string} />
                    </div>
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
