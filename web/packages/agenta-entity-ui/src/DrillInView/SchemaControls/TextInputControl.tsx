/**
 * TextInputControl
 *
 * Schema-driven text input for string values.
 * Supports both single-line input and multi-line textarea.
 */

import {memo, useCallback, useEffect, useState} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {LabeledField} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"
import {Input, Typography} from "antd"

const {TextArea} = Input

export interface TextInputControlProps {
    /** The schema property defining constraints */
    schema?: SchemaProperty | null
    /** Display label for the control */
    label?: string
    /** Current value */
    value: string | null | undefined
    /** Change handler */
    onChange: (value: string) => void
    /** Optional description for tooltip */
    description?: string
    /** Whether to show tooltip */
    withTooltip?: boolean
    /** Disable the control */
    disabled?: boolean
    /** Placeholder text */
    placeholder?: string
    /** Force multi-line mode */
    multiline?: boolean
    /** Number of rows for multiline */
    rows?: number
    /** Additional CSS classes */
    className?: string
}

/**
 * Determine if field should be multiline based on schema
 */
function shouldBeMultiline(schema: SchemaProperty | null | undefined): boolean {
    if (!schema) return false

    // Check x-parameters for multiline hint
    const xParams = schema["x-parameters"] as SchemaProperty["x-parameters"]
    if (xParams?.multiline === true) return true

    // Check if maxLength suggests long text
    const maxLength = schema.maxLength as number | undefined
    if (maxLength && maxLength > 200) return true

    return false
}

/**
 * A controlled text input component for string properties.
 *
 * Uses schema to determine:
 * - Whether to use multiline textarea
 * - Max length constraints
 * - Description for tooltip
 */
export const TextInputControl = memo(function TextInputControl({
    schema,
    label,
    value,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    placeholder,
    multiline: forceMultiline,
    rows = 3,
    className,
}: TextInputControlProps) {
    // Determine if multiline from schema or prop
    const isMultiline = forceMultiline ?? shouldBeMultiline(schema)

    // Get constraints from schema
    const maxLength = schema?.maxLength as number | undefined
    const minLength = schema?.minLength as number | undefined

    // Get description from schema or prop
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Local state for controlled input
    const [localValue, setLocalValue] = useState<string>(value ?? "")

    // Sync local state with external value
    useEffect(() => {
        setLocalValue(value ?? "")
    }, [value])

    // Handle value changes
    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
            const newValue = e.target.value
            setLocalValue(newValue)
            onChange(newValue)
        },
        [onChange],
    )

    const inputContent = isMultiline ? (
        <TextArea
            value={localValue}
            onChange={handleChange}
            disabled={disabled}
            placeholder={placeholder}
            maxLength={maxLength}
            rows={rows}
            className="resize-y"
            size="small"
        />
    ) : (
        <Input
            value={localValue}
            onChange={handleChange}
            disabled={disabled}
            placeholder={placeholder}
            maxLength={maxLength}
            size="small"
        />
    )

    return (
        <LabeledField
            label={label}
            description={tooltipText}
            withTooltip={withTooltip && !!label}
            className={cn(className)}
        >
            {inputContent}
            {(maxLength || minLength) && (
                <Typography.Text type="secondary" className="text-xs">
                    {minLength && `Min: ${minLength}`}
                    {minLength && maxLength && " / "}
                    {maxLength && `Max: ${maxLength}`}
                </Typography.Text>
            )}
        </LabeledField>
    )
})
