import {memo, useCallback, useEffect, useRef, useState} from "react"

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
    const rootRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (!isAdvancedOpen) return

        const timeout = window.setTimeout(() => {
            rootRef.current?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            })
        }, 320)

        return () => {
            window.clearTimeout(timeout)
        }
    }, [isAdvancedOpen])

    if (entries.length === 0) return null

    return (
        <div ref={rootRef} className="flex flex-col gap-3">
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

    // Stabilize the schema reference by structural equality. Without this,
    // every parent re-render (triggered by validateAndEmit → dispatchUpdate)
    // produces a new schema object from useMemo upstream, which propagates as
    // a new validationSchema reference to EditorProvider. EditorProvider's
    // extension useMemo then recomputes, remounting LexicalExtensionComposer
    // and causing the editor to lose focus and scroll to the top.
    const schemaJsonRef = useRef("")
    const stableSchemaRef = useRef(schema)
    const schemaJson = JSON.stringify(schema)
    if (schemaJson !== schemaJsonRef.current) {
        schemaJsonRef.current = schemaJson
        stableSchemaRef.current = schema
    }

    const validateAndEmit = useCallback(
        (nextEditorValue: string) => {
            const raw = nextEditorValue.trim()
            if (!raw) {
                onChange(fieldKey, null)
                return
            }

            let parsed: unknown
            try {
                parsed = JSON.parse(raw)
            } catch {
                return
            }

            if (parsed === null) {
                onChange(fieldKey, null)
                return
            }

            const validationResult = validateConfigAgainstSchema(
                parsed as Record<string, unknown>,
                stableSchemaRef.current as Record<string, unknown>,
            )
            if (!validationResult.valid) {
                return
            }

            onChange(fieldKey, parsed)
        },
        [fieldKey, onChange],
    )

    return (
        <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-0.5">
                <Typography.Text className="font-medium">{label}</Typography.Text>
                <Typography.Text type="secondary" className="text-xs leading-snug">
                    Provider-specific chat template options sent with the model request in JSON
                    format.{" "}
                    <a
                        href="https://agenta.ai/docs/prompt-engineering/playground/chat-template-kwargs"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-gray-500"
                    >
                        Learn more
                    </a>
                </Typography.Text>
            </div>
            <SharedEditor
                key={`llm-config-${fieldKey}`}
                editorType="border"
                placeholder='{"thinking": true}'
                initialValue={externalEditorValue}
                handleChange={validateAndEmit}
                disabled={disabled}
                disableDebounce
                className="min-h-[96px] overflow-hidden"
                editorProps={{
                    codeOnly: true,
                    language: "json",
                    showLineNumbers: false,
                    skipScroll: true,
                    validationSchema: stableSchemaRef.current as Record<string, unknown>,
                }}
            />
        </div>
    )
})
