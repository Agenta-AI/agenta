import {Fragment} from "react"

import {Button, Divider, Form, Input, Select} from "antd"

import {FieldDescriptor} from "./assets/types"
import {AdvanceConfigWidget} from "./widgets/AdvanceConfigWidget"
import {DispatchAlertWidget} from "./widgets/DispatchAlertWidget"
import {HeaderListWidget} from "./widgets/HeaderListWidget"

interface Props {
    fields: FieldDescriptor[]
    isEditMode: boolean
}

const FieldRendererItem = ({field, isEditMode}: {field: FieldDescriptor; isEditMode: boolean}) => {
    const form = Form.useFormInstance()

    // Determine visibility using useWatch safely inside this separate component
    // Always call the hook to satisfy React rules
    const watchField = field.visibleWhen?.field || "dummy_field_not_used"
    const dependsOnValue = Form.useWatch(watchField, form)
    const isChangingSecret = Form.useWatch(`_changing_${field.key}`, form)

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
                            {field.extra && <span>{field.extra}</span>}
                            {isEditMode && !isChangingSecret && (
                                <Button
                                    type="link"
                                    size="small"
                                    className="!p-0"
                                    onClick={() => {
                                        form.setFieldValue(`_changing_${field.key}`, true)
                                        form.setFieldValue(field.key, undefined)
                                    }}
                                >
                                    Change token
                                </Button>
                            )}
                        </div>
                    ) : (
                        field.extra
                    )
                }
            >
                {InputComponent}
            </Form.Item>
        )
    } else if (field.component === "select" || field.component === "multi-select") {
        InputComponent = (
            <Select
                placeholder={field.placeholder}
                disabled={isDisabled}
                mode={field.component === "multi-select" ? "multiple" : undefined}
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
            extra={field.extra}
        >
            {InputComponent}
        </Form.Item>
    )
}

export const AutomationFieldRenderer = ({fields, isEditMode}: Props) => {
    return (
        <>
            {fields.map((field) => (
                <FieldRendererItem key={field.key} field={field} isEditMode={isEditMode} />
            ))}
        </>
    )
}
