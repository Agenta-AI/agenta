import {useMemo} from "react"

import {useAtomValue} from "jotai"

import {getArrayVal} from "@/oss/components/Playground/context/promptShape"
import {usePromptsSource} from "@/oss/components/Playground/context/PromptsSource"

import {appChatModeAtom, variantByRevisionIdAtomFamily} from "../../state/atoms"
import {displayedVariantsVariablesAtom} from "../../state/atoms/variants"

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

    // Focused variant info and chat flag
    const variant = useAtomValue(variantByRevisionIdAtomFamily(variantId)) as any
    const _variant = variant // keep variable for return payload consistency if needed
    const isChatFlag = useAtomValue(appChatModeAtom)

    // Get prompts via provider-aware source (uses provider if present, else atom)
    const prompts = usePromptsSource(variantId) || []

    // Get message data for the specific variant/message/row (must come before isChat)
    const messageData = useMemo(() => {
        if (messageId) {
            // For config messages, find in variant prompts (support both enhanced and raw shapes)
            for (const prompt of prompts || []) {
                const arr = getArrayVal((prompt as any)?.messages)
                const message = arr.find((msg: any) => msg?.__id === messageId)
                if (message) return message
            }
        }

        return null
    }, [prompts, messageId, variantId, rowId])

    // Chat detection - use focused chat flag or message structure
    const isChat = useMemo(() => {
        // Explicit flag derived from focused selector
        const currentVariantIsChat = isChatFlag || false

        // Check if we have generation message data (rowId present) with chat structure
        // const hasGenerationChatData = rowId && messageRows.length > 0

        // Check if current message data has chat structure (role/content)
        const currentMessageIsChat =
            messageData && (messageData.role || messageData.content || messageData.history)

        return currentVariantIsChat || currentMessageIsChat
    }, [isChatFlag, rowId, messageData])

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
