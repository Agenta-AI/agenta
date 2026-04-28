import {memo, useEffect, useState} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {HeightCollapse} from "@agenta/ui"
import {formatLabel} from "@agenta/ui/drill-in"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {Typography} from "antd"

import {validateConfigAgainstSchema} from "../../SchemaControls/schemaValidator"

export interface AdvancedConfigFieldsProps {
    entries: [string, unknown][]
    value: Record<string, unknown>
    onChange: (key: string, next: unknown) => void
    disabled?: boolean
}

export const AdvancedConfigFields = memo(function AdvancedConfigFields({
    entries,
    value,
    onChange,
    disabled,
}: AdvancedConfigFieldsProps) {
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false)

    if (entries.length === 0) return null

    return (
        <div className="flex flex-col gap-3">
            <button
                type="button"
                className="flex items-center gap-1 border-0 bg-transparent p-0 text-left text-[rgba(5,23,41,0.45)] cursor-pointer"
                onClick={() => setIsAdvancedOpen((prev) => !prev)}
                disabled={disabled}
            >
                {isAdvancedOpen ? (
                    <CaretDown size={14} weight="bold" />
                ) : (
                    <CaretRight size={14} weight="bold" />
                )}
                <span className="font-medium">Advanced</span>
            </button>
            <HeightCollapse open={isAdvancedOpen}>
                <div className="flex flex-col gap-4 pl-5">
                    {entries.map(([key, propSchema]) => {
                        const schema = propSchema as EntitySchemaProperty
                        return (
                            <AdvancedJsonField
                                key={key}
                                fieldKey={key}
                                label={formatLabel(schema.title || key)}
                                schema={schema}
                                value={value?.[key]}
                                onChange={onChange}
                                disabled={disabled}
                            />
                        )
                    })}
                </div>
            </HeightCollapse>
        </div>
    )
})

const AdvancedJsonField = memo(function AdvancedJsonField({
    fieldKey,
    label,
    schema,
    value,
    onChange,
    disabled,
}: {
    fieldKey: string
    label: string
    schema: EntitySchemaProperty
    value: unknown
    onChange: (key: string, next: unknown) => void
    disabled?: boolean
}) {
    const externalEditorValue = value == null ? "" : JSON.stringify(value, null, 2)
    const [editorValue, setEditorValue] = useState(externalEditorValue)
    const [parseError, setParseError] = useState<string | null>(null)
    const [isFocused, setIsFocused] = useState(false)

    useEffect(() => {
        if (!isFocused || externalEditorValue === "") {
            setEditorValue(externalEditorValue)
            setParseError(null)
        }
    }, [externalEditorValue, isFocused])

    const validateAndEmit = (nextEditorValue: string) => {
        setEditorValue(nextEditorValue)

        const raw = nextEditorValue.trim()
        if (!raw) {
            setParseError(null)
            onChange(fieldKey, null)
            return
        }

        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch (error: unknown) {
            setParseError(error instanceof Error ? error.message : "Invalid JSON format")
            return
        }

        if (parsed === null) {
            setParseError(null)
            onChange(fieldKey, null)
            return
        }

        const validationResult = validateConfigAgainstSchema(
            parsed as Record<string, unknown>,
            schema as Record<string, unknown>,
        )
        if (!validationResult.valid) {
            setParseError(validationResult.errors[0]?.message || "Invalid value")
            return
        }

        setParseError(null)
        onChange(fieldKey, parsed)
    }

    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-0.5">
                <Typography.Text className="font-medium">{label}</Typography.Text>
                <Typography.Text type="secondary" className="text-xs leading-snug">
                    Provider-specific chat template options sent with the model request.
                </Typography.Text>
            </div>
            <SharedEditor
                key={`llm-config-${fieldKey}`}
                editorType="border"
                placeholder='{"thinking": true}'
                initialValue={editorValue}
                value={editorValue}
                error={!!parseError}
                handleChange={validateAndEmit}
                disabled={disabled}
                disableDebounce
                className="min-h-[96px] overflow-hidden"
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: false,
                }}
                onFocusChange={(focused) => {
                    setIsFocused(focused)
                }}
            />
            {parseError && (
                <Typography.Text type="danger" className="text-xs mt-1">
                    {parseError}
                </Typography.Text>
            )}
        </div>
    )
})
