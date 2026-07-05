import React, {useState} from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@agenta/primitive-ui/components/accordion"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {Form, Input} from "antd"

/** Wraps shadcn Select to accept antd Form.Item's injected value/onChange */
function AntdFormSelect({
    value,
    onChange,
    children,
}: {
    value?: string
    onChange?: (v: string) => void
    children: React.ReactNode
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            {children}
        </Select>
    )
}

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
                        <AntdFormSelect>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="signature">Signature (HMAC)</SelectItem>
                                <SelectItem value="authorization">Authorization Header</SelectItem>
                            </SelectContent>
                        </AntdFormSelect>
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
