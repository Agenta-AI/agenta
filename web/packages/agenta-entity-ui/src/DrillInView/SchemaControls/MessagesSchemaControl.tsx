/**
 * MessagesSchemaControl
 *
 * Schema-driven control for rendering chat message arrays.
 * Uses ChatMessageList from @agenta/ui for a specialized message editing UI
 * with role dropdowns and rich text editors.
 *
 * Detects messages arrays via:
 * - x-parameter: "messages" in schema
 * - Array items with role/content properties
 */

import {memo, useCallback, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import type {SimpleChatMessage} from "@agenta/shared"
import {ChatMessageList} from "@agenta/ui"
import {Typography} from "antd"
import clsx from "clsx"

export interface MessagesSchemaControlProps {
    /** The schema property defining the messages array */
    schema: SchemaProperty | null | undefined
    /** Display label for the field */
    label: string
    /** Current value (array of messages) */
    value: unknown[] | null | undefined
    /** Change handler for the messages array */
    onChange: (value: unknown[]) => void
    /** Optional description for the field */
    description?: string
    /** Disable all controls */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
    /** Whether to show add/remove controls (default: true) */
    showControls?: boolean
    /** Whether to allow file uploads (default: true) */
    allowFileUpload?: boolean
}

/**
 * Check if a schema represents a messages array.
 * Returns true if:
 * - Schema has x-parameter: "messages"
 * - Schema is an array with items that have role/content properties
 */
export function isMessagesSchema(schema: SchemaProperty | null | undefined): boolean {
    if (!schema) return false

    // Check for x-parameter: "messages"
    const xParam = schema["x-parameter"] as string | undefined
    if (xParam === "messages") return true

    // Check for array with message-like items
    if (schema.type === "array" && schema.items) {
        const itemSchema = schema.items as SchemaProperty
        if (itemSchema.type === "object" && itemSchema.properties) {
            const propNames = Object.keys(itemSchema.properties).map((k) => k.toLowerCase())
            // Must have role and content
            return propNames.includes("role") && propNames.includes("content")
        }
    }

    return false
}

/**
 * Convert raw value to SimpleChatMessage array format.
 * Handles various message formats and normalizes them.
 */
function normalizeMessages(value: unknown[] | null | undefined): SimpleChatMessage[] {
    if (!value || !Array.isArray(value)) return []

    return value.map((item, index) => {
        if (typeof item !== "object" || item === null) {
            // Non-object item - wrap as user message
            return {
                id: `msg-${index}`,
                role: "user",
                content: String(item),
            }
        }

        const msg = item as Record<string, unknown>

        // Extract role
        const role = (msg.role as string) || "user"

        // Extract content - handle various formats
        let content = msg.content
        if (content === undefined || content === null) {
            content = ""
        }

        return {
            id: (msg.id as string) || `msg-${index}`,
            role,
            content: content as SimpleChatMessage["content"],
            // Preserve optional fields
            name: msg.name as string | undefined,
            tool_call_id: msg.tool_call_id as string | undefined,
            tool_calls: msg.tool_calls as SimpleChatMessage["tool_calls"],
            function_call: msg.function_call as SimpleChatMessage["function_call"],
        }
    })
}

/**
 * Convert SimpleChatMessage array back to raw value format.
 * Preserves the original structure while applying edits.
 */
function denormalizeMessages(messages: SimpleChatMessage[]): Record<string, unknown>[] {
    return messages.map((msg) => {
        const result: Record<string, unknown> = {
            role: msg.role,
            content: msg.content,
        }

        // Only include optional fields if they have values
        if (msg.name) result.name = msg.name
        if (msg.tool_call_id) result.tool_call_id = msg.tool_call_id
        if (msg.tool_calls && msg.tool_calls.length > 0) result.tool_calls = msg.tool_calls
        if (msg.function_call) result.function_call = msg.function_call

        return result
    })
}

/**
 * Schema-driven control for chat message arrays.
 *
 * Provides the same message editing UI as the app playground:
 * - Role dropdown (user/assistant/system/tool)
 * - Rich text editor for content
 * - Add/remove message controls
 * - File/image attachment support
 *
 * @example
 * ```tsx
 * <MessagesSchemaControl
 *   schema={messagesSchema}
 *   label="Messages"
 *   value={messages}
 *   onChange={(v) => dispatch({ type: 'setAtPath', path: ['messages'], value: v })}
 * />
 * ```
 */
export const MessagesSchemaControl = memo(function MessagesSchemaControl({
    schema,
    label,
    value,
    onChange,
    description,
    disabled = false,
    className,
    showControls = true,
    allowFileUpload = true,
}: MessagesSchemaControlProps) {
    // Normalize messages to SimpleChatMessage format
    const normalizedMessages = useMemo(() => normalizeMessages(value), [value])

    // Handle changes from ChatMessageList
    const handleChange = useCallback(
        (messages: SimpleChatMessage[]) => {
            onChange(denormalizeMessages(messages))
        },
        [onChange],
    )

    // Empty state when disabled
    if (disabled && (!value || (Array.isArray(value) && value.length === 0))) {
        return (
            <div className={clsx("flex flex-col gap-1", className)}>
                {label && (
                    <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
                )}
                <Typography.Text type="secondary" className="text-xs">
                    No messages
                </Typography.Text>
            </div>
        )
    }

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            {label && <Typography.Text className="text-sm font-medium">{label}</Typography.Text>}
            {description && (
                <Typography.Text type="secondary" className="text-xs">
                    {description}
                </Typography.Text>
            )}
            <ChatMessageList
                messages={normalizedMessages}
                onChange={handleChange}
                disabled={disabled}
                showControls={showControls}
                allowFileUpload={allowFileUpload}
                placeholder="Enter message..."
                enableTokens={true}
                templateFormat="curly"
            />
        </div>
    )
})
