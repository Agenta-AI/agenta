import {useState} from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@agenta/primitive-ui/components/accordion"
import {Button} from "@agenta/primitive-ui/components/button"
import {Form, Input, Select} from "antd"

const {Option} = Select

export const AdvanceConfigWidget = ({isEditMode}: {isEditMode: boolean}) => {
    const form = Form.useFormInstance()
    const authMode = Form.useWatch("auth_mode", form) || "signature"
    const [isChangingAuthValue, setIsChangingAuthValue] = useState(false)

    return (
        <Accordion className="[&_[data-slot=accordion-content]]:bg-transparent">
            <AccordionItem value="1">
                <AccordionTrigger className="py-1.5 text-xs font-medium">
                    Advance config
                </AccordionTrigger>
                <AccordionContent keepMounted>
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
                                            className="!p-0"
                                            onClick={() => {
                                                setIsChangingAuthValue(true)
                                                form.setFieldValue("auth_value", undefined)
                                            }}
                                            variant="link"
                                            size="sm"
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
                                        : "your-token"
                                }
                                disabled={isEditMode && !isChangingAuthValue}
                            />
                        </Form.Item>
                    )}
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    )
}
