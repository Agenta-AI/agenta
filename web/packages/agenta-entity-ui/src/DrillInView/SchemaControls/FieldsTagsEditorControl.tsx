/**
 * FieldsTagsEditorControl
 *
 * Schema-driven tag editor for managing JSON field paths.
 * Used by the JSON Multi-Field Match evaluator.
 *
 * Users can add/remove field paths (dot-notation for nested fields).
 * An "aggregate_score" tag is always displayed but not removable.
 *
 * Schema hint: x-parameter: "fields_tags_editor"
 * Value type: string[] (array of field path strings)
 */

import {memo, useCallback, useState} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {LabeledField} from "@agenta/ui/components/presentational"
import {Plus} from "@phosphor-icons/react"
import {Button, Input, Tag, Tooltip, Typography} from "antd"

const {Text} = Typography

export interface FieldsTagsEditorControlProps {
    schema?: SchemaProperty | null
    label?: string
    value: string[] | null | undefined
    onChange: (value: string[]) => void
    description?: string
    withTooltip?: boolean
    disabled?: boolean
    className?: string
}

export const FieldsTagsEditorControl = memo(function FieldsTagsEditorControl({
    schema,
    label,
    value = [],
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    className,
}: FieldsTagsEditorControlProps) {
    const [inputValue, setInputValue] = useState("")
    const fields = value ?? []

    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    const handleAddField = useCallback(() => {
        const trimmed = inputValue.trim()
        if (!trimmed) return
        if (fields.includes(trimmed) || trimmed === "aggregate_score") {
            setInputValue("")
            return
        }
        onChange([...fields, trimmed])
        setInputValue("")
    }, [inputValue, fields, onChange])

    const handleRemoveField = useCallback(
        (fieldToRemove: string) => {
            onChange(fields.filter((f) => f !== fieldToRemove))
        },
        [fields, onChange],
    )

    const handleInputKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault()
                handleAddField()
            }
        },
        [handleAddField],
    )

    return (
        <LabeledField
            label={label}
            description={tooltipText}
            withTooltip={withTooltip && !!label}
            className={className}
        >
            <div className="flex flex-col gap-2">
                {/* Field Tags Display */}
                <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-md border border-solid border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] min-h-[32px]">
                    <Tooltip title="Aggregate score across all fields (auto-generated)">
                        <Tag
                            color="success"
                            className="font-mono text-xs !m-0 !leading-tight !py-0.5 !px-1.5"
                        >
                            aggregate_score
                        </Tag>
                    </Tooltip>

                    {fields.map((field) => (
                        <Tag
                            key={field}
                            closable={!disabled}
                            onClose={() => handleRemoveField(field)}
                            className="flex items-center font-mono text-xs !m-0 !leading-tight !py-0.5 !px-1.5"
                        >
                            {field}
                        </Tag>
                    ))}

                    {fields.length === 0 && (
                        <Text className="text-[var(--ant-color-text-secondary)] text-xs">
                            Add fields to compare
                        </Text>
                    )}
                </div>

                {/* Add Field Input */}
                {!disabled && (
                    <div className="flex gap-2">
                        <Input
                            size="small"
                            className="flex-1 font-mono"
                            placeholder="Add field (e.g., name or user.address.city)"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            suffix={
                                <Tooltip title="Use dot notation for nested fields (e.g., user.name)">
                                    <Text type="secondary" className="text-[11px]">
                                        ?
                                    </Text>
                                </Tooltip>
                            }
                        />
                        <Button
                            size="small"
                            icon={<Plus size={12} />}
                            onClick={handleAddField}
                            disabled={!inputValue.trim()}
                        >
                            Add
                        </Button>
                    </div>
                )}

                {/* Helper Text */}
                <Text type="secondary" className="text-[11px]">
                    Each field creates a column with value 0 (no match) or 1 (match)
                </Text>
            </div>
        </LabeledField>
    )
})
