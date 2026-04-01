import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

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

import {CollapseToggleButton, getCollapseStyle} from "../../components/presentational/buttons"
import {message, modal} from "../../utils/appMessageContext"
import {cn, flexLayouts, gapClasses} from "../../utils/styles"
import {createSnippetPdfAttachment} from "../utils/snippetAttachment"

import AttachmentButton from "./AttachmentButton"
import ChatMessageEditor from "./ChatMessageEditor"
import MarkdownToggleButton from "./MarkdownToggleButton"
import MessageAttachments from "./MessageAttachments"
import ToolMessageHeader from "./ToolMessageHeader"

const ChatMessageItem: React.FC<{
    msg: SimpleChatMessage
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
    maxPasteChars?: number
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
    maxPasteChars,
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

    const handleCreateSnippetFromPaste = useCallback(
        ({
            pastedText,
            maxPasteChars,
            overBy,
        }: {
            pastedText: string
            maxPasteChars: number
            overBy: number
        }) => {
            if (!allowFileUpload || !modal) {
                return false
            }

            const limitSummary =
                overBy > 0
                    ? `This paste is ${overBy.toLocaleString()} characters over the ${maxPasteChars.toLocaleString()}-character limit.`
                    : `This paste exceeds the ${maxPasteChars.toLocaleString()}-character limit.`

            modal.confirm({
                title: "That's too long to paste",
                content: `${limitSummary} To keep the editor responsive, you can attach the pasted content as a snippet instead.`,
                okText: "Create Snippet",
                cancelText: "Dismiss",
                centered: true,
                onOk: async () => {
                    try {
                        const {fileData, filename, mimeType} =
                            await createSnippetPdfAttachment(pastedText)
                        onAddFile(index, fileData, filename, mimeType)
                        message?.success(`Attached ${filename} as a snippet.`)
                    } catch (error) {
                        message?.error(
                            error instanceof Error
                                ? error.message
                                : "Failed to create snippet attachment.",
                        )
                        throw error
                    }
                },
            })

            return true
        },
        [allowFileUpload, index, onAddFile],
    )

    return (
        <div
            className={cn(flexLayouts.column)}
            ref={containerRef}
            style={getCollapseStyle(isMinimized, 72)}
        >
            <ChatMessageEditor
                id={`chat-msg-${index}`}
                role={msg.role}
                text={textContent}
                disabled={disabled}
                className={cn(messageClassName)}
                placeholder={placeholder}
                onChangeRole={(role) => onRoleChange(index, role)}
                onChangeText={(text) => onTextChange(index, text)}
                enableTokens={enableTokens}
                templateFormat={templateFormat}
                tokens={tokens}
                loadingFallback={loadingFallback}
                maxPasteChars={maxPasteChars}
                onPasteLimitExceeded={({pastedText, maxPasteChars, overBy}) =>
                    handleCreateSnippetFromPaste({pastedText, maxPasteChars, overBy})
                }
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
                            collapsedMaxHeight={48}
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
    /** Block paste operations that would make a message exceed this many characters. */
    maxPasteChars?: number
}

/**
 * A list of chat message editors for editing multiple messages.
 * This is a simpler alternative to ChatInputs that uses the same visual style
 * as the Playground message editors.
 */
let _keyCounter = 0
function generateKey(): string {
    return `__id-${++_keyCounter}-${Date.now()}`
}

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
    maxPasteChars,
}) => {
    // Maintain stable React keys for each message position.
    // This prevents React from reusing the wrong component instance
    // when messages are added or removed from the middle of the list.
    const stableKeysRef = useRef<string[]>([])

    const stableKeys = useMemo(() => {
        const prev = stableKeysRef.current
        const next: string[] = []

        for (let i = 0; i < messages.length; i++) {
            // Reuse existing key if we have one at this position, otherwise generate new
            if (i < prev.length) {
                next.push(prev[i])
            } else {
                next.push(messages[i].id || generateKey())
            }
        }

        stableKeysRef.current = next
        return next
    }, [messages])

    const [minimizedMessages, setMinimizedMessages] = useState<Record<string, boolean>>(() =>
        defaultMinimized ? Object.fromEntries(stableKeys.map((key) => [key, true])) : {},
    )

    useEffect(() => {
        if (!defaultMinimized) return

        setMinimizedMessages((prev) => {
            const next: Record<string, boolean> = {}

            for (const key of stableKeys) {
                next[key] = prev[key] ?? true
            }

            return next
        })
    }, [defaultMinimized, stableKeys])

    const handleRoleChange = useCallback(
        (index: number, role: string) => {
            const updated = [...messages]
            updated[index] = {...updated[index], role}
            onChange(updated)
        },
        [messages, onChange],
    )

    const handleTextChange = useCallback(
        (index: number, newText: string) => {
            const updated = [...messages]
            const currentContent = updated[index].content ?? ""
            updated[index] = {
                ...updated[index],
                content: updateTextInContent(currentContent, newText),
            }
            onChange(updated)
        },
        [messages, onChange],
    )

    const handleAddMessage = useCallback(() => {
        onChange([...messages, {role: "user", content: ""}])
    }, [messages, onChange])

    const handleRemoveMessage = useCallback(
        (index: number) => {
            // Remove the stable key at the deleted index so remaining messages
            // keep their original keys and React preserves the correct component instances
            stableKeysRef.current = stableKeysRef.current.filter((_, i) => i !== index)
            const updated = messages.filter((_, i) => i !== index)
            onChange(updated)
        },
        [messages, onChange],
    )

    const handleAddImage = useCallback(
        (index: number, imageUrl: string) => {
            const updated = [...messages]
            updated[index] = {
                ...updated[index],
                content: addImageToContent(updated[index].content ?? "", imageUrl),
            }
            onChange(updated)
        },
        [messages, onChange],
    )

    const handleAddFile = useCallback(
        (index: number, fileData: string, filename: string, format: string) => {
            const updated = [...messages]
            updated[index] = {
                ...updated[index],
                content: addFileToContent(updated[index].content ?? "", fileData, filename, format),
            }
            onChange(updated)
        },
        [messages, onChange],
    )

    const handleRemoveAttachment = useCallback(
        (msgIndex: number, attachmentIndex: number) => {
            const updated = [...messages]
            updated[msgIndex] = {
                ...updated[msgIndex],
                content: removeAttachmentFromContent(
                    updated[msgIndex].content ?? "",
                    attachmentIndex,
                ),
            }
            onChange(updated)
        },
        [messages, onChange],
    )

    return (
        <div className={cn(flexLayouts.column, gapClasses.sm, className)}>
            {messages.map((msg, index) => (
                <ChatMessageItem
                    key={stableKeys[index]}
                    msg={msg}
                    index={index}
                    disabled={disabled}
                    messageClassName={messageClassName}
                    placeholder={placeholder}
                    isMinimized={minimizedMessages[stableKeys[index]] ?? false}
                    showControls={showControls}
                    showRemoveButton={showRemoveButton}
                    showCopyButton={showCopyButton}
                    allowFileUpload={allowFileUpload}
                    enableTokens={enableTokens}
                    templateFormat={templateFormat}
                    tokens={tokens}
                    loadingFallback={loadingFallback}
                    maxPasteChars={maxPasteChars}
                    ImagePreview={ImagePreview}
                    onRoleChange={handleRoleChange}
                    onTextChange={handleTextChange}
                    onRemove={handleRemoveMessage}
                    onAddImage={handleAddImage}
                    onAddFile={handleAddFile}
                    onRemoveAttachment={handleRemoveAttachment}
                    onToggleMinimize={(i) => {
                        const key = stableKeys[i]
                        setMinimizedMessages((prev) => ({...prev, [key]: !prev[key]}))
                    }}
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
