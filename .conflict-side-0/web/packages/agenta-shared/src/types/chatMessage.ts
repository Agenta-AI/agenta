/**
 * Chat Message Types
 *
 * Type definitions for chat message content, attachments, and tool calls.
 * These types support the OpenAI/Anthropic message format with extensions
 * for attachments and provider-specific fields.
 */

/** Text content part for complex message content */
export interface TextContentPart {
    type: "text"
    text: string
}

/** Image URL content part for image attachments */
export interface ImageContentPart {
    type: "image_url"
    image_url: {
        url: string
        detail?: "auto" | "low" | "high"
    }
}

/** File content part for document attachments */
export interface FileContentPart {
    type: "file"
    file: {
        file_data?: string
        file_id?: string
        filename?: string
        format?: string
        name?: string
        mime_type?: string
    }
}

/** Union type for all content part types */
export type MessageContentPart = TextContentPart | ImageContentPart | FileContentPart

/** Message content can be a string or an array of content parts */
export type MessageContent = string | MessageContentPart[] | null

/** Tool call structure for function calling */
export interface ToolCall {
    id: string
    type: "function"
    function: {
        name: string
        arguments: string
    }
}

/**
 * Simple message type for the editor - uses string role for flexibility.
 * Supports all standard OpenAI/Anthropic message fields plus extensions.
 */
export interface SimpleChatMessage {
    role: string
    content?: MessageContent
    id?: string
    // Tool calling fields
    name?: string // Function/tool name for tool responses
    tool_call_id?: string // ID of the tool call this message responds to
    tool_calls?: ToolCall[] // Tool calls made by assistant
    // Provider-specific fields (preserved but not edited)
    provider_specific_fields?: Record<string, unknown>
    annotations?: unknown[]
    refusal?: string | null
    // Legacy function calling
    function_call?: {
        name: string
        arguments: string
    }
}
