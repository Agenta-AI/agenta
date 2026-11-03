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
import {Tag} from "@agenta/ui/components/presentational"
import {
    Badge,
    Button,
    Field,
    InputAffix,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@agenta/ui/ui"
import {MagnifyingGlass, Plus, X} from "@phosphor-icons/react"

import {useFieldsDetection} from "./FieldsDetectionContext"

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
    const {detectFieldsFromTestcase, hasTestcaseData} = useFieldsDetection()

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

    const handleDetectFromTestcase = useCallback(() => {
        if (!detectFieldsFromTestcase) return
        const detected = detectFieldsFromTestcase()
        if (!detected || detected.length === 0) return
        // Merge detected fields with existing, avoiding duplicates and aggregate_score
        const existing = new Set(fields)
        existing.add("aggregate_score")
        const newFields = detected.filter((f) => !existing.has(f))
        if (newFields.length > 0) {
            onChange([...fields, ...newFields])
        }
    }, [detectFieldsFromTestcase, fields, onChange])

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
        <Field
            label={label}
            tooltip={withTooltip && !!label ? tooltipText : undefined}
            className={className}
        >
            <div className="flex flex-col gap-2">
                {/* Field Tags Display */}
                <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded-md border border-solid border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] min-h-[32px]">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Tag
                                    tone="success"
                                    className="font-mono text-xs m-0 leading-tight py-0.5 px-1.5"
                                >
                                    aggregate_score
                                </Tag>
                            </TooltipTrigger>
                            <TooltipContent>
                                Aggregate score across all fields (auto-generated)
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>

                    {fields.map((field) => (
                        <Badge
                            key={field}
                            className="flex items-center font-mono text-xs m-0 leading-tight py-0.5 px-1.5"
                        >
                            {field}
                            {!disabled && (
                                // antd's `.ant-tag-close-icon` (10px, 3px inset) — Tag's `dismissible` is sync-only.
                                <span
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Remove ${field}`}
                                    onClick={() => handleRemoveField(field)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === " ") {
                                            e.preventDefault()
                                            handleRemoveField(field)
                                        }
                                    }}
                                    className="-ml-px inline-flex cursor-pointer text-colorIcon hover:text-colorText"
                                >
                                    <X size={10} />
                                </span>
                            )}
                        </Badge>
                    ))}

                    {fields.length === 0 && (
                        <span className="text-[var(--ant-color-text-secondary)] text-xs">
                            Add fields to compare
                        </span>
                    )}
                </div>

                {/* Add Field Input */}
                {!disabled && (
                    <div className="flex gap-2">
                        <InputAffix
                            size="sm"
                            className="flex-1 font-mono"
                            aria-label="Add field"
                            placeholder="Add field (e.g., name or user.address.city)"
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleInputKeyDown}
                            suffix={
                                <TooltipProvider>
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <span className="font-sans text-xs text-colorTextDescription">
                                                ?
                                            </span>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            Use dot notation for nested fields (e.g., user.name)
                                        </TooltipContent>
                                    </Tooltip>
                                </TooltipProvider>
                            }
                        />
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleAddField}
                            disabled={!inputValue.trim()}
                        >
                            <Plus size={12} />
                            Add
                        </Button>
                    </div>
                )}

                {/* Helper text + Detect from testcase button */}
                <div className="flex items-start justify-between gap-3">
                    <span className="text-xs pt-0.5 text-colorTextDescription">
                        Each field creates a column with value 0 (no match) or 1 (match)
                    </span>
                    {!disabled && detectFieldsFromTestcase && (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={handleDetectFromTestcase}
                            disabled={!hasTestcaseData}
                            className="shrink-0 text-xs"
                        >
                            <MagnifyingGlass size={12} />
                            Detect from testcase
                        </Button>
                    )}
                </div>
            </div>
        </Field>
    )
})
