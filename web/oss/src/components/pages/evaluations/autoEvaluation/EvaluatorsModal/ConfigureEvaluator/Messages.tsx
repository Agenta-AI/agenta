import {useEffect, useMemo} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {MinusCircle} from "@phosphor-icons/react"
import {Button, Form, Input} from "antd"
import isEqual from "lodash/isEqual"

import EnhancedButton from "@/oss/components/EnhancedUIs/Button"
import MessageEditor from "@/oss/components/Playground/Components/ChatCommon/MessageEditor"

interface Message {
    role: string
    content: string
}

interface MessagesProps {
    value?: Message[]
    onChange?: (messages: Message[]) => void
}

const roleOptions = [
    {label: "system", value: "system"},
    {label: "user", value: "user"},
    {label: "assistant", value: "assistant"},
]

const normalizeMessages = (messages?: Message[] | string): Message[] => {
    if (typeof messages === "string") {
        return [{role: "system", content: messages}]
    }
    if (Array.isArray(messages)) {
        return messages.filter(Boolean).map((message) => ({
            role: message.role || "user",
            content: message.content || "",
        }))
    }
    return []
}

export const Messages: React.FC<MessagesProps> = ({value = [], onChange}) => {
    const form = Form.useFormInstance()
    const normalizedValue = useMemo(() => normalizeMessages(value), [value])
    const watchedMessages = Form.useWatch<Message[] | undefined>("messages", form)
    const currentMessages = watchedMessages ?? normalizedValue

    useEffect(() => {
        const currentMessages = form.getFieldValue("messages")
        if (!isEqual(currentMessages, normalizedValue)) {
            form.setFieldsValue({messages: normalizedValue})
        }
    }, [normalizedValue, form])

    const updateMessages = (updater: (messages: Message[]) => Message[]) => {
        const existing = normalizeMessages(form.getFieldValue("messages"))
        const updated = updater(existing)
        form.setFieldsValue({messages: updated})
        onChange?.(updated)
    }

    return (
        <Form.List name="messages" initialValue={normalizedValue}>
            {(fields, {add, remove}) => (
                <>
                    {fields.map(({key, name, ...restField}, index) => {
                        const message = currentMessages?.[index] ?? {
                            role: "user",
                            content: "",
                        }

                        return (
                            <div key={key} className="flex items-start gap-2 mb-4 w-full">
                                <div className="flex-1 min-w-0 pr-px">
                                    <Form.Item
                                        {...restField}
                                        name={[name, "role"]}
                                        rules={[{required: true, message: "Role is required"}]}
                                        style={{display: "none"}}
                                    >
                                        <Input />
                                    </Form.Item>
                                    <Form.Item
                                        {...restField}
                                        name={[name, "content"]}
                                        rules={[{required: true, message: "Content is required"}]}
                                        style={{display: "none"}}
                                    >
                                        <Input.TextArea autoSize />
                                    </Form.Item>
                                    <MessageEditor
                                        id={`evaluator-message-${key}`}
                                        role={message.role}
                                        text={message.content}
                                        className="group/evaluator-message w-full max-w-full box-border"
                                        enableTokens
                                        onChangeRole={(role) =>
                                            updateMessages((prev) => {
                                                const next = [...prev]
                                                next[index] = {
                                                    ...next[index],
                                                    role,
                                                }
                                                return next
                                            })
                                        }
                                        onChangeText={(content) =>
                                            updateMessages((prev) => {
                                                const next = [...prev]
                                                next[index] = {
                                                    ...next[index],
                                                    content: content || "",
                                                }
                                                return next
                                            })
                                        }
                                        roleOptions={roleOptions}
                                        editorType="border"
                                        headerRight={
                                            fields.length > 1 ? (
                                                <div className="invisible group-hover/evaluator-message:visible">
                                                    <EnhancedButton
                                                        icon={<MinusCircle size={14} />}
                                                        type="text"
                                                        onClick={() => {
                                                            remove(name)
                                                            const updated = normalizeMessages(
                                                                form.getFieldValue("messages"),
                                                            )
                                                            onChange?.(updated)
                                                        }}
                                                        tooltipProps={{title: "Remove"}}
                                                    />
                                                </div>
                                            ) : undefined
                                        }
                                    />
                                </div>
                            </div>
                        )
                    })}
                    <Form.Item>
                        <Button
                            type="dashed"
                            onClick={() => {
                                add({role: "user", content: ""})
                                const updated = normalizeMessages(form.getFieldValue("messages"))
                                onChange?.(updated)
                            }}
                            block
                            icon={<PlusOutlined />}
                        >
                            Add Message
                        </Button>
                    </Form.Item>
                </>
            )}
        </Form.List>
    )
}
