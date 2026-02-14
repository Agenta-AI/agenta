import React, {useEffect, useRef, useState} from "react"

// Inner component so each message owns its own ref for overflow detection
const ChatMessageItem: React.FC<{
    msg: import("@agenta/shared/types").SimpleChatMessage
    index: number
    disabled?: boolean
    messageClassName?: string
    placeholder: string
    isMinimized: boolean
    showControls: boolean
    showRemoveButton?: boolean
    showCopyButton: boolean
    allowFileUpload: boolean
    enableTokens: boolean
    templateFormat?: "curly" | "fstring" | "jinja2"
    tokens?: string[]
    loadingFallback: "skeleton" | "none" | "static"
    ImagePreview?: React.ComponentType<{
        src: string
        alt: string
        size: number
        isValidPreview: boolean
    }>
    onRoleChange: (index: number, role: string) => void
    onTextChange: (index: number, text: string) => void
    onRemove: (index: number) => void
    onAddImage: (index: number, url: string) => void
    onAddFile: (index: number, data: string, name: string, format: string) => void
    onRemoveAttachment: (msgIndex: number, attachmentIndex: number) => void
    onToggleMinimize: (index: number) => void
}> = ({
    msg,
    index,
    disabled,
    messageClassName,
    placeholder,
    isMinimized,
    showControls,
    showRemoveButton,
    showCopyButton,
    allowFileUpload,
    enableTokens,
    templateFormat,
    tokens,
    loadingFallback,
    ImagePreview,
    onRoleChange,
    onTextChange,
    onRemove,
    onAddImage,
    onAddFile,
    onRemoveAttachment,
    onToggleMinimize,
}) => {
    const containerRef = useRef<HTMLDivElement>(null)

    const isToolResponse = msg.role === "tool"
    const hasToolCalls = Boolean(msg.tool_calls && msg.tool_calls.length > 0)
    const textContent = hasToolCalls
        ? extractDisplayTextFromMessage(msg)
        : extractTextFromContent(msg.content ?? null)
    const attachments = getAttachments(msg.content ?? null)
    const hasAttachmentsFlag = attachments.length > 0

    return (
        <div key={msg.id || `msg-${index}`} className={cn(flexLayouts.column)} ref={containerRef}>
            <ChatMessageEditor
                id={`chat-msg-${index}`}
                role={msg.role}
                text={textContent}
                disabled={disabled}
                className={cn(
                    messageClassName,
                    isMinimized &&
                        "[&_.agenta-editor-wrapper]:max-h-[calc(8px+calc(2*19.88px))] [&_.agenta-editor-wrapper]:overflow-y-auto [&_.agenta-editor-wrapper]:!mb-0",
                )}
                placeholder={placeholder}
                onChangeRole={(role) => onRoleChange(index, role)}
                onChangeText={(text) => onTextChange(index, text)}
                enableTokens={enableTokens}
                templateFormat={templateFormat}
                tokens={tokens}
                loadingFallback={loadingFallback}
                headerBottom={
                    isToolResponse && (msg.name || msg.tool_call_id) ? (
                        <ToolMessageHeader name={msg.name} toolCallId={msg.tool_call_id} />
                    ) : undefined
                }
                headerRight={
                    <div
                        className={cn(
                            flexLayouts.rowCenter,
                            gapClasses.xs,
                            "invisible group-hover/item:visible",
                        )}
                    >
                        <MarkdownToggleButton id={`chat-msg-${index}`} />
                        {allowFileUpload && !disabled && (
                            <AttachmentButton
                                onAddImage={(url) => onAddImage(index, url)}
                                onAddFile={(data, name, format) =>
                                    onAddFile(index, data, name, format)
                                }
                                disabled={disabled}
                            />
                        )}
                        {showCopyButton && (
                            <Tooltip title="Copy">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<Copy size={14} />}
                                    onClick={() => {
                                        navigator.clipboard.writeText(textContent)
                                    }}
                                />
                            </Tooltip>
                        )}
                        {(showRemoveButton ?? showControls) && !disabled && (
                            <Tooltip title="Remove">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<MinusCircle size={14} />}
                                    onClick={() => onRemove(index)}
                                />
                            </Tooltip>
                        )}
                        <CollapseToggleButton
                            collapsed={isMinimized}
                            onToggle={() => onToggleMinimize(index)}
                            contentRef={containerRef}
                        />
                    </div>
                }
                footer={
                    hasAttachmentsFlag ? (
                        <MessageAttachments
                            content={msg.content!}
                            onRemove={(attachmentIndex) =>
                                onRemoveAttachment(index, attachmentIndex)
                            }
                            disabled={disabled}
                            ImagePreview={ImagePreview}
                        />
                    ) : undefined
                }
            />
        </div>
    )
}

import type {SimpleChatMessage} from "@agenta/shared/types"
import {
    extractTextFromContent,
    extractDisplayTextFromMessage,
    updateTextInContent,
    addImageToContent,
    addFileToContent,
    removeAttachmentFromContent,
    getAttachments,
} from "@agenta/shared/utils"
import {Copy, MinusCircle, Plus} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

import {CollapseToggleButton} from "../../components/presentational/buttons"
import {cn, flexLayouts, gapClasses} from "../../utils/styles"

import AttachmentButton from "./AttachmentButton"
import ChatMessageEditor from "./ChatMessageEditor"
import MarkdownToggleButton from "./MarkdownToggleButton"
import MessageAttachments from "./MessageAttachments"
import ToolMessageHeader from "./ToolMessageHeader"

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
    /** Whether to show add/remove controls (add message button + per-message remove) */
    showControls?: boolean
    /** Whether to show per-message remove button (independent of showControls) */
    showRemoveButton?: boolean
    /** Whether to show per-message copy button */
    showCopyButton?: boolean
    /** Whether to allow file uploads */
    allowFileUpload?: boolean
    /** Whether to enable variable token highlighting */
    enableTokens?: boolean
    /** Template format for variable syntax highlighting */
    templateFormat?: "curly" | "fstring" | "jinja2"
    /** Available template variables for token highlighting */
    tokens?: string[]
    /** Optional image preview component */
    ImagePreview?: React.ComponentType<{
        src: string
        alt: string
        size: number
        isValidPreview: boolean
    }>
    /** Whether messages should start minimized */
    defaultMinimized?: boolean
    /** Suspense fallback mode for editor plugins */
    loadingFallback?: "skeleton" | "none" | "static"
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
    showRemoveButton,
    showCopyButton = false,
    allowFileUpload = true,
    enableTokens = false,
    templateFormat,
    tokens,
    ImagePreview,
    defaultMinimized = false,
    loadingFallback = "skeleton",
}) => {
    const [minimizedMessages, setMinimizedMessages] = useState<Record<number, boolean>>(() =>
        defaultMinimized ? Object.fromEntries(messages.map((_, index) => [index, true])) : {},
    )

    useEffect(() => {
        if (!defaultMinimized) return

        setMinimizedMessages((prev) => {
            const next: Record<number, boolean> = {}

            for (let i = 0; i < messages.length; i += 1) {
                next[i] = prev[i] ?? true
            }

            return next
        })
    }, [defaultMinimized, messages.length])

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
        <div className={cn(flexLayouts.column, gapClasses.sm, className)}>
            {messages.map((msg, index) => (
                <ChatMessageItem
                    key={msg.id || `msg-${index}`}
                    msg={msg}
                    index={index}
                    disabled={disabled}
                    messageClassName={messageClassName}
                    placeholder={placeholder}
                    isMinimized={minimizedMessages[index] ?? false}
                    showControls={showControls}
                    showRemoveButton={showRemoveButton}
                    showCopyButton={showCopyButton}
                    allowFileUpload={allowFileUpload}
                    enableTokens={enableTokens}
                    templateFormat={templateFormat}
                    tokens={tokens}
                    loadingFallback={loadingFallback}
                    ImagePreview={ImagePreview}
                    onRoleChange={handleRoleChange}
                    onTextChange={handleTextChange}
                    onRemove={handleRemoveMessage}
                    onAddImage={handleAddImage}
                    onAddFile={handleAddFile}
                    onRemoveAttachment={handleRemoveAttachment}
                    onToggleMinimize={(i) =>
                        setMinimizedMessages((prev) => ({...prev, [i]: !prev[i]}))
                    }
                />
            ))}
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

export default ChatMessageList
