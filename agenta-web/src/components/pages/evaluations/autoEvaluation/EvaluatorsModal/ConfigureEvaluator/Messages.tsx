import React from "react"
import {Button, Input, Select, Space, Row, Col} from "antd"
import {MinusCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Form} from "antd"
import Editor from "@monaco-editor/react"
import {createUseStyles} from "react-jss"

const {TextArea} = Input

const useStyles = createUseStyles((theme: any) => ({
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
        width: "100%",
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
    const handleChange = (messages: Message[]) => {
        onChange?.(messages)
    }

    const classes = useStyles()

    return (
        <Form.List
            name="messages"
            initialValue={value.length ? value : [{role: "system", content: ""}]}
        >
            {(fields, {add, remove}) => (
                <>
                    {fields.map(({key, name, ...restField}, index) => (
                        <Row
                            key={key}
                            gutter={8}
                            style={{marginBottom: 16, width: "100%", flexWrap: "nowrap"}}
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
                                            const newMessages = [...value]
                                            newMessages[index] = {...newMessages[index], role}
                                            handleChange(newMessages)
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
                                        defaultLanguage="plaintext"
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
                                        }}
                                        onChange={(newValue) => {
                                            const newMessages = [...value]
                                            newMessages[index] = {
                                                ...newMessages[index],
                                                content: newValue || "",
                                            }
                                            handleChange(newMessages)
                                        }}
                                        beforeMount={(monaco) => {
                                            // Add custom token provider for highlighting text between curly braces
                                            monaco.languages.setMonarchTokensProvider("plaintext", {
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
                                            const newMessages = value.filter((_, i) => i !== index)
                                            handleChange(newMessages)
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
                                handleChange([...value, {role: "user", content: ""}])
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
