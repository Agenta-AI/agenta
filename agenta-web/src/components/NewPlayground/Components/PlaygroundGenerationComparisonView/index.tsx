import {useCallback} from "react"

import usePlayground from "../../hooks/usePlayground"

import GenerationComparisonCompletionInput from "./GenerationComparisonCompletionInput"
import GenerationComparisonChatInput from "./GenerationComparisonChatInput"
import GenerationComparisonCompletionOutput from "./GenerationComparisonCompletionOutput"
import GenerationComparisonChatOutput from "./GenerationComparisonChatOutput"

import type {PlaygroundStateData} from "../../hooks/usePlayground/types"

const GenerationComparisonInput = ({variantId}: {variantId: string}) => {
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

const GenerationComparisonOutput = ({rowId}: {rowId: string}) => {
    const {isChat, displayedVariants} = usePlayground({
        stateSelector: useCallback((state: PlaygroundStateData) => {
            return {isChat: state.variants[0].isChat}
        }, []),
    })

    return (displayedVariants || []).map((variantId) => (
        <div className="!w-[400px] shrink-0 self-stretch relative" key={variantId}>
            {isChat ? (
                <GenerationComparisonChatOutput variantId={variantId} rowId={rowId} />
            ) : (
                <GenerationComparisonCompletionOutput rowId={rowId} variantId={variantId} />
            )}
        </div>
    ))
}

export {GenerationComparisonInput, GenerationComparisonOutput}
