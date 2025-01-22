import GenerationChat from "../../PlaygroundGenerations/assets/GenerationChat"
import PlaygroundComparisonGenerationInputHeader from "../assets/GenerationComparisonInputHeader/index."
import {GenerationComparisonChatInputProps} from "./tpyes"

const GenerationComparisonChatInput = ({variantId}: GenerationComparisonChatInputProps) => {
    return (
        <>
            <PlaygroundComparisonGenerationInputHeader className="sticky top-0 z-[2]" />
            <GenerationChat variantId={variantId} />
        </>
    )
}

export default GenerationComparisonChatInput
