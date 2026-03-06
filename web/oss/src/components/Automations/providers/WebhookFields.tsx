import React from "react"

import {MinusCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, Collapse, Divider, Form, Input, Select, Typography} from "antd"

const {Text} = Typography
const {Option} = Select

interface Props {
    isEditMode: boolean
}

export const WebhookFields: React.FC<Props> = ({isEditMode}) => {
    const form = Form.useFormInstance()
    const authMode = Form.useWatch("auth_mode", form) || "signature"
    const [isChangingAuthValue, setIsChangingAuthValue] = React.useState(false)

    return (
        <div className="flex w-full flex-col gap-3">
            {/* Payload URL */}
            <Form.Item
                name="url"
                label="Webhook URL"
                className="!mb-0"
                rules={[
                    {required: true, message: "Payload URL is required"},
                    {type: "url", message: "Please enter a valid URL (e.g. https://...)"},
                    {
                        pattern: /^https:\/\//,
                        message: "URL must use HTTPS",
                    },
                ]}
            >
                <Input placeholder="URL" />
            </Form.Item>

            {/* Headers Configuration */}
            <div>
                <Text strong className="mb-2 block">
                    Headers
                </Text>
                <Form.List name="header_list">
                    {(fields, {add, remove}) => (
                        <div className="w-full">
                            {fields.map((field) => (
                                <div key={field.key} className="mb-2 flex items-start">
                                    <div className="mr-2 flex-1">
                                        <Form.Item
                                            {...field}
                                            name={[field.name, "key"]}
                                            className="!mb-0"
                                            rules={[{required: true, message: "Required"}]}
                                        >
                                            <Input placeholder="Key (e.g. X-Custom)" />
                                        </Form.Item>
                                    </div>
                                    <div className="mr-2 flex-[2]">
                                        <Form.Item
                                            {...field}
                                            name={[field.name, "value"]}
                                            className="!mb-0"
                                            rules={[{required: true, message: "Required"}]}
                                        >
                                            <Input placeholder="Value" />
                                        </Form.Item>
                                    </div>
                                    <Button
                                        type="text"
                                        danger
                                        icon={<MinusCircleOutlined />}
                                        onClick={() => remove(field.name)}
                                    />
                                </div>
                            ))}
                            <Button
                                type="dashed"
                                onClick={() => add()}
                                block
                                icon={<PlusOutlined />}
                            >
                                Add header
                            </Button>
                        </div>
                    )}
                </Form.List>
            </div>
            <Divider className="!my-0" />

            {/* Advanced Settings */}
            <Collapse className="border-none bg-transparent [&_.ant-collapse-content]:border-none [&_.ant-collapse-content]:bg-transparent [&_.ant-collapse-content]:!p-0 [&_.ant-collapse-header]:!px-0 [&_.ant-collapse-header]:!py-2 [&_.ant-collapse-header]:!text-[var(--color-text-secondary)] [&_.ant-collapse-item]:border-none">
                <Collapse.Panel header="Advance config" key="1">
                    <Form.Item
                        name="auth_mode"
                        label="Authentication Mode"
                        className="!mb-4"
                        initialValue="signature"
                    >
                        <Select>
                            <Option value="signature">Signature (HMAC)</Option>
                            <Option value="authorization">Authorization Header</Option>
                        </Select>
                    </Form.Item>

                    {authMode === "authorization" && (
                        <Form.Item
                            name="auth_value"
                            label="Authorization Token"
                            rules={[
                                {
                                    required: !isEditMode || isChangingAuthValue,
                                    message: "Token is required when using Authorization Mode",
                                },
                            ]}
                            extra={
                                <div className="flex items-start justify-between">
                                    <span>
                                        This token will be sent in the Authorization header as
                                        'Bearer &lt;token&gt;'
                                    </span>
                                    {isEditMode && !isChangingAuthValue && (
                                        <Button
                                            type="link"
                                            size="small"
                                            className="!p-0"
                                            onClick={() => {
                                                setIsChangingAuthValue(true)
                                                form.setFieldValue("auth_value", undefined)
                                            }}
                                        >
                                            Change token
                                        </Button>
                                    )}
                                </div>
                            }
                        >
                            <Input.Password
                                placeholder={
                                    isEditMode && !isChangingAuthValue
                                        ? "•••••••••••••••••"
                                        : "Enter Bearer token"
                                }
                                disabled={isEditMode && !isChangingAuthValue}
                            />
                        </Form.Item>
                    )}
                </Collapse.Panel>
            </Collapse>
        </div>
    )
}
