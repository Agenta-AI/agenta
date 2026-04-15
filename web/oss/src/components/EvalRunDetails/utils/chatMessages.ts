import {ReactNode} from "react"

import {
    extractChatMessages as extractSharedChatMessages,
    normalizeChatMessages,
} from "@agenta/ui/cell-renderers"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/utils/renderChatMessages"

export const tryParseJson = (value: unknown): unknown => value

export const extractMessageArray = (value: any): any[] | null => {
    return extractSharedChatMessages(value) as any[] | null
}

export const normalizeMessages = (
    messages: any[],
): {role: string; content: any; tool_calls?: any[]}[] => {
    return normalizeChatMessages(messages)
}

export const renderScenarioChatMessages = (
    value: unknown,
    keyPrefix: string,
): ReactNode[] | null => {
    const messageArray = extractMessageArray(value)
    if (!messageArray) return null

    const normalized = normalizeMessages(messageArray)
    if (!normalized.length) return null

    try {
        return renderChatMessages({
            keyPrefix,
            rawJson: JSON.stringify(normalized),
            view: "table",
        })
    } catch {
        return null
    }
}
