/**
 * NumberSliderControl
 *
 * Schema-driven numeric input with slider for range selection.
 * Used for temperature, max tokens, top P, penalties, etc.
 */

import {memo, useCallback, useState, useEffect} from "react"

import {XCircle} from "@phosphor-icons/react"
import {Slider, InputNumber, Typography, Tooltip, Button} from "antd"
import clsx from "clsx"

import type {SchemaProperty} from "../../../shared"

export interface NumberSliderControlProps {
    /** The schema property defining constraints (min, max, type) */
    schema?: SchemaProperty | null
    /** Display label for the control */
    label: string
    /** Current value */
    value: number | null | undefined
    /** Change handler */
    onChange: (value: number | null) => void
    /** Optional description for tooltip */
    description?: string
    /** Whether to show tooltip */
    withTooltip?: boolean
    /** Disable the control */
    disabled?: boolean
    /** Placeholder text */
    placeholder?: string
    /** Allow clearing the value */
    allowClear?: boolean
    /** Additional CSS classes */
    className?: string
    /** Override minimum value */
    min?: number
    /** Override maximum value */
    max?: number
    /** Override step value */
    step?: number
}

/**
 * Extract numeric constraints from schema
 */
function getNumericConstraints(schema: SchemaProperty | null | undefined): {
    min: number
    max: number
    step: number
} {
    const isInteger = schema?.type === "integer"
    const defaultStep = isInteger ? 1 : 0.1

    // Access schema properties safely using bracket notation
    // JSON Schema uses minimum/maximum for numeric constraints
    const schemaAny = schema as Record<string, unknown> | null | undefined
    const schemaMin = typeof schemaAny?.["minimum"] === "number" ? schemaAny["minimum"] : undefined
    const schemaMax = typeof schemaAny?.["maximum"] === "number" ? schemaAny["maximum"] : undefined

    return {
        min: schemaMin ?? 0,
        max: schemaMax ?? (isInteger ? 100 : 1),
        step: defaultStep,
    }
}

/**
 * A controlled input component that combines a slider and number input
 * for numerical value selection within a defined range.
 *
 * Uses schema to determine:
 * - min/max bounds
 * - step size (1 for integer, 0.1 for number)
 * - description for tooltip
 */
export const NumberSliderControl = memo(function NumberSliderControl({
    schema,
    label,
    value,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    placeholder,
    allowClear = true,
    className,
    min: overrideMin,
    max: overrideMax,
    step: overrideStep,
}: NumberSliderControlProps) {
    // Extract constraints from schema, with overrides
    const constraints = getNumericConstraints(schema)
    const min = overrideMin ?? constraints.min
    const max = overrideMax ?? constraints.max
    const step = overrideStep ?? constraints.step

    // Get description from schema or prop
    const tooltipText = description ?? (schema as any)?.description ?? ""

    // Local state for immediate UI feedback (debounce handled externally)
    const [localValue, setLocalValue] = useState<number | null>(value ?? null)

    // Sync local state with external value
    useEffect(() => {
        setLocalValue(value ?? null)
    }, [value])

    // Handle value changes with immediate local update
    const handleValueChange = useCallback(
        (newValue: number | null | undefined) => {
            const processedValue = newValue === undefined ? null : newValue
            setLocalValue(processedValue)
            onChange(processedValue)
        },
        [onChange],
    )

    const content = (
        <div className={clsx("flex flex-col gap-1", className)}>
            <div className="flex items-center gap-2 justify-between">
                <Typography.Text className="text-sm font-medium">{label}</Typography.Text>

                <div className="flex items-center gap-1">
                    <InputNumber
                        min={min}
                        max={max}
                        step={step}
                        value={localValue}
                        onChange={handleValueChange}
                        disabled={disabled}
                        className="w-[70px] [&_input]:!text-center"
                        placeholder={placeholder}
                        size="small"
                    />

                    {allowClear && (localValue !== null || localValue === 0) && (
                        <Button
                            icon={<XCircle size={14} />}
                            type="text"
                            size="small"
                            onClick={() => handleValueChange(null)}
                            disabled={disabled}
                        />
                    )}
                </div>
            </div>

            <Slider
                min={min}
                max={max}
                step={step}
                value={localValue ?? min}
                disabled={disabled}
                onChange={handleValueChange}
                className="mt-0"
            />
        </div>
    )

    if (withTooltip && tooltipText) {
        return (
            <Tooltip title={tooltipText} placement="right">
                {content}
            </Tooltip>
        )
    }

    return content
})
