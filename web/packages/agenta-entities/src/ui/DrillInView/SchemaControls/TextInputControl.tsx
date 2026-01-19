/**
 * TextInputControl
 *
 * Schema-driven text input for string values.
 * Supports both single-line input and multi-line textarea.
 */

import {memo, useCallback, useState, useEffect} from "react"

import {Input, Tooltip, Typography} from "antd"
import clsx from "clsx"

import type {SchemaProperty} from "../../../shared"

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
    // Check x-parameters for multiline hint
    const xParams = (schema as any)?.["x-parameters"]
    if (xParams?.multiline === true) return true

    // Check if maxLength suggests long text
    const maxLength = (schema as any)?.maxLength
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
    const maxLength = (schema as any)?.maxLength
    const minLength = (schema as any)?.minLength

    // Get description from schema or prop
    const tooltipText = description ?? (schema as any)?.description ?? ""

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

    const content = (
        <div className={clsx("flex flex-col gap-1", className)}>
            {label && <Typography.Text className="text-sm font-medium">{label}</Typography.Text>}
            {inputContent}
            {(maxLength || minLength) && (
                <Typography.Text type="secondary" className="text-xs">
                    {minLength && `Min: ${minLength}`}
                    {minLength && maxLength && " / "}
                    {maxLength && `Max: ${maxLength}`}
                </Typography.Text>
            )}
        </div>
    )

    if (withTooltip && tooltipText && label) {
        return (
            <Tooltip title={tooltipText} placement="right">
                {content}
            </Tooltip>
        )
    }

    return content
})
