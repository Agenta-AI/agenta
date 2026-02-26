import {useMemo} from "react"

import {Editor} from "@agenta/ui/editor"
import {CopySimple} from "@phosphor-icons/react"
import {Alert, Button, Form, Input, InputNumber, message, Typography} from "antd"

import type {ToolCallResult} from "@/oss/services/tools/api/types"

import {
    buildFormFieldsFromData,
    buildFormFieldsFromSchema,
    type FormFieldDescriptor,
} from "../utils/schema"

interface Props {
    result: ToolCallResult | null
    error?: string | null
    outputSchema?: Record<string, unknown> | null
    jsonMode?: boolean
}

export default function ResultViewer({result, error, outputSchema, jsonMode}: Props) {
    if (error) {
        return <Alert type="error" message="Execution Failed" description={error} showIcon />
    }

    if (!result) return null

    const statusCode = result.status?.code
    const statusMessage = result.status?.message
    const hasStatusError =
        (typeof statusCode === "string" && statusCode !== "STATUS_CODE_OK") ||
        (typeof statusMessage === "string" && statusMessage.trim().length > 0)

    if (hasStatusError) {
        return (
            <Alert
                type="error"
                message="Tool returned an error"
                description={
                    statusCode && statusMessage
                        ? `${statusCode}: ${statusMessage}`
                        : (statusMessage ?? statusCode ?? "Unknown tool execution error")
                }
                showIcon
            />
        )
    }

    let data: Record<string, unknown> = {}
    const rawContent = result.data?.content
    if (typeof rawContent === "string" && rawContent.trim().length > 0) {
        try {
            const parsed = JSON.parse(rawContent)
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                data = parsed as Record<string, unknown>
            } else {
                data = {value: parsed}
            }
        } catch {
            data = {raw: rawContent}
        }
    }

    return <ResultDisplay data={data} outputSchema={outputSchema} jsonMode={jsonMode} />
}

// ---------------------------------------------------------------------------
// ResultDisplay
// ---------------------------------------------------------------------------

function ResultDisplay({
    data,
    outputSchema,
    jsonMode,
}: {
    data: Record<string, unknown>
    outputSchema?: Record<string, unknown> | null
    jsonMode?: boolean
}) {
    const jsonString = useMemo(() => JSON.stringify(data, null, 2), [data])
    const dataKeys = useMemo(() => new Set(Object.keys(data)), [data])

    const fields = useMemo(() => {
        // Try schema-based fields first
        const schemaFields = buildFormFieldsFromSchema(outputSchema)

        if (schemaFields.length > 0) {
            // Check if any schema field actually exists in the data.
            // The backend unwraps the Composio execution envelope, so
            // schemas.outputs (which describes data/error/successful) may
            // not match the actual result keys.
            const hasOverlap = schemaFields.some((f) => dataKeys.has(f.name))
            if (hasOverlap) return schemaFields
        }

        // Fall back to auto-generating fields from actual data keys
        if (dataKeys.size > 0) return buildFormFieldsFromData(data)
        return schemaFields
    }, [outputSchema, data, dataKeys])

    const handleCopy = () => {
        navigator.clipboard.writeText(jsonString)
        message.success("Copied to clipboard")
    }

    if (jsonMode || fields.length === 0) {
        return (
            <div className="flex flex-col gap-1">
                <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden relative">
                    <Editor
                        initialValue={jsonString}
                        codeOnly
                        showToolbar={false}
                        language="json"
                        disabled
                        dimensions={{width: "100%", height: 280}}
                    />
                    <CopyButton onClick={handleCopy} />
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-1 relative">
            <CopyButton onClick={handleCopy} className="static self-end" />
            <Form
                layout="vertical"
                disabled
                className="[&_.ant-form-item]:!mb-2 [&_.ant-input-disabled]:!text-[var(--ant-color-text)] [&_.ant-input-number-disabled_.ant-input-number-input]:!text-[var(--ant-color-text)]"
            >
                {fields.map((field) => (
                    <OutputField key={field.name} field={field} data={data} />
                ))}
            </Form>
        </div>
    )
}

// ---------------------------------------------------------------------------
// OutputField (read-only)
// ---------------------------------------------------------------------------

function OutputField({field, data}: {field: FormFieldDescriptor; data: Record<string, unknown>}) {
    const value = getNestedValue(data, field.name)

    const label = (
        <div className="flex flex-col leading-tight">
            <span>{field.label}</span>
            {field.description && (
                <Typography.Text type="secondary" className="!text-[11px] font-normal leading-snug">
                    {field.description}
                </Typography.Text>
            )}
        </div>
    )

    if (field.type === "object" || field.type === "array" || typeof value === "object") {
        return (
            <Form.Item label={label}>
                <Input.TextArea
                    rows={3}
                    value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                    readOnly
                    className="font-mono !text-xs"
                />
            </Form.Item>
        )
    }

    if (field.type === "number") {
        return (
            <Form.Item label={label}>
                <InputNumber className="w-full" value={value as number} readOnly />
            </Form.Item>
        )
    }

    return (
        <Form.Item label={label}>
            <Input value={String(value ?? "")} readOnly />
        </Form.Item>
    )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CopyButton({onClick, className}: {onClick: () => void; className?: string}) {
    return (
        <Button
            type="text"
            aria-label="Copy result"
            icon={<CopySimple size={14} />}
            size="small"
            onClick={onClick}
            className={className ?? "absolute top-1 right-1 z-10 opacity-70 hover:opacity-100"}
        />
    )
}

function getNestedValue(data: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => {
        if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key]
        return undefined
    }, data)
}
