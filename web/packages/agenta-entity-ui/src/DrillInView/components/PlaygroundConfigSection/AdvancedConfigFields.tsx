import {memo, useEffect, useRef, useState} from "react"

import type {EntitySchemaProperty} from "@agenta/entities/shared"
import {HeightCollapse} from "@agenta/ui"
import {formatLabel} from "@agenta/ui/drill-in"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {Typography} from "antd"

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
    value,
    onChange,
    disabled,
}: {
    fieldKey: string
    label: string
    value: unknown
    onChange: (key: string, next: unknown) => void
    disabled?: boolean
}) {
    const externalEditorValue = value == null ? "" : JSON.stringify(value, null, 2)
    const [editorValue, setEditorValue] = useState(externalEditorValue)
    const isFocusedRef = useRef(false)

    useEffect(() => {
        if (!isFocusedRef.current) {
            setEditorValue(externalEditorValue)
        }
    }, [externalEditorValue])

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
                handleChange={(nextEditorValue) => {
                    setEditorValue(nextEditorValue)

                    const raw = nextEditorValue.trim()
                    if (!raw) {
                        onChange(fieldKey, null)
                        return
                    }

                    try {
                        onChange(fieldKey, JSON.parse(raw))
                    } catch {
                        // Keep the last valid value.
                    }
                }}
                disabled={disabled}
                className="min-h-[96px] overflow-hidden"
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: false,
                }}
                onFocusChange={(focused) => {
                    isFocusedRef.current = focused
                }}
            />
        </div>
    )
})
