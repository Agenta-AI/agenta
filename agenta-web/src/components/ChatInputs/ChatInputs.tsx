import {ChatMessage, ChatRole} from "@/lib/Types"
import {MinusOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Input, Select, Tooltip} from "antd"
import React, {useEffect, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {useUpdateEffect} from "usehooks-ts"
import {v4 as uuidv4} from "uuid"

const useStyles = createUseStyles({
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
})

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
}) => {
    const classes = useStyles()
    const [messages, setMessages] = useState<ChatMessage[]>(
        value || defaultValue || [getDefaultNewMessage()],
    )
    const onChangeRef = useRef(onChange)

    const handleRoleChange = (index: number, role: ChatRole) => {
        const newMessages = [...messages]
        newMessages[index].role = role
        setMessages(newMessages)
    }

    const handleInputChange = (index: number, event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const {value} = event.target
        const newMessages = [...messages]
        newMessages[index].content = value
        setMessages(newMessages)
    }

    const handleDelete = (index: number) => {
        setMessages((prev) => prev.filter((_, i) => i !== index))
    }

    const handleAdd = () => {
        setMessages((prev) => prev.concat([getDefaultNewMessage()]))
    }

    useEffect(() => {
        onChangeRef.current = onChange
    }, [onChange])

    useUpdateEffect(() => {
        if (onChangeRef.current) {
            onChangeRef.current(messages)
        }
    }, [messages])

    useUpdateEffect(() => {
        if (Array.isArray(value)) setMessages(value)
    }, [JSON.stringify(value)])

    return (
        <div className={classes.root}>
            {messages.map((msg, ix) => (
                <div className={classes.row} key={msg.id || msg.role + msg.content + ix}>
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
                    <Input.TextArea
                        style={{maxWidth: "none"}}
                        disabled={disableEditContent}
                        autoSize={{maxRows}}
                        value={msg.content}
                        onChange={(e) => handleInputChange(ix, e)}
                    />
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
                </div>
            ))}
            {!disableAdd && (
                <div>
                    <Tooltip title="Add input">
                        <Button
                            shape="circle"
                            icon={<PlusOutlined />}
                            onClick={handleAdd}
                            size="small"
                        />
                    </Tooltip>
                </div>
            )}
        </div>
    )
}

export default ChatInputs
