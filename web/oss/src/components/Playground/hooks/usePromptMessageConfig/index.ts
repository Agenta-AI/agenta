import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {getArrayVal} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"

import {appChatModeAtom, variantByRevisionIdAtomFamily} from "../../state/atoms"
import {displayedVariantsVariablesAtom} from "../../state/atoms/variants"
import {useChatGenerationData} from "../useChatGenerationData"

/**
 * Optimized hook for PromptMessageConfig that provides only the data needed
 * without subscribing to the entire playground state.
 */
export const usePromptMessageConfig = ({
    variantId,
    messageId,
    rowId,
}: {
    variantId: string
    messageId?: string
    rowId?: string
}) => {
    // Use flexible data sourcing for generation messages when rowId is present
    const {messageRows} = useChatGenerationData()

    // Focused variant info and chat flag
    const variant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any
    const _variant = variant // keep variable for return payload consistency if needed
    const isChatFlag = useAtomValue(appChatModeAtom)

    // Get prompts via provider-aware source (uses provider if present, else atom)
    const prompts = usePromptsSource(variantId) || []

    // Get message data for the specific variant/message/row (must come before isChat)
    const messageData = useMemo(() => {
        if (rowId) {
            // For generation messages, find the generation row and extract message from history
            const generationRow = messageRows.find((inputRow) => inputRow.__id === rowId)
            if (generationRow && messageId) {
                // Extract specific message from the generation row's history
                const history = generationRow.history?.value || []

                // First try to find user message directly in history
                let messageFromHistory = history.find(
                    (historyItem: any) => historyItem.__id === messageId,
                )

                // If not found, search for assistant messages in __runs structure
                if (!messageFromHistory) {
                    for (const historyItem of history) {
                        // Check if this is an assistant message ID in __runs
                        if (historyItem.__runs?.[variantId]?.message?.__id === messageId) {
                            messageFromHistory = historyItem.__runs[variantId].message
                            break
                        }
                        // Also check for multiple assistant messages
                        if (historyItem.__runs?.[variantId]?.messages) {
                            const assistantMessage = historyItem.__runs[variantId].messages.find(
                                (msg: any) => msg?.__id === messageId,
                            )
                            if (assistantMessage) {
                                messageFromHistory = assistantMessage
                                break
                            }
                        }
                    }
                }

                return messageFromHistory || null
            }
            // If no messageId provided, return the generation row itself (fallback)
            return generationRow || null
        } else if (messageId) {
            // For config messages, find in variant prompts (support both enhanced and raw shapes)
            for (const prompt of prompts || []) {
                const arr = getArrayVal((prompt as any)?.messages)
                const message = arr.find((msg: any) => msg?.__id === messageId)
                if (message) return message
            }
        }

        return null
    }, [prompts, messageId, variantId, rowId, messageRows])

    // Chat detection - use focused chat flag or message structure
    const isChat = useMemo(() => {
        // Explicit flag derived from focused selector
        const currentVariantIsChat = isChatFlag || false

        // Check if we have generation message data (rowId present) with chat structure
        const hasGenerationChatData = rowId && messageRows.length > 0

        // Check if current message data has chat structure (role/content)
        const currentMessageIsChat =
            messageData && (messageData.role || messageData.content || messageData.history)

        return currentVariantIsChat || hasGenerationChatData || currentMessageIsChat
    }, [isChatFlag, messageRows, rowId, messageData])

    // Get variables for the variant
    const variables = useAtomValue(displayedVariantsVariablesAtom)

    // Return the full message data instead of just IDs
    const transformedMessage = useMemo(() => {
        if (!messageData) return undefined

        // Return the full enhanced message object instead of just IDs
        return messageData
    }, [messageData])

    return {
        isChat,
        message: transformedMessage,
        variables,
        variant: _variant,
    }
}
