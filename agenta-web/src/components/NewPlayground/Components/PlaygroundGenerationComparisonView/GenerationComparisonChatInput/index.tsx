import GenerationChat from "../../PlaygroundGenerations/assets/GenerationChat"
import PlaygroundComparisonGenerationInputHeader from "../assets/GenerationComparisonInputHeader/index."

const GenerationComparisonChatInput = () => {
    return (
        <>
            <PlaygroundComparisonGenerationInputHeader className="sticky top-0 z-[2]" />
            <GenerationChat viewAs={"input"} />
        </>
    )
}

export default GenerationComparisonChatInput
