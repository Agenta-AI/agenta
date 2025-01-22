import GenerationComparisonOutputHeader from "../assets/GenerationComparisonOutputHeader"
import GenerationChat from "../../PlaygroundGenerations/assets/GenerationChat"

const GenerationComparisonChatOutput = ({
    variantId,
    className,
    focusDisable = false,
    indexName,
}: any) => {
    return (
        <div className="flex flex-col w-full">
            <GenerationComparisonOutputHeader
                variantId={variantId}
                indexName={indexName}
                className="sticky top-0 z-[1]"
            />

            <GenerationChat variantId={variantId} viewAs="output" />
        </div>
    )
}

export default GenerationComparisonChatOutput
