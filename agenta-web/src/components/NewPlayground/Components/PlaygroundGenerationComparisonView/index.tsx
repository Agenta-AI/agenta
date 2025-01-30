import {useCallback} from "react"
import clsx from "clsx"
import usePlayground from "../../hooks/usePlayground"

import GenerationComparisonCompletionInput from "./GenerationComparisonCompletionInput"
import GenerationComparisonChatInput from "./GenerationComparisonChatInput"
import GenerationComparisonCompletionOutput from "./GenerationComparisonCompletionOutput"
import GenerationComparisonChatOutput from "./GenerationComparisonChatOutput"

import type {PlaygroundStateData} from "../../hooks/usePlayground/types"
import {findPropertyInObject} from "../../hooks/usePlayground/assets/helpers"

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
    const {isChat, displayedVariants, chatHistory} = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const history = findPropertyInObject(state, rowId)
                const chatHistory = history.history.value?.map((item) => item.__id)
                return {isChat: state.variants[0].isChat, chatHistory}
            },
            [rowId],
        ),
    })

    return (
        <div className="border border-solid border-blue-500">
            {isChat
                ? (chatHistory || []).map((chatId, historyIndex) => (
                      <GenerationComparisonChatOutput
                          historyId={chatId}
                          rowId={rowId}
                          historyIndex={historyIndex}
                      />
                  ))
                : displayedVariants?.map((variantId) => (
                      <GenerationComparisonCompletionOutput rowId={rowId} variantId={variantId} />
                  ))}
        </div>
    )
}

export {GenerationComparisonInput, GenerationComparisonOutput}
