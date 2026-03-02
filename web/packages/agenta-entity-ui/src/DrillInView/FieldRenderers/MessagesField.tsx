/**
 * MessagesField
 *
 * Renders a chat messages array using ChatMessageList from @agenta/ui.
 */

import {ChatMessageList} from "@agenta/ui/chat-message"

import {isMessagesArray, parseMessages} from "./fieldUtils"
import type {BaseFieldProps} from "./types"

export function MessagesField({item, stringValue, fullPath, setValue, valueMode}: BaseFieldProps) {
    const originalWasString = typeof item.value === "string"

    const handleChange = (messages: unknown[]) => {
        // Preserve stringified format if original was a string, otherwise use native
        const shouldStringify = valueMode === "string" || originalWasString
        setValue(fullPath, shouldStringify ? JSON.stringify(messages) : messages)
    }

    return (
        <ChatMessageList
            messages={parseMessages(stringValue)}
            onChange={handleChange}
            showControls={isMessagesArray(stringValue)}
            enableTokens={true}
            templateFormat="curly"
        />
    )
}
