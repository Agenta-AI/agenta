import {ChatMessage, ChatRole} from "@/lib/Types"
import {MinusOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Input, Select, Tooltip} from "antd"
import React, {useEffect, useRef, useState} from "react"
import {createUseStyles} from "react-jss"
import {v4 as uuidv4} from "uuid"

const useStyles = createUseStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
    },
    row: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",

        "& .ant-select": {
            width: 110,
        },

        "& textarea": {
            marginTop: "0 !important",
            flex: 1,
            minWidth: 240,
        },
    },
})

const getDefaultNewMessage = () => ({
    role: ChatRole.User,
    content: "",
    id: uuidv4(),
})

interface Props {
    defaultValue?: ChatMessage[]
    value?: ChatMessage[]
    onChange?: (value: ChatMessage[]) => void
}

const ChatInputs: React.FC<Props> = ({defaultValue, value, onChange}) => {
    const classes = useStyles()
    const [messages, setMessages] = useState<ChatMessage[]>(
        defaultValue || [getDefaultNewMessage()],
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

    useEffect(() => {
        if (onChangeRef.current) {
            onChangeRef.current(messages)
        }
    }, [messages])

    const list = value || messages

    return (
        <div className={classes.root}>
            {list.map((msg, ix) => (
                <div className={classes.row} key={msg.id || msg.role + msg.content + ix}>
                    <Select
                        options={Object.keys(ChatRole).map((role) => ({
                            label: role,
                            value: ChatRole[role as keyof typeof ChatRole],
                        }))}
                        value={msg.role}
                        onChange={(newRole) => handleRoleChange(ix, newRole)}
                    />
                    <Input.TextArea
                        autoSize={{maxRows: 5}}
                        value={msg.content}
                        onChange={(e) => handleInputChange(ix, e)}
                    />
                    <Tooltip title="Remove">
                        <Button
                            shape="circle"
                            size="small"
                            icon={<MinusOutlined />}
                            onClick={() => handleDelete(ix)}
                        />
                    </Tooltip>
                </div>
            ))}
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
        </div>
    )
}

export default ChatInputs
