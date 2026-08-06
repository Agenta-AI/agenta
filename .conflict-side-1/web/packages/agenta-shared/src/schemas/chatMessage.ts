/**
 * Chat Message JSON Schemas
 *
 * JSON Schema definitions for validating chat messages in the editor.
 * These schemas support the OpenAI/Anthropic message format.
 */

/**
 * JSON Schema for message content - supports string or array of content parts.
 */
export const MESSAGE_CONTENT_SCHEMA = {
    anyOf: [
        // Simple string content
        {type: "string"},
        // Array of content parts
        {
            type: "array",
            items: {
                anyOf: [
                    // Text content part
                    {
                        type: "object",
                        properties: {
                            type: {type: "string", const: "text"},
                            text: {type: "string"},
                        },
                        required: ["type", "text"],
                    },
                    // Image URL content part
                    {
                        type: "object",
                        properties: {
                            type: {type: "string", const: "image_url"},
                            image_url: {
                                type: "object",
                                properties: {
                                    url: {type: "string"},
                                    detail: {type: "string", enum: ["auto", "low", "high"]},
                                },
                                required: ["url"],
                            },
                        },
                        required: ["type", "image_url"],
                    },
                    // File content part
                    {
                        type: "object",
                        properties: {
                            type: {type: "string", const: "file"},
                            file: {
                                type: "object",
                                properties: {
                                    file_data: {type: "string"},
                                    file_id: {type: "string"},
                                    filename: {type: "string"},
                                    format: {type: "string"},
                                    name: {type: "string"},
                                    mime_type: {type: "string"},
                                },
                            },
                        },
                        required: ["type", "file"],
                    },
                ],
            },
        },
    ],
}

/**
 * JSON Schema for validating a full chat message in JSON mode.
 * Includes role, content, and optional fields like name, tool_call_id, tool_calls, etc.
 *
 * Supports:
 * - User/System messages: { role, content }
 * - Assistant messages: { role, content? } or { role, tool_calls } (content optional when tool_calls present)
 * - Tool messages: { role, content, name, tool_call_id }
 * - Provider-specific fields: provider_specific_fields, annotations, refusal, etc.
 */
export const CHAT_MESSAGE_SCHEMA = {
    type: "object",
    properties: {
        role: {
            type: "string",
            enum: ["system", "user", "assistant", "tool", "function"],
        },
        content: {
            anyOf: [
                MESSAGE_CONTENT_SCHEMA,
                {type: "null"}, // content can be null for assistant messages with tool_calls
            ],
        },
        name: {type: "string"}, // Function/tool name
        tool_call_id: {type: "string"}, // For tool response messages
        tool_calls: {
            type: "array",
            items: {
                type: "object",
                properties: {
                    id: {type: "string"},
                    type: {type: "string", const: "function"},
                    function: {
                        type: "object",
                        properties: {
                            name: {type: "string"},
                            arguments: {type: "string"},
                        },
                        required: ["name", "arguments"],
                    },
                },
                required: ["id", "type", "function"],
            },
        },
        // Provider-specific fields (OpenAI, Anthropic, etc.)
        provider_specific_fields: {type: "object"},
        annotations: {type: "array"},
        refusal: {anyOf: [{type: "string"}, {type: "null"}]},
        // Function calling (legacy)
        function_call: {
            type: "object",
            properties: {
                name: {type: "string"},
                arguments: {type: "string"},
            },
        },
    },
    required: ["role"], // Only role is always required; content is optional for assistant with tool_calls
}

/**
 * JSON Schema for validating an array of chat messages.
 */
export const CHAT_MESSAGES_ARRAY_SCHEMA = {
    type: "array",
    items: CHAT_MESSAGE_SCHEMA,
}
