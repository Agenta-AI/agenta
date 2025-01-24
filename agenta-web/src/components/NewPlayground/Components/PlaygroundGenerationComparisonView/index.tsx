import {useCallback} from "react"
import GenerationComparisonCompletionInput from "./GenerationComparisonCompletionInput"
import GenerationComparisonChatInput from "./GenerationComparisonChatInput"
import usePlayground from "../../hooks/usePlayground"
import {PlaygroundStateData} from "../../hooks/usePlayground/types"
import GenerationComparisonCompletionOutput from "./GenerationComparisonCompletionOutput"
import GenerationComparisonChatOutput from "./GenerationComparisonChatOutput"

const GenerationComparisonInputConfig = ({variantId}: {variantId: string}) => {
    const {isChat} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            return {isChat: state.variants[0].isChat}
        }, []),
    })

    return isChat ? (
        <GenerationComparisonChatInput variantId={variantId} />
    ) : (
        <GenerationComparisonCompletionInput
            variantId={variantId}
            rowClassName="bg-[#f5f7fa] border-0 border-r border-solid border-[rgba(5,23,41,0.06)]"
        />
    )
}

const GenerationComparisonOutputConfig = ({rowId}: {rowId: string}) => {
    const {isChat, displayedVariants} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            return {isChat: state.variants[0].isChat}
        }, []),
    })

    return (displayedVariants || []).map((variantId) => (
        <div className="!w-[400px] shrink-0">
            {isChat ? (
                <GenerationComparisonChatOutput variantId={rowId} rowId={rowId} />
            ) : (
                <GenerationComparisonCompletionOutput rowId={rowId} variantId={variantId} />
            )}
        </div>
    ))
}

export {GenerationComparisonInputConfig, GenerationComparisonOutputConfig}
