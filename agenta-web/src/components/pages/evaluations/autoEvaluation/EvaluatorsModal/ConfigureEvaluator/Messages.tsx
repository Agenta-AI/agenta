import React, {useState, useEffect} from "react"
import {Button, Input, Select, Space, Row, Col} from "antd"
import {MinusCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Form} from "antd"
import Editor from "@monaco-editor/react"
import {createUseStyles} from "react-jss"
import isEqual from "lodash/isEqual"

const {TextArea} = Input

const useStyles = createUseStyles((theme: any) => ({
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
        width: "98% !important",
    },
    messageContainer: {
        overflowX: "hidden",
    },
}))

interface Message {
    role: string
    content: string
}

interface MessagesProps {
    value?: Message[]
    onChange?: (messages: Message[]) => void
}

const roleOptions = [
    {label: "System", value: "system"},
    {label: "User", value: "user"},
    {label: "Assistant", value: "assistant"},
]

export const Messages: React.FC<MessagesProps> = ({value = [], onChange}) => {
    const classes = useStyles()
    const form = Form.useFormInstance()
    const messages = Form.useWatch("messages", form)
    const initialValue = typeof value === "string" ? [{role: "system", content: value}] : value
    useEffect(() => {
        const currentMessages = form.getFieldValue("messages")
        if (!isEqual(currentMessages, value)) {
            if (typeof value === "string") {
                form.setFieldsValue({messages: [{role: "system", content: value}]})
            } else {
                form.setFieldsValue({messages: value})
            }
        }
    }, [value])

    return (
        <Form.List name="messages" initialValue={value}>
            {(fields, {add, remove}) => (
                <>
                    {fields.map(({key, name, ...restField}, index) => (
                        <Row
                            key={key}
                            gutter={8}
                            style={{marginBottom: 16, width: "100%", flexWrap: "nowrap"}}
                            className={classes.messageContainer}
                        >
                            <Col style={{width: 110}}>
                                <Form.Item
                                    {...restField}
                                    name={[name, "role"]}
                                    rules={[{required: true, message: "Role is required"}]}
                                    style={{marginBottom: 0}}
                                >
                                    <Select
                                        options={roleOptions}
                                        style={{width: 100}}
                                        onChange={(role) => {
                                            const currentMessages =
                                                form.getFieldValue("messages") || []
                                            currentMessages[index] = {
                                                ...currentMessages[index],
                                                role,
                                            }
                                            form.setFieldsValue({messages: currentMessages})
                                            onChange && onChange(currentMessages)
                                        }}
                                    />
                                </Form.Item>
                            </Col>
                            <Col style={{flex: 1}}>
                                <Form.Item
                                    {...restField}
                                    name={[name, "content"]}
                                    rules={[{required: true, message: "Content is required"}]}
                                    style={{marginBottom: 0}}
                                >
                                    <Editor
                                        height="120px"
                                        language="markdown"
                                        value={value[index]?.content || ""}
                                        options={{
                                            minimap: {enabled: false},
                                            lineNumbers: "off",
                                            scrollBeyondLastLine: false,
                                            wordWrap: "on",
                                            wrappingStrategy: "advanced",
                                            // Customize the editor's appearance
                                            scrollbar: {
                                                vertical: "visible",
                                                horizontal: "visible",
                                            },
                                            glyphMargin: false,
                                            lineNumbersMinChars: 0, // Reduces the space for line numbers
                                            folding: false,
                                            quickSuggestions: false,
                                        }}
                                        onChange={(newValue) => {
                                            const currentMessages =
                                                form.getFieldValue("messages") || []
                                            currentMessages[index] = {
                                                ...currentMessages[index],
                                                content: newValue || "",
                                            }
                                            form.setFieldsValue({messages: currentMessages})
                                            onChange && onChange(currentMessages)
                                        }}
                                        beforeMount={(monaco) => {
                                            // Add custom token provider for highlighting text between curly braces
                                            monaco.languages.setMonarchTokensProvider("markdown", {
                                                tokenizer: {
                                                    root: [[/{[^}]*}/, "variable"]],
                                                },
                                            })
                                            // Add custom theme rules
                                            monaco.editor.defineTheme("customTheme", {
                                                base: "vs",
                                                inherit: true,
                                                rules: [
                                                    {token: "variable", foreground: "#FF0000"}, // Red color for variables
                                                ],
                                                colors: {},
                                            })
                                        }}
                                        className={classes.editor}
                                    />
                                </Form.Item>
                            </Col>
                            {fields.length > 1 && (
                                <Col style={{width: 16}}>
                                    <MinusCircleOutlined
                                        style={{fontSize: 12, lineHeight: "32px"}}
                                        onClick={() => {
                                            remove(name)
                                            const currentMessages =
                                                form.getFieldValue("messages") || []
                                            onChange && onChange(currentMessages)
                                        }}
                                    />
                                </Col>
                            )}
                        </Row>
                    ))}
                    <Form.Item>
                        <Button
                            type="dashed"
                            onClick={() => {
                                add({role: "user", content: ""})
                                const currentMessages = form.getFieldValue("messages") || []
                                onChange && onChange(currentMessages)
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
