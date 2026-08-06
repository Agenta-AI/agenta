import {ReactNode} from "react"

import {
    extractChatMessages as extractSharedChatMessages,
    normalizeChatMessages,
} from "@agenta/ui/cell-renderers"

import {renderChatMessages} from "@/oss/components/EvalRunDetails/utils/renderChatMessages"

export const renderScenarioChatMessages = (
    value: unknown,
    keyPrefix: string,
): ReactNode[] | null => {
    const messageArray = extractSharedChatMessages(value)
    if (!messageArray) return null

    const normalized = normalizeChatMessages(messageArray)
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
