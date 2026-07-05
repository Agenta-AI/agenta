import {Fragment, useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    Select as ShadcnSelect,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {Divider, Form, Input} from "antd"

import {FieldDescriptor} from "./assets/types"
import {AdvanceConfigWidget} from "./widgets/AdvanceConfigWidget"
import {DispatchAlertWidget} from "./widgets/DispatchAlertWidget"
import {HeaderListWidget} from "./widgets/HeaderListWidget"

interface Props {
    fields: FieldDescriptor[]
    isEditMode: boolean
}

function AntdFormSelect({
    value,
    onChange,
    options,
    placeholder,
    disabled,
}: {
    value?: string
    onChange?: (v: string) => void
    options?: {label: string; value: string}[]
    placeholder?: string
    disabled?: boolean
}) {
    return (
        <ShadcnSelect
            value={value ?? ""}
            onValueChange={(v) => onChange?.(v || "")}
            disabled={disabled}
        >
            <SelectTrigger>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {options?.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </ShadcnSelect>
    )
}

function FormMultiSelect({
    value,
    onChange,
    options,
    placeholder,
    disabled,
}: {
    value?: string[]
    onChange?: (v: string[]) => void
    options?: {value: string; label: string}[]
    placeholder?: string
    disabled?: boolean
}) {
    return (
        <ShadcnSelect
            multiple
            value={value || []}
            onValueChange={(vals) => onChange?.(vals)}
            disabled={disabled}
        >
            <SelectTrigger>
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {options?.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </ShadcnSelect>
    )
}

const FieldRendererItem = ({field, isEditMode}: {field: FieldDescriptor; isEditMode: boolean}) => {
    const form = Form.useFormInstance()
    const [isChangingSecret, setIsChangingSecret] = useState(false)

    // Determine visibility using useWatch safely inside this separate component
    // Always call the hook to satisfy React rules
    const watchField = field.visibleWhen?.field || ""
    const dependsOnValue = Form.useWatch(watchField, form)
    const currentValue = Form.useWatch(field.key, form)

    const dynamicExtra =
        currentValue !== undefined && field.extraByValue
            ? field.extraByValue[String(currentValue)]
            : undefined

    const fieldExtra = dynamicExtra ?? field.extra

    if (field.visibleWhen && dependsOnValue !== field.visibleWhen.value) {
        return null
    }

    const isDisabled = field.disabled === true || (field.disabled === "editMode" && isEditMode)

    // Render specific widget types
    if (field.component === "headers") {
        return (
            <Fragment key={field.key}>
                <HeaderListWidget />
                <Divider className="!my-0" />
            </Fragment>
        )
    }

    if (field.component === "auth") {
        return <AdvanceConfigWidget key={field.key} isEditMode={isEditMode} />
    }

    if (field.component === "alert") {
        return <DispatchAlertWidget key={field.key} />
    }

    // Render standard components (Input, Select, Password)
    let InputComponent = null

    if (field.component === "input") {
        InputComponent = <Input placeholder={field.placeholder} disabled={isDisabled} />
    } else if (field.component === "input.password") {
        // Specific complex logic for password/secret fields
        InputComponent = (
            <Form.Item
                name={field.key}
                className="!mb-0"
                rules={
                    field.required
                        ? [
                              {
                                  required: !isEditMode || isChangingSecret,
                                  message: "Required",
                              },
                          ]
                        : field.rules
                }
            >
                <Input.Password
                    placeholder={
                        isEditMode && !isChangingSecret ? "•••••••••••••••••" : field.placeholder
                    }
                    disabled={isEditMode && !isChangingSecret}
                />
            </Form.Item>
        )

        // Special wrapping for secret fields to show the "Change" button
        return (
            <Form.Item
                key={field.key}
                label={field.label}
                className="!mb-0"
                extra={
                    field.secret ? (
                        <div className="flex items-start justify-between">
                            {fieldExtra && <span>{fieldExtra}</span>}
                            {isEditMode && !isChangingSecret && (
                                <Button
                                    className="!p-0"
                                    onClick={() => {
                                        setIsChangingSecret(true)
                                        form.setFieldValue(field.key, undefined)
                                    }}
                                    variant="link"
                                    size="sm"
                                >
                                    Change token
                                </Button>
                            )}
                        </div>
                    ) : (
                        fieldExtra
                    )
                }
            >
                {InputComponent}
            </Form.Item>
        )
    } else if (field.component === "select") {
        InputComponent = (
            <AntdFormSelect
                placeholder={field.placeholder}
                disabled={isDisabled}
                options={field.options}
            />
        )
    } else if (field.component === "multi-select") {
        InputComponent = (
            <FormMultiSelect
                placeholder={field.placeholder}
                disabled={isDisabled}
                options={field.options}
            />
        )
    }

    // Generic wrapper for regular inputs
    return (
        <Form.Item
            key={field.key}
            name={field.key}
            label={field.label}
            initialValue={field.initialValue}
            rules={field.rules || (field.required ? [{required: true, message: "Required"}] : [])}
            className="!mb-0"
            extra={fieldExtra}
        >
            {InputComponent}
        </Form.Item>
    )
}

export const WebhookFieldRenderer = ({fields, isEditMode}: Props) => {
    return (
        <>
            {fields.map((field) => (
                <FieldRendererItem key={field.key} field={field} isEditMode={isEditMode} />
            ))}
        </>
    )
}
