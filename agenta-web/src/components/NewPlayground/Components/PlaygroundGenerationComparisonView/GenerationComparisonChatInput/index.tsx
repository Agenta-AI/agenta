import GenerationChat from "../../PlaygroundGenerations/assets/GenerationChat"
import PlaygroundComparisonGenerationInputHeader from "../assets/GenerationComparisonInputHeader/index."

const GenerationComparisonChatInput = ({variantId}: any) => {
    return (
        <>
            <PlaygroundComparisonGenerationInputHeader className="sticky top-0 z-[2]" />
            <GenerationChat variantId={variantId} viewAs="input" />
        </>
    )
}

export default GenerationComparisonChatInput
