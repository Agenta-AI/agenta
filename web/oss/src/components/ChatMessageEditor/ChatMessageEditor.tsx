import React, {useCallback, useMemo, useRef} from "react"

import {
    FileArchive,
    Image as ImageIcon,
    MinusCircle,
    Paperclip,
    Plus,
    X,
} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps, Tooltip} from "antd"
import clsx from "clsx"

import ImagePreview from "@/oss/components/Common/ImagePreview"
import {EditorProvider} from "@/oss/components/Editor/Editor"
import SimpleDropdownSelect from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/SimpleDropdownSelect"
import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"

import MarkdownToggleButton from "./MarkdownToggleButton"

/** Content part types for complex message content */
export interface TextContentPart {
    type: "text"
    text: string
}

export interface ImageContentPart {
    type: "image_url"
    image_url: {
        url: string
        detail?: "auto" | "low" | "high"
    }
}

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

/** Simple message type for the editor - uses string role for flexibility */
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
 * Update text content while preserving attachments
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

// ============================================================================
// ToolMessageHeader - Header for tool response messages showing name and call ID
// ============================================================================

interface ToolMessageHeaderProps {
    /** Function/tool name */
    name?: string
    /** Tool call ID this message responds to */
    toolCallId?: string
    /** Additional class name */
    className?: string
}

/**
 * Header component for tool response messages, showing the function name and call ID.
 * Similar to the playground's ToolCallViewHeader.
 */
export const ToolMessageHeader: React.FC<ToolMessageHeaderProps> = ({
    name,
    toolCallId,
    className,
}) => {
    if (!name && !toolCallId) return null

    return (
        <div
            className={clsx(
                "w-full flex items-center justify-between text-xs text-gray-500 px-1 py-1",
                className,
            )}
        >
            {name && (
                <Tooltip title="Function name">
                    <span className="font-medium text-gray-600">{name}</span>
                </Tooltip>
            )}
            {toolCallId && (
                <Tooltip title="Tool call ID">
                    <span className="font-mono text-gray-400 truncate max-w-[200px]">
                        {toolCallId}
                    </span>
                </Tooltip>
            )}
        </div>
    )
}

/**
 * JSON Schema for message content - supports string or array of content parts.
 */
const MESSAGE_CONTENT_SCHEMA = {
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
const CHAT_MESSAGE_SCHEMA = {
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

/**
 * JSON Schema for validating a single chat message.
 */
export {CHAT_MESSAGE_SCHEMA}

export interface ChatMessageEditorProps {
    /** Unique ID for the editor instance */
    id?: string
    /** The role of the message (user, assistant, system, tool) */
    role: string
    /** The text content of the message */
    text: string
    /** Whether the editor is disabled */
    disabled?: boolean
    /** Additional class name for the container */
    className?: string
    /** Additional class name for the editor */
    editorClassName?: string
    /** Additional class name for the header */
    headerClassName?: string
    /** Placeholder text when empty */
    placeholder?: string
    /** Callback when role changes */
    onChangeRole?: (role: string) => void
    /** Callback when text content changes */
    onChangeText?: (text: string) => void
    /** Content to render on the right side of the header */
    headerRight?: React.ReactNode
    /** Content to render below the header */
    headerBottom?: React.ReactNode
    /** Content to render in the footer */
    footer?: React.ReactNode
    /** Whether the content is JSON */
    isJSON?: boolean
    /** Whether this is a tool message */
    isTool?: boolean
    /** Custom role options for the dropdown */
    roleOptions?: {label: string; value: string}[]
    /** Whether to enable token highlighting */
    enableTokens?: boolean
    /** Editor state: filled, readOnly, etc. */
    state?: "filled" | "readOnly"
    /** Editor type: border, borderless */
    editorType?: "border" | "borderless"
    /** Custom validation schema for JSON content */
    validationSchema?: unknown
}

/**
 * A standalone chat message editor component that can be used outside of the Playground.
 * This component provides a role dropdown and text editor for editing chat messages.
 */
const ChatMessageEditorInner: React.FC<ChatMessageEditorProps> = ({
    id,
    role,
    text,
    disabled,
    className,
    editorClassName,
    headerClassName,
    placeholder,
    onChangeRole,
    onChangeText,
    headerRight,
    headerBottom,
    footer,
    isJSON,
    roleOptions,
    enableTokens,
    state = "filled",
    editorType = "border",
    validationSchema,
    ...props
}) => {
    const selectOptions = useMemo(
        () =>
            roleOptions ?? [
                {label: "user", value: "user"},
                {label: "assistant", value: "assistant"},
                {label: "system", value: "system"},
                {label: "tool", value: "tool"},
            ],
        [roleOptions],
    )

    // Use provided schema or default MESSAGE_CONTENT_SCHEMA for JSON mode
    const effectiveSchema = useMemo(() => {
        if (validationSchema !== undefined) {
            return validationSchema
        }
        return isJSON ? MESSAGE_CONTENT_SCHEMA : undefined
    }, [validationSchema, isJSON])

    return (
        <SharedEditor
            id={id}
            header={
                <div className={clsx("w-full flex flex-col", headerClassName)}>
                    <div
                        className={clsx(
                            "w-full flex items-center justify-between",
                            headerClassName,
                        )}
                    >
                        <SimpleDropdownSelect
                            value={role}
                            options={selectOptions}
                            onChange={(v) => onChangeRole?.(v)}
                            disabled={disabled}
                            className="message-user-select"
                        />
                        {headerRight}
                    </div>
                    {headerBottom}
                </div>
            }
            editorType={editorType}
            initialValue={text}
            handleChange={(v: string) => onChangeText?.(v)}
            editorClassName={editorClassName}
            placeholder={placeholder}
            disabled={disabled}
            state={state}
            className={clsx("relative flex flex-col gap-1 rounded-[theme(spacing.2)]", className)}
            footer={footer}
            {...props}
            editorProps={{
                codeOnly: isJSON,
                noProvider: true,
                enableTokens: Boolean(enableTokens),
                showToolbar: false,
                validationSchema: effectiveSchema,
            }}
            noProvider={true}
        />
    )
}

/**
 * Chat message editor with EditorProvider wrapper.
 * Use this component for standalone message editing outside of the Playground.
 */
const ChatMessageEditor: React.FC<ChatMessageEditorProps> = ({isJSON, isTool, ...props}) => {
    return (
        <EditorProvider
            codeOnly={isTool || isJSON}
            enableTokens={Boolean(props.enableTokens)}
            showToolbar={false}
            id={`${props.id}-${isJSON}`}
        >
            <ChatMessageEditorInner isJSON={isJSON} {...props} />
        </EditorProvider>
    )
}

export default ChatMessageEditor

// ============================================================================
// ChatMessageList - A list of editable chat messages
// ============================================================================

export interface ChatMessageListProps {
    /** Array of chat messages to display */
    messages: SimpleChatMessage[]
    /** Callback when messages change */
    onChange: (messages: SimpleChatMessage[]) => void
    /** Whether the list is disabled */
    disabled?: boolean
    /** Additional class name for the container */
    className?: string
    /** Additional class name for each message editor */
    messageClassName?: string
    /** Placeholder text for empty messages */
    placeholder?: string
    /** Whether to show add/remove controls */
    showControls?: boolean
    /** Whether to allow file uploads */
    allowFileUpload?: boolean
}

// ============================================================================
// MessageAttachments - Display and manage attachments for a single message
// ============================================================================

interface MessageAttachmentsProps {
    content: MessageContent
    onRemove: (index: number) => void
    disabled?: boolean
}

const MessageAttachments: React.FC<MessageAttachmentsProps> = ({content, onRemove, disabled}) => {
    const attachments = getAttachments(content)
    if (attachments.length === 0) return null

    return (
        <div className="flex flex-wrap gap-2 mt-2">
            {attachments.map((attachment, index) => {
                if (attachment.type === "image_url") {
                    const url = attachment.image_url.url
                    return (
                        <div
                            key={`img-${index}`}
                            className="relative group rounded-md overflow-hidden border border-gray-200"
                        >
                            <ImagePreview
                                src={url}
                                alt={`Attachment ${index + 1}`}
                                size={64}
                                isValidPreview={true}
                            />
                            {!disabled && (
                                <button
                                    type="button"
                                    onClick={() => onRemove(index)}
                                    className="absolute top-0 right-0 bg-red-500 text-white rounded-bl-md p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                    title="Remove image"
                                >
                                    <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </button>
                            )}
                        </div>
                    )
                }
                if (attachment.type === "file") {
                    const filename = attachment.file.filename || attachment.file.name || "Document"
                    return (
                        <div
                            key={`file-${index}`}
                            className="relative group flex items-center gap-2 px-2 py-1 rounded-md border border-gray-200 bg-gray-50"
                        >
                            <FileArchive size={16} className="text-gray-500" />
                            <span className="text-xs text-gray-600 max-w-[120px] truncate">
                                {filename}
                            </span>
                            {!disabled && (
                                <Tooltip title="Remove file">
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<X size={12} />}
                                        onClick={() => onRemove(index)}
                                        className="!p-0 !h-auto !min-w-0 text-gray-400 hover:!text-red-500"
                                    />
                                </Tooltip>
                            )}
                        </div>
                    )
                }
                return null
            })}
        </div>
    )
}

// ============================================================================
// AttachmentButton - Dropdown button for adding attachments
// ============================================================================

interface AttachmentButtonProps {
    onAddImage: (imageUrl: string) => void
    onAddFile: (fileData: string, filename: string, format: string) => void
    disabled?: boolean
}

const AttachmentButton: React.FC<AttachmentButtonProps> = ({onAddImage, onAddFile, disabled}) => {
    const imageInputRef = useRef<HTMLInputElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleImageSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = () => {
                onAddImage(reader.result as string)
            }
            reader.readAsDataURL(file)
            // Reset input
            if (imageInputRef.current) imageInputRef.current.value = ""
        },
        [onAddImage],
    )

    const handleFileSelect = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const file = e.target.files?.[0]
            if (!file) return

            const reader = new FileReader()
            reader.onload = () => {
                onAddFile(reader.result as string, file.name, file.type)
            }
            reader.readAsDataURL(file)
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = ""
        },
        [onAddFile],
    )

    const menuItems: MenuProps["items"] = [
        {
            key: "image",
            label: (
                <span className="flex items-center gap-2">
                    <ImageIcon size={14} />
                    <span>Upload image</span>
                </span>
            ),
            onClick: () => imageInputRef.current?.click(),
        },
        {
            key: "file",
            label: (
                <span className="flex items-center gap-2">
                    <FileArchive size={14} />
                    <span>Attach document</span>
                </span>
            ),
            onClick: () => fileInputRef.current?.click(),
        },
    ]

    return (
        <>
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleImageSelect}
            />
            <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.txt,.csv,.json,.xml"
                hidden
                onChange={handleFileSelect}
            />
            <Dropdown menu={{items: menuItems}} trigger={["click"]} disabled={disabled}>
                <Button
                    type="text"
                    size="small"
                    icon={<Paperclip size={14} />}
                    className="text-gray-400 hover:text-gray-600"
                    title="Add attachment"
                />
            </Dropdown>
        </>
    )
}

/**
 * A list of chat message editors for editing multiple messages.
 * This is a simpler alternative to ChatInputs that uses the same visual style
 * as the Playground message editors.
 */
export const ChatMessageList: React.FC<ChatMessageListProps> = ({
    messages,
    onChange,
    disabled,
    className,
    messageClassName,
    placeholder = "Enter message...",
    showControls = true,
    allowFileUpload = true,
}) => {
    const handleRoleChange = (index: number, role: string) => {
        const updated = [...messages]
        updated[index] = {...updated[index], role}
        onChange(updated)
    }

    const handleTextChange = (index: number, newText: string) => {
        const updated = [...messages]
        const currentContent = updated[index].content ?? ""
        // Preserve attachments when updating text
        updated[index] = {
            ...updated[index],
            content: updateTextInContent(currentContent, newText),
        }
        onChange(updated)
    }

    const handleAddMessage = () => {
        onChange([...messages, {role: "user", content: ""}])
    }

    const handleRemoveMessage = (index: number) => {
        const updated = messages.filter((_, i) => i !== index)
        onChange(updated)
    }

    const handleAddImage = (index: number, imageUrl: string) => {
        const updated = [...messages]
        updated[index] = {
            ...updated[index],
            content: addImageToContent(updated[index].content ?? "", imageUrl),
        }
        onChange(updated)
    }

    const handleAddFile = (index: number, fileData: string, filename: string, format: string) => {
        const updated = [...messages]
        updated[index] = {
            ...updated[index],
            content: addFileToContent(updated[index].content ?? "", fileData, filename, format),
        }
        onChange(updated)
    }

    const handleRemoveAttachment = (msgIndex: number, attachmentIndex: number) => {
        const updated = [...messages]
        updated[msgIndex] = {
            ...updated[msgIndex],
            content: removeAttachmentFromContent(updated[msgIndex].content ?? "", attachmentIndex),
        }
        onChange(updated)
    }

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            {messages.map((msg, index) => {
                // Check message type
                const isToolResponse = msg.role === "tool"
                const hasToolCalls = Boolean(msg.tool_calls && msg.tool_calls.length > 0)

                // Get text content - for assistant with tool_calls, show formatted tool calls
                const textContent = hasToolCalls
                    ? extractDisplayTextFromMessage(msg)
                    : extractTextFromContent(msg.content ?? null)

                const attachments = getAttachments(msg.content ?? null)
                const hasAttachmentsFlag = attachments.length > 0

                return (
                    <div key={msg.id || `msg-${index}`} className="flex flex-col">
                        <ChatMessageEditor
                            id={`chat-msg-${index}`}
                            role={msg.role}
                            text={textContent}
                            disabled={disabled}
                            className={messageClassName}
                            placeholder={placeholder}
                            onChangeRole={(role) => handleRoleChange(index, role)}
                            onChangeText={(text) => handleTextChange(index, text)}
                            headerBottom={
                                // Show tool info header for tool response messages
                                isToolResponse && (msg.name || msg.tool_call_id) ? (
                                    <ToolMessageHeader
                                        name={msg.name}
                                        toolCallId={msg.tool_call_id}
                                    />
                                ) : undefined
                            }
                            headerRight={
                                <div className="flex items-center gap-1">
                                    <MarkdownToggleButton id={`chat-msg-${index}`} />
                                    {allowFileUpload && !disabled && (
                                        <AttachmentButton
                                            onAddImage={(url) => handleAddImage(index, url)}
                                            onAddFile={(data, name, format) =>
                                                handleAddFile(index, data, name, format)
                                            }
                                            disabled={disabled}
                                        />
                                    )}
                                    {showControls && !disabled && (
                                        <Tooltip title="Remove">
                                            <Button
                                                type="text"
                                                size="small"
                                                icon={<MinusCircle size={14} />}
                                                onClick={() => handleRemoveMessage(index)}
                                            />
                                        </Tooltip>
                                    )}
                                </div>
                            }
                            footer={
                                hasAttachmentsFlag ? (
                                    <MessageAttachments
                                        content={msg.content}
                                        onRemove={(attachmentIndex) =>
                                            handleRemoveAttachment(index, attachmentIndex)
                                        }
                                        disabled={disabled}
                                    />
                                ) : undefined
                            }
                        />
                    </div>
                )
            })}
            {showControls && !disabled && (
                <Button
                    variant="outlined"
                    color="default"
                    size="small"
                    icon={<Plus size={14} />}
                    onClick={handleAddMessage}
                    className="self-start"
                >
                    Message
                </Button>
            )}
        </div>
    )
}
