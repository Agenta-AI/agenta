import React, {useCallback} from "react"
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
        <GenerationComparisonChatInput />
    ) : (
        <GenerationComparisonCompletionInput
            variantId={variantId}
            rowClassName="bg-[#f5f7fa] border-0 border-r border-solid border-[rgba(5,23,41,0.06)]"
        />
    )
}

const GenerationComparisonOutputConfig = ({
    variantId,
    indexName,
}: {
    variantId: string
    indexName: string
}) => {
    const {isChat} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            return {isChat: state.variants[0].isChat}
        }, []),
    })

    return isChat ? (
        <GenerationComparisonChatOutput variantId={variantId} indexName={indexName} />
    ) : (
        <GenerationComparisonCompletionOutput variantId={variantId} indexName={indexName} />
    )
}

export {GenerationComparisonInputConfig, GenerationComparisonOutputConfig}
