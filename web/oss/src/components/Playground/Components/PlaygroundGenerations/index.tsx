import {useCallback} from "react"

import {EnhancedVariant} from "../../../../lib/shared/variant/transformer/types"
import usePlayground from "../../hooks/usePlayground"

import GenerationChat from "./assets/GenerationChat"
import GenerationCompletion from "./assets/GenerationCompletion"
import GenerationHeader from "./assets/GenerationHeader"
import {PlaygroundGenerationsProps} from "./types"

const PlaygroundGenerations: React.FC<PlaygroundGenerationsProps> = ({variantId}) => {
    const {isChat} = usePlayground({
        variantId,
        variantSelector: useCallback((variant: EnhancedVariant) => {
            return {isChat: variant.isChat}
        }, []),
    })

    return (
        <div className="w-full">
            <GenerationHeader variantId={variantId} />
            {isChat ? (
                <GenerationChat variantId={variantId} />
            ) : (
                <GenerationCompletion variantId={variantId} withControls />
            )}
        </div>
    )
}

export default PlaygroundGenerations
