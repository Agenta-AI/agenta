import {useState} from "react"

import {Button, Collapse, Form, Input, Select} from "antd"

const {Option} = Select

export const AdvanceConfigWidget = ({isEditMode}: {isEditMode: boolean}) => {
    const form = Form.useFormInstance()
    const authMode = Form.useWatch("auth_mode", form) || "signature"
    const [isChangingAuthValue, setIsChangingAuthValue] = useState(false)

    return (
        <Collapse className="[&_.ant-collapse-content]:bg-transparent" size="small">
            <Collapse.Panel header="Advance config" key="1" forceRender>
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
                                    This token will be sent in the Authorization header as 'Bearer
                                    &lt;token&gt;'
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
    )
}
