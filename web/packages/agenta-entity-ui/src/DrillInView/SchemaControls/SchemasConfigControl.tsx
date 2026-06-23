/** Renders data.schemas (parameters/inputs/outputs) as collapsible JSON editors. */

import {memo, useCallback, useMemo, useState} from "react"

import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import {EditorProvider} from "@agenta/ui/editor"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {CopySimple} from "@phosphor-icons/react"
import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"

const SCHEMA_FIELDS = ["parameters", "inputs", "outputs"] as const
type SchemaField = (typeof SCHEMA_FIELDS)[number]

const FIELD_LABELS: Record<SchemaField, string> = {
    parameters: "Parameters",
    inputs: "Inputs",
    outputs: "Outputs",
}

function toJsonText(value: unknown): string {
    if (value === undefined || value === null) return "{}"
    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return "{}"
    }
}

interface SchemaEditorProps {
    field: SchemaField
    value: unknown
    onChange: (next: unknown) => void
    disabled?: boolean
}

/** One JSON-schema editor with tool-card chrome, collapsed by default. */
const SchemaEditor = memo(function SchemaEditor({
    field,
    value,
    onChange,
    disabled,
}: SchemaEditorProps) {
    const [minimized, setMinimized] = useState(true)
    const text = useMemo(() => toJsonText(value), [value])

    const handleChange = useCallback(
        (raw: string) => {
            try {
                onChange(JSON.parse(raw))
            } catch {
                // ignore invalid JSON mid-edit; keep the last valid value
            }
        },
        [onChange],
    )

    const header = (
        <div className="w-full flex items-start justify-between py-1">
            <Typography.Text strong className="text-sm pl-2">
                {FIELD_LABELS[field]}
            </Typography.Text>
            <div className="flex items-center gap-1 shrink-0">
                <Tooltip title="Copy">
                    <Button
                        icon={<CopySimple size={14} />}
                        type="text"
                        size="small"
                        className="invisible group-hover/schema:visible"
                        onClick={() => navigator.clipboard.writeText(text)}
                    />
                </Tooltip>
                <CollapseToggleButton
                    collapsed={minimized}
                    onToggle={() => setMinimized((v) => !v)}
                    className="!transition-opacity !duration-0 !delay-200 group-hover/schema:!delay-0 opacity-50 group-hover/schema:opacity-100"
                />
            </div>
        </div>
    )

// `!min-h-0` removes EditorProvider's min height so collapsed cards hug the header.
    return (
        <EditorProvider
            codeOnly
            language="json"
            showToolbar={false}
            enableTokens={false}
            id={`workflow-schema-${field}`}
            className="!min-h-0"
        >
            <div className="group/schema flex flex-col w-full max-w-full">
                <SharedEditor
                    editorType="border"
                    initialValue={text}
                    handleChange={handleChange}
                    disabled={disabled}
                    editorProps={{
                        codeOnly: true,
                        language: "json",
                        showLineNumbers: true,
                        noProvider: true,
                    }}
                    noProvider
                    syncWithInitialValueChanges
                    className={clsx(
                        "group/schema",
                        "!pt-[11px] !pb-[11px] [&_.agenta-editor-wrapper]:!mb-0 [&_.editor-code]:!pb-0",
                        "[&_.agenta-editor-wrapper]:!pl-[20px]",
                        minimized && "[&_.agenta-editor-wrapper]:!hidden",
                    )}
                    state={disabled ? "readOnly" : "filled"}
                    header={header}
                />
            </div>
        </EditorProvider>
    )
})

export interface SchemasConfigControlProps {
    /** The schemas object: {parameters, inputs, outputs} — each a JSON schema. */
    value: Record<string, unknown> | null | undefined
    /** Emits the full updated schemas object. */
    onChange: (value: Record<string, unknown>) => void
    disabled?: boolean
    className?: string
}

export const SchemasConfigControl = memo(function SchemasConfigControl({
    value,
    onChange,
    disabled = false,
    className,
}: SchemasConfigControlProps) {
    const schemas = (value ?? {}) as Record<string, unknown>

    const patch = useCallback(
        (field: SchemaField, fieldValue: unknown) => {
            onChange({...schemas, [field]: fieldValue})
        },
        [schemas, onChange],
    )

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            {SCHEMA_FIELDS.map((field) => (
                <SchemaEditor
                    key={field}
                    field={field}
                    value={schemas[field]}
                    onChange={(next) => patch(field, next)}
                    disabled={disabled}
                />
            ))}
        </div>
    )
})
