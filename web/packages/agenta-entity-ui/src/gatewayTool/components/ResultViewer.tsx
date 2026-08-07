import {useMemo} from "react"

import type {ToolResult} from "@agenta/entities/gatewayTool"
import {
    buildFormFieldsFromData,
    buildFormFieldsFromSchema,
    type FormFieldDescriptor,
} from "@agenta/shared/utils"
import {message} from "@agenta/ui"
import {Editor} from "@agenta/ui/editor"
import {Alert, Button, Field, Input, InputNumber, Textarea} from "@agenta/ui/ui"
import {CopySimple} from "@phosphor-icons/react"

interface Props {
    result: ToolResult | null
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
            <div className="flex flex-col gap-2">
                {fields.map((field) => (
                    <OutputField key={field.name} field={field} data={data} />
                ))}
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// OutputField (read-only)
// ---------------------------------------------------------------------------

function OutputField({field, data}: {field: FormFieldDescriptor; data: Record<string, unknown>}) {
    const value = getNestedValue(data, field.name)

    return (
        <Field label={field.label} description={field.description || undefined}>
            {field.type === "object" || field.type === "array" || typeof value === "object" ? (
                <Textarea
                    rows={3}
                    value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                    readOnly
                    className="font-mono !text-xs"
                />
            ) : field.type === "number" ? (
                <InputNumber className="w-full" value={value as number} readOnly />
            ) : (
                <Input value={String(value ?? "")} readOnly />
            )}
        </Field>
    )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function CopyButton({onClick, className}: {onClick: () => void; className?: string}) {
    return (
        <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Copy result"
            onClick={onClick}
            className={className ?? "absolute top-1 right-1 z-10 opacity-70 hover:opacity-100"}
        >
            <CopySimple size={14} />
        </Button>
    )
}

function getNestedValue(data: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((acc, key) => {
        if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key]
        return undefined
    }, data)
}
