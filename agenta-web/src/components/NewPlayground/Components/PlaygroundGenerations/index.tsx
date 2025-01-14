import {useCallback} from "react"
import usePlayground from "../../hooks/usePlayground"
import GenerationCompletion from "./assets/GenerationCompletion"
import GenerationHeader from "./assets/GenerationHeader"
import {PlaygroundGenerationsProps} from "./types"
import {EnhancedVariant} from "../../assets/utilities/transformer/types"
import GenerationChat from "./assets/GenerationChat"

const PlaygroundGenerations: React.FC<PlaygroundGenerationsProps> = ({variantId}) => {
    const {isChat} = usePlayground({
        variantId,
        variantSelector: useCallback((variant: EnhancedVariant) => {
            return {isChat: variant.isChat}
        }, []),
    })

    return (
        <div>
            <GenerationHeader />
            {isChat ? <GenerationChat /> : <GenerationCompletion variantId={variantId} />}
        </div>
    )
}

export default PlaygroundGenerations
