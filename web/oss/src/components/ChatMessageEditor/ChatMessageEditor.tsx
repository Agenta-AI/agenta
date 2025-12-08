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
export type MessageContent = string | MessageContentPart[]

/** Simple message type for the editor - uses string role for flexibility */
export interface SimpleChatMessage {
    role: string
    content: MessageContent
    id?: string
}

/**
 * Extract text content from a message content value.
 * Handles both string content and array content with text parts.
 */
export function extractTextFromContent(content: MessageContent): string {
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
        const currentContent = updated[index].content
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
            content: addImageToContent(updated[index].content, imageUrl),
        }
        onChange(updated)
    }

    const handleAddFile = (index: number, fileData: string, filename: string, format: string) => {
        const updated = [...messages]
        updated[index] = {
            ...updated[index],
            content: addFileToContent(updated[index].content, fileData, filename, format),
        }
        onChange(updated)
    }

    const handleRemoveAttachment = (msgIndex: number, attachmentIndex: number) => {
        const updated = [...messages]
        updated[msgIndex] = {
            ...updated[msgIndex],
            content: removeAttachmentFromContent(updated[msgIndex].content, attachmentIndex),
        }
        onChange(updated)
    }

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            {messages.map((msg, index) => {
                const textContent = extractTextFromContent(msg.content)
                const attachments = getAttachments(msg.content)
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
                            headerRight={
                                <div className="flex items-center gap-1">
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
