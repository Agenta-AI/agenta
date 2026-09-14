import {useEffect} from "react"

import type {AgentaApi} from "@agentaai/api-client"
import {Alert, Button, Form, Input} from "antd"

export interface SetupFormFieldSpec {
    name: string
    label: string
    isPassword: boolean
    required: boolean
    help?: string
}

// The one place `setup.fields` becomes form items -- no field name is ever hardcoded here.
export function describeSetupFormFields(
    fields: AgentaApi.ChannelSetupField[] | undefined,
): SetupFormFieldSpec[] {
    return (fields ?? []).map((field) => ({
        name: field.name,
        label: field.label,
        isPassword: !!field.secret,
        required: field.required ?? true,
        help: field.help ?? undefined,
    }))
}

// Routes each value by what the declaration says it IS (`secret`), not by name: a misrouted field (e.g. api_app_id in credentials) vanishes silently rather than erroring.
export function splitSetupFieldValues(
    fields: AgentaApi.ChannelSetupField[] | undefined,
    values: Record<string, string | undefined>,
): {data: Record<string, unknown>; credentials: Record<string, unknown>} {
    const data: Record<string, unknown> = {}
    const credentials: Record<string, unknown> = {}

    for (const field of fields ?? []) {
        const value = values[field.name]
        if (value === undefined || value === "") continue
        if (field.secret) {
            credentials[field.name] = value
        } else {
            data[field.name] = value
        }
    }

    return {data, credentials}
}

export interface ChannelSetupCredentialsFormProps {
    fields: AgentaApi.ChannelSetupField[] | undefined
    onSubmit: (payload: {
        data: Record<string, unknown>
        credentials: Record<string, unknown>
    }) => Promise<void>
    submitting?: boolean
    submitLabel?: string
    /** Shown verbatim — the platform's own verification error, not ours. */
    errorMessage?: string | null
}

// Renders from `setup.fields` alone; on a rejected verification the form is NOT reset, so nothing gets retyped.
export default function ChannelSetupCredentialsForm({
    fields,
    onSubmit,
    submitting = false,
    submitLabel = "Save",
    errorMessage,
}: ChannelSetupCredentialsFormProps) {
    const [form] = Form.useForm<Record<string, string>>()
    const specs = describeSetupFormFields(fields)

    // Resets only when the field set itself changes, not on every render/retry.
    useEffect(() => {
        form.resetFields()
    }, [specs.map((spec) => spec.name).join(",")])

    const handleSubmit = async () => {
        const values = await form.validateFields()
        await onSubmit(splitSetupFieldValues(fields, values))
    }

    if (specs.length === 0) return null

    return (
        <Form form={form} layout="vertical" className="max-w-[420px]">
            {errorMessage ? (
                <Alert type="error" showIcon message={errorMessage} className="mb-3" />
            ) : null}
            {specs.map((spec) => (
                <Form.Item
                    key={spec.name}
                    name={spec.name}
                    label={spec.label}
                    extra={spec.help}
                    rules={
                        spec.required
                            ? [{required: true, message: `${spec.label} is required`}]
                            : []
                    }
                >
                    {spec.isPassword ? (
                        <Input.Password placeholder={spec.label} autoComplete="off" />
                    ) : (
                        <Input placeholder={spec.label} autoComplete="off" />
                    )}
                </Form.Item>
            ))}
            <Button type="primary" onClick={handleSubmit} loading={submitting}>
                {submitLabel}
            </Button>
        </Form>
    )
}
