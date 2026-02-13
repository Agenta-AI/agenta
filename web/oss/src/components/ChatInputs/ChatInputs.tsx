import {useEffect, useRef, useState} from "react"

import {MinusOutlined, PlusOutlined, PictureOutlined} from "@ant-design/icons"
import {Button, Input, Select, Space, Tooltip} from "antd"
import cloneDeep from "lodash/cloneDeep"
import {createUseStyles} from "react-jss"
import {v4 as uuidv4} from "uuid"

import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {ChatMessage, ChatRole, JSSTheme} from "@/oss/lib/Types"

import CopyButton from "../CopyButton/CopyButton"
import {useAppTheme} from "../Layout/ThemeContextProvider"
import {getTextContent} from "../Playground/adapters/TurnMessageHeaderOptions"
import PromptImageUpload from "../Playground/Components/PlaygroundVariantPropertyControl/assets/PromptImageUpload"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        width: "100%",
    },
    row: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",

        "& .ant-select": {
            width: 110,
            alignSelf: "flex-start",
        },

        "& textarea": {
            marginTop: "0 !important",
            flex: 1,
            minWidth: 240,
            maxWidth: 800,
        },
    },
    copyButton: {
        position: "absolute",
        right: 4,
        border: 0,
        height: 30,
        opacity: 0.5,
        bottom: 1,
        color: theme.colorPrimary,
    },
}))

export const getDefaultNewMessage = () => ({
    id: uuidv4(),
    role: ChatRole.User,
    content: "",
})

interface Props {
    defaultValue?: ChatMessage[]
    value?: ChatMessage[]
    onChange?: (value: ChatMessage[]) => void
    maxRows?: number
    disableAdd?: boolean
    disableRemove?: boolean
    disableEditRole?: boolean
    disableEditContent?: boolean
    readonly?: boolean
    isLoading?: boolean
}

const ChatInputs: React.FC<Props> = ({
    defaultValue,
    value,
    onChange,
    maxRows = 12,
    disableAdd,
    disableRemove,
    disableEditRole,
    disableEditContent,
    readonly,
    isLoading,
}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const [messages, setMessages] = useState<ChatMessage[]>(
        cloneDeep(value || defaultValue || [getDefaultNewMessage()]),
    )
    const onChangeRef = useRef(onChange)

    if (readonly) {
        disableAdd = true
        disableRemove = true
        disableEditRole = true
    }

    const updateMessages = (newMessages: ChatMessage[]) => {
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
              ? [{type: "text", text: msg.content}]
              : []

        const updatedContent = [
            {type: "text", text: value},
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

    const lastAssistantMsg = messages.filter((msg) => msg.role === ChatRole.Assistant)

    const insertEmptyImagePart = (index: number) => {
        const newMessages = [...messages]
        const msg = newMessages[index]

        const existingContent = Array.isArray(msg.content)
            ? msg.content
            : msg.content
              ? [{type: "text", text: msg.content}]
              : []

        msg.content = [
            ...existingContent,
            {
                type: "image_url",
                image_url: {
                    url: "",
                    detail: "auto",
                },
            },
        ]

        updateMessages(newMessages)
    }

    return (
        <div className={classes.root}>
            {messages.map((msg, ix) => {
                const isErrorText =
                    typeof msg.content === "string"
                        ? msg.content.startsWith("❌")
                        : Array.isArray(msg.content)
                          ? msg.content[0]?.type === "text" &&
                            msg.content[0]?.text?.startsWith("❌")
                          : false

                const imageParts = Array.isArray(msg.content)
                    ? msg.content.filter((part) => part.type === "image_url")
                    : []

                return (
                    <div className="flex flex-col gap-4" key={msg.id || msg.role + ix}>
                        <div className={classes.row}>
                            <Select
                                style={{width: 150}}
                                disabled={disableEditRole}
                                options={Object.keys(ChatRole).map((role) => ({
                                    label: role,
                                    value: ChatRole[role as keyof typeof ChatRole],
                                }))}
                                value={msg.role}
                                onChange={(newRole) => handleRoleChange(ix, newRole)}
                            />
                            <div className="relative w-[100%]">
                                <Input.TextArea
                                    style={{
                                        maxWidth: "none",
                                        background: isErrorText
                                            ? appTheme === "dark"
                                                ? "#490b0b"
                                                : "#fff1f0"
                                            : "",
                                        color: isErrorText
                                            ? appTheme === "dark"
                                                ? "#ffffffd9"
                                                : "#000000e0"
                                            : "",
                                    }}
                                    disabled={disableEditContent}
                                    autoSize={{maxRows}}
                                    value={
                                        Array.isArray(msg.content)
                                            ? msg.content.find((part) => part.type === "text")
                                                  ?.text || ""
                                            : typeof msg.content === "string"
                                              ? msg.content
                                              : ""
                                    }
                                    onChange={(e) => handleInputChange(ix, e)}
                                    readOnly={readonly}
                                />
                                {lastAssistantMsg[lastAssistantMsg.length - 1]?.id === msg.id && (
                                    <CopyButton
                                        buttonText={null}
                                        text={
                                            lastAssistantMsg.length
                                                ? getTextContent(
                                                      lastAssistantMsg[lastAssistantMsg.length - 1]
                                                          .content,
                                                  )
                                                : ""
                                        }
                                        disabled={
                                            isLoading ||
                                            !getTextContent(
                                                lastAssistantMsg[lastAssistantMsg.length - 1]
                                                    .content,
                                            )
                                        }
                                        icon={true}
                                        className={classes.copyButton}
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
                            {!readonly && msg.role === ChatRole.User && (
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
                        {msg.role === ChatRole.User &&
                            imageParts.map((img, imgIdx) => (
                                <PromptImageUpload
                                    key={imgIdx}
                                    handleUploadFileChange={(file) =>
                                        updateImagePart(
                                            ix,
                                            imgIdx,
                                            (file as any)?.base64 ||
                                                file?.url ||
                                                file?.thumbUrl ||
                                                "",
                                        )
                                    }
                                    handleRemoveUploadFile={() => handleRemoveImage(ix, imgIdx)}
                                    imageFile={{
                                        status: "done",
                                        thumbUrl: img.image_url.url,
                                        uid: `image-${ix}-${imgIdx}`,
                                        name: `image-${ix}-${imgIdx}`,
                                    }}
                                />
                            ))}
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
