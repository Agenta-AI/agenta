import {ChatMessage, ChatRole} from "@/lib/Types"
import {MinusOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Input, Select, Space, Tooltip} from "antd"
import {cloneDeep} from "lodash"
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
    readonly?: boolean
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
}) => {
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

    const handleRoleChange = (index: number, role: ChatRole) => {
        const newMessages = [...messages]
        newMessages[index].role = role
        setMessages(newMessages)
        if (onChangeRef.current) {
            onChangeRef.current(cloneDeep(newMessages))
        }
    }

    const handleInputChange = (index: number, event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const {value} = event.target
        const newMessages = [...messages]
        newMessages[index].content = value
        setMessages(newMessages)
        if (onChangeRef.current) {
            onChangeRef.current(cloneDeep(newMessages))
        }
    }

    const handleDelete = (index: number) => {
        const newMessages = messages.filter((_, i) => i !== index)
        setMessages(newMessages)
        if (onChangeRef.current) {
            onChangeRef.current(cloneDeep(newMessages))
        }
    }

    const handleAdd = () => {
        const newMessages = messages.concat([getDefaultNewMessage()])
        setMessages(newMessages)
        if (onChangeRef.current) {
            onChangeRef.current(cloneDeep(newMessages))
        }
    }

    useEffect(() => {
        onChangeRef.current = onChange
    }, [onChange])

    // disabled for now (to be reverted if there are issues after this change)
    // useUpdateEffect(() => {
    //     if (onChangeRef.current) {
    //         onChangeRef.current(cloneDeep(messages))
    //     }
    // }, [messages])

    useUpdateEffect(() => {
        if (Array.isArray(value)) setMessages(cloneDeep(value))
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
                        readOnly={readonly}
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
