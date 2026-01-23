import React from "react"

import {
    type SimpleChatMessage,
    extractTextFromContent,
    extractDisplayTextFromMessage,
    updateTextInContent,
    addImageToContent,
    addFileToContent,
    removeAttachmentFromContent,
    getAttachments,
} from "@agenta/shared"
import {MinusCircle, Plus} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

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
    /** Whether to show add/remove controls */
    showControls?: boolean
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
    enableTokens = false,
    templateFormat,
    tokens,
    ImagePreview,
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
        <div className={cn(flexLayouts.column, gapClasses.sm, className)}>
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
                    <div key={msg.id || `msg-${index}`} className={cn(flexLayouts.column)}>
                        <ChatMessageEditor
                            id={`chat-msg-${index}`}
                            role={msg.role}
                            text={textContent}
                            disabled={disabled}
                            className={messageClassName}
                            placeholder={placeholder}
                            onChangeRole={(role) => handleRoleChange(index, role)}
                            onChangeText={(text) => handleTextChange(index, text)}
                            enableTokens={enableTokens}
                            templateFormat={templateFormat}
                            tokens={tokens}
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
                                <div className={cn(flexLayouts.rowCenter, gapClasses.xs)}>
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
                                        content={msg.content!}
                                        onRemove={(attachmentIndex) =>
                                            handleRemoveAttachment(index, attachmentIndex)
                                        }
                                        disabled={disabled}
                                        ImagePreview={ImagePreview}
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

export default ChatMessageList
