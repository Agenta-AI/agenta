import {useEffect, useRef, useState} from "react"

import {useLazyEffect} from "@agenta/shared/hooks"
import {extractTextFromContent} from "@agenta/shared/utils"
import {MinusOutlined, PlusOutlined, PictureOutlined} from "@ant-design/icons"
import {Button, Input, Select, Space, Tooltip} from "antd"
import cloneDeep from "lodash/cloneDeep"
import {v4 as uuidv4} from "uuid"

import {CopyButton} from "../../components/presentational/CopyButton"

// ============================================================================
// TYPES
// ============================================================================

const CHAT_ROLES = {
    System: "system",
    User: "user",
    Assistant: "assistant",
} as const

type ChatRole = (typeof CHAT_ROLES)[keyof typeof CHAT_ROLES]

interface ChatImageURL {
    url: string
    detail?: "auto" | "low" | "high"
}

interface ChatMessageContentText {
    type: "text"
    text: string
}

interface ChatMessageContentImage {
    type: "image_url"
    image_url: ChatImageURL
}

interface ChatMessageContentFile {
    type: "file"
    file: {
        file_id?: string
        name?: string
        mime_type?: string
        file_data?: string
        filename?: string
        format?: string
    }
}

type ChatMessageContent =
    | string
    | (ChatMessageContentText | ChatMessageContentImage | ChatMessageContentFile)[]

export interface ChatInputMessage {
    role: ChatRole
    content: ChatMessageContent
    id?: string
}

// ============================================================================
// HELPERS
// ============================================================================

export const getDefaultNewMessage = (): ChatInputMessage => ({
    id: uuidv4(),
    role: CHAT_ROLES.User,
    content: "",
})

// ============================================================================
// PROPS
// ============================================================================

export interface ChatInputsProps {
    defaultValue?: ChatInputMessage[]
    value?: ChatInputMessage[]
    onChange?: (value: ChatInputMessage[]) => void
    maxRows?: number
    disableAdd?: boolean
    disableRemove?: boolean
    disableEditRole?: boolean
    disableEditContent?: boolean
    readonly?: boolean
    isLoading?: boolean
    /** Optional render prop for image upload UI per message */
    renderImageUpload?: (props: {
        msgIdx: number
        imgIdx: number
        imageUrl: string
        onUpdate: (url: string) => void
        onRemove: () => void
    }) => React.ReactNode
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * @deprecated Use ChatMessageList instead. This legacy component uses raw Input/Select
 * instead of SharedEditor and has zero consumers.
 */
const ChatInputs: React.FC<ChatInputsProps> = ({
    defaultValue,
    value,
    onChange,
    maxRows = 12,
    disableAdd: _disableAdd,
    disableRemove: _disableRemove,
    disableEditRole: _disableEditRole,
    disableEditContent,
    readonly,
    isLoading,
    renderImageUpload,
}) => {
    let disableAdd = _disableAdd
    let disableRemove = _disableRemove
    let disableEditRole = _disableEditRole

    const [messages, setMessages] = useState<ChatInputMessage[]>(
        cloneDeep(value || defaultValue || [getDefaultNewMessage()]),
    )
    const onChangeRef = useRef(onChange)

    if (readonly) {
        disableAdd = true
        disableRemove = true
        disableEditRole = true
    }

    const updateMessages = (newMessages: ChatInputMessage[]) => {
        setMessages(newMessages)
        if (onChangeRef.current) {
            onChangeRef.current(cloneDeep(newMessages))
        }
    }

    const handleRoleChange = (index: number, role: ChatRole) => {
        const newMessages = [...messages]
        newMessages[index].role = role
        updateMessages(newMessages)
    }

    const handleInputChange = (index: number, event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const {value} = event.target
        const newMessages = [...messages]
        const msg = newMessages[index]

        const existingContent = Array.isArray(msg.content)
            ? msg.content
            : msg.content
              ? [{type: "text" as const, text: msg.content}]
              : []

        const updatedContent = [
            {type: "text" as const, text: value},
            ...existingContent.filter((part) => part.type !== "text"),
        ]

        msg.content = updatedContent
        updateMessages(newMessages)
    }

    const handleDelete = (index: number) => {
        const newMessages = messages.filter((_, i) => i !== index)
        updateMessages(newMessages)
    }

    const handleAdd = () => {
        const newMessages = messages.concat([getDefaultNewMessage()])
        updateMessages(newMessages)
    }

    const updateImagePart = (msgIdx: number, imgIdx: number, newUrl: string) => {
        const newMessages = [...messages]
        const msg = newMessages[msgIdx]

        if (!Array.isArray(msg.content)) return

        let imageIdx = 0
        msg.content = msg.content.map((part) => {
            if (part.type === "image_url") {
                if (imageIdx === imgIdx) {
                    imageIdx++
                    return {
                        ...part,
                        image_url: {
                            ...part.image_url,
                            url: newUrl,
                        },
                    }
                }
                imageIdx++
            }
            return part
        })

        updateMessages(newMessages)
    }

    const handleRemoveImage = (msgIdx: number, imgIdx: number) => {
        const newMessages = [...messages]
        const msg = newMessages[msgIdx]

        if (!Array.isArray(msg.content)) return

        let imageIndex = -1
        msg.content = msg.content.filter((part) => {
            if (part.type === "image_url") {
                imageIndex++
                return imageIndex !== imgIdx
            }
            return true
        })

        updateMessages(newMessages)
    }

    useEffect(() => {
        onChangeRef.current = onChange
    }, [onChange])

    useLazyEffect(() => {
        if (Array.isArray(value)) setMessages(cloneDeep(value))
    }, [JSON.stringify(value)])

    const lastAssistantMsg = messages.filter((msg) => msg.role === CHAT_ROLES.Assistant)

    const insertEmptyImagePart = (index: number) => {
        const newMessages = [...messages]
        const msg = newMessages[index]

        const existingContent = Array.isArray(msg.content)
            ? msg.content
            : msg.content
              ? [{type: "text" as const, text: msg.content}]
              : []

        msg.content = [
            ...existingContent,
            {
                type: "image_url" as const,
                image_url: {
                    url: "",
                    detail: "auto" as const,
                },
            },
        ]

        updateMessages(newMessages)
    }

    const getTextFromContent = (content: ChatMessageContent): string => {
        if (typeof content === "string") return content
        if (Array.isArray(content)) {
            return extractTextFromContent(
                content.map((part) => {
                    if (part.type === "text") return {type: "text" as const, text: part.text}
                    return part
                }),
            )
        }
        return ""
    }

    return (
        <div className="flex flex-col gap-4 w-full">
            {messages.map((msg, ix) => {
                const textValue = getTextFromContent(msg.content)
                const isErrorText = textValue.startsWith("❌")

                const imageParts = Array.isArray(msg.content)
                    ? msg.content.filter(
                          (part): part is ChatMessageContentImage => part.type === "image_url",
                      )
                    : []

                return (
                    <div className="flex flex-col gap-4" key={msg.id || msg.role + ix}>
                        <div className="flex items-center gap-2 [&_.ant-select]:w-[110px] [&_.ant-select]:self-start [&_textarea]:!mt-0 [&_textarea]:flex-1 [&_textarea]:min-w-[240px] [&_textarea]:max-w-[800px]">
                            <Select
                                style={{width: 150}}
                                disabled={disableEditRole}
                                options={Object.keys(CHAT_ROLES).map((role) => ({
                                    label: role,
                                    value: CHAT_ROLES[role as keyof typeof CHAT_ROLES],
                                }))}
                                value={msg.role}
                                onChange={(newRole) => handleRoleChange(ix, newRole)}
                            />
                            <div className="relative w-full">
                                <Input.TextArea
                                    className={
                                        isErrorText
                                            ? "!bg-red-50 !text-black/[0.88] dark:!bg-red-950 dark:!text-white/[0.85]"
                                            : ""
                                    }
                                    style={{maxWidth: "none"}}
                                    disabled={disableEditContent}
                                    autoSize={{maxRows}}
                                    value={textValue}
                                    onChange={(e) => handleInputChange(ix, e)}
                                    readOnly={readonly}
                                />
                                {lastAssistantMsg[lastAssistantMsg.length - 1]?.id === msg.id && (
                                    <CopyButton
                                        buttonText={null}
                                        text={
                                            lastAssistantMsg.length
                                                ? getTextFromContent(
                                                      lastAssistantMsg[lastAssistantMsg.length - 1]
                                                          .content,
                                                  )
                                                : ""
                                        }
                                        disabled={
                                            isLoading ||
                                            !getTextFromContent(
                                                lastAssistantMsg[lastAssistantMsg.length - 1]
                                                    .content,
                                            )
                                        }
                                        icon={true}
                                        className="absolute right-1 bottom-[1px] !border-0 !h-[30px] opacity-50 text-[var(--ant-color-primary)]"
                                    />
                                )}
                            </div>
                            {messages.length > 1 && !disableRemove && (
                                <Tooltip title="Remove">
                                    <Button
                                        shape="circle"
                                        size="small"
                                        icon={<MinusOutlined />}
                                        onClick={() => handleDelete(ix)}
                                    />
                                </Tooltip>
                            )}
                            {!readonly && msg.role === CHAT_ROLES.User && (
                                <Tooltip title="Add image">
                                    <Button
                                        shape="circle"
                                        size="small"
                                        icon={<PictureOutlined />}
                                        onClick={() => insertEmptyImagePart(ix)}
                                        disabled={imageParts.length >= 5}
                                    />
                                </Tooltip>
                            )}
                        </div>
                        {msg.role === CHAT_ROLES.User &&
                            imageParts.map((img, imgIdx) =>
                                renderImageUpload ? (
                                    renderImageUpload({
                                        msgIdx: ix,
                                        imgIdx,
                                        imageUrl: img.image_url.url,
                                        onUpdate: (url: string) => updateImagePart(ix, imgIdx, url),
                                        onRemove: () => handleRemoveImage(ix, imgIdx),
                                    })
                                ) : (
                                    <div
                                        key={imgIdx}
                                        className="flex items-center gap-2 text-sm text-gray-500"
                                    >
                                        <span>Image {imgIdx + 1}</span>
                                        <Button
                                            size="small"
                                            onClick={() => handleRemoveImage(ix, imgIdx)}
                                        >
                                            Remove
                                        </Button>
                                    </div>
                                ),
                            )}
                    </div>
                )
            })}

            <Space>
                {!disableAdd && (
                    <Tooltip title="Add input">
                        <Button
                            shape="circle"
                            icon={<PlusOutlined />}
                            onClick={handleAdd}
                            size="small"
                        />
                    </Tooltip>
                )}
            </Space>
        </div>
    )
}

export default ChatInputs
