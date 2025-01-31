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

const GenerationComparisonOutput = ({rowId, isLastRow}: {rowId: string; isLastRow?: boolean}) => {
    const {isChat, displayedVariants, chatHistory} = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const chatRow = findPropertyInObject(state, rowId)
                const chatHistory = chatRow?.history?.value?.map((item) => item.__id)
                return {isChat: state.variants[0].isChat, chatHistory}
            },
            [rowId],
        ),
    })

    return (
        <div className={clsx([{flex: !isChat}])}>
            {isChat
                ? (chatHistory || []).map((chatId, historyIndex) => (
                      <GenerationComparisonChatOutput
                          key={chatId}
                          historyId={chatId}
                          rowId={rowId}
                          isLastRow={historyIndex === chatHistory.length - 1}
                          isFirstRow={historyIndex === 0}
                      />
                  ))
                : displayedVariants?.map((variantId, variantIndex) => (
                      <GenerationComparisonCompletionOutput
                          key={`${variantId}-${rowId}`}
                          rowId={rowId}
                          variantId={variantId}
                          variantIndex={variantIndex}
                          isLastRow={isLastRow}
                          isLastVariant={variantIndex === (displayedVariants || []).length - 1}
                      />
                  ))}
        </div>
    )
}

export {GenerationComparisonInput, GenerationComparisonOutput}
