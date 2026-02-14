/**
 * Chat Module Utilities
 *
 * Helpers for inspecting SimpleChatMessage content.
 *
 * @module chat/utils
 */

import type {SimpleChatMessage} from "@agenta/shared/types"

/**
 * Check whether a message has meaningful content.
 */
export function messageHasContent(msg: SimpleChatMessage | null | undefined): boolean {
    if (!msg) return false
    const content = msg.content

    if (typeof content === "string") {
        return content.trim().length > 0
    }

    if (Array.isArray(content)) {
        return content.some((part) => {
            if (part.type === "text") return part.text.trim().length > 0
            if (part.type === "image_url") return Boolean(part.image_url?.url)
            if (part.type === "file") return Boolean(part.file?.file_id || part.file?.file_data)
            return false
        })
    }

    return false
}

/**
 * Check whether a message contains tool calls.
 */
export function messageHasToolCalls(msg: SimpleChatMessage | null | undefined): boolean {
    if (!msg) return false
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true
    if (msg.function_call && typeof msg.function_call === "object") return true
    return false
}
