/**
 * Chat Message Utilities
 *
 * Utility functions for working with chat message content, including
 * text extraction, content updates, and attachment management.
 */

import type {
    MessageContent,
    TextContentPart,
    ImageContentPart,
    FileContentPart,
    SimpleChatMessage,
} from "../types/chatMessage"

/**
 * Extract text content from a message content value.
 * Handles both string content and array content with text parts.
 */
export function extractTextFromContent(content: MessageContent): string {
    if (content === null || content === undefined) {
        return ""
    }
    if (typeof content === "string") {
        return content
    }
    if (Array.isArray(content)) {
        const textParts = content.filter((part): part is TextContentPart => part.type === "text")
        return textParts.map((part) => part.text).join("\n")
    }
    return ""
}

/**
 * Extract display text from a message, including tool call info if present.
 * For assistant messages with tool_calls, shows the function calls.
 * For tool messages, shows the response content.
 */
export function extractDisplayTextFromMessage(message: SimpleChatMessage): string {
    // If message has content, use it
    const contentText = extractTextFromContent(message.content ?? null)
    if (contentText) {
        return contentText
    }

    // For assistant messages with tool_calls but no content, show tool call info
    if (message.tool_calls && message.tool_calls.length > 0) {
        return message.tool_calls
            .map((tc) => `${tc.function.name}(${tc.function.arguments})`)
            .join("\n")
    }

    // For legacy function_call
    if (message.function_call) {
        return `${message.function_call.name}(${message.function_call.arguments})`
    }

    return ""
}

/**
 * Check if content has attachments (images or files)
 */
export function hasAttachments(content: MessageContent): boolean {
    if (typeof content === "string") return false
    if (!Array.isArray(content)) return false
    return content.some((part) => part.type === "image_url" || part.type === "file")
}

/**
 * Get attachment count from content
 */
export function getAttachmentInfo(content: MessageContent): {
    imageCount: number
    fileCount: number
} {
    if (typeof content === "string" || !Array.isArray(content)) {
        return {imageCount: 0, fileCount: 0}
    }
    const imageCount = content.filter((part) => part.type === "image_url").length
    const fileCount = content.filter((part) => part.type === "file").length
    return {imageCount, fileCount}
}

/**
 * Update text content while preserving attachments.
 *
 * @remarks
 * If the content array has multiple text parts, ALL text parts will be updated
 * to the same `newText` value. This treats multiple text parts as a single
 * logical text block. If you need to preserve distinct text parts, handle
 * the content array directly.
 */
export function updateTextInContent(content: MessageContent, newText: string): MessageContent {
    if (typeof content === "string") {
        return newText
    }
    if (!Array.isArray(content)) {
        return newText
    }
    // Find existing text part or create new one
    const hasTextPart = content.some((part) => part.type === "text")
    if (hasTextPart) {
        return content.map((part) => (part.type === "text" ? {...part, text: newText} : part))
    }
    // No text part, add one at the beginning
    return [{type: "text", text: newText}, ...content]
}

/**
 * Add an image attachment to message content
 */
export function addImageToContent(
    content: MessageContent,
    imageUrl: string,
    detail: "auto" | "low" | "high" = "auto",
): MessageContent {
    const newPart: ImageContentPart = {
        type: "image_url",
        image_url: {url: imageUrl, detail},
    }
    if (typeof content === "string") {
        return [{type: "text", text: content}, newPart]
    }
    if (!Array.isArray(content)) {
        return [{type: "text", text: ""}, newPart]
    }
    return [...content, newPart]
}

/**
 * Add a file attachment to message content
 */
export function addFileToContent(
    content: MessageContent,
    fileData: string,
    filename: string,
    format: string,
): MessageContent {
    const newPart: FileContentPart = {
        type: "file",
        file: {file_data: fileData, filename, format},
    }
    if (typeof content === "string") {
        return [{type: "text", text: content}, newPart]
    }
    if (!Array.isArray(content)) {
        return [{type: "text", text: ""}, newPart]
    }
    return [...content, newPart]
}

/**
 * Remove an attachment from message content by index
 */
export function removeAttachmentFromContent(
    content: MessageContent,
    attachmentIndex: number,
): MessageContent {
    if (typeof content === "string" || !Array.isArray(content)) {
        return content
    }
    // Find all non-text parts and remove the one at the given index
    let nonTextIndex = 0
    return content.filter((part) => {
        if (part.type === "text") return true
        const keep = nonTextIndex !== attachmentIndex
        nonTextIndex++
        return keep
    })
}

/**
 * Get attachments from content
 */
export function getAttachments(content: MessageContent): (ImageContentPart | FileContentPart)[] {
    if (typeof content === "string" || !Array.isArray(content)) {
        return []
    }
    return content.filter(
        (part): part is ImageContentPart | FileContentPart =>
            part.type === "image_url" || part.type === "file",
    )
}
