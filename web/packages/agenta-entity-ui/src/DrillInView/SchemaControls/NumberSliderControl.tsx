/**
 * NumberSliderControl
 *
 * Schema-driven numeric input with slider for range selection.
 * Used for temperature, max tokens, top P, penalties, etc.
 *
 * Layout: label + InputNumber on one row (justify-between),
 * Slider below spanning full width.
 */

import {memo, useCallback, useEffect, useState} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {cn, flexLayouts, gapClasses, textColors} from "@agenta/ui/styles"
import {InputNumber, Slider, Tooltip, Typography} from "antd"

const {Text} = Typography

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
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Local state for immediate UI feedback
    const [localValue, setLocalValue] = useState<number | null>(value ?? null)

    useEffect(() => {
        setLocalValue(value ?? null)
    }, [value])

    const handleValueChange = useCallback(
        (newValue: number | null | undefined) => {
            const processed = newValue === undefined ? null : newValue
            setLocalValue(processed)
            onChange(processed)
        },
        [onChange],
    )

    const content = (
        <div className={cn(flexLayouts.column, gapClasses.xs, className)}>
            <div className={cn(flexLayouts.rowCenter, "justify-between")}>
                <Text className={cn("font-medium", textColors.primary)}>{label}</Text>
                <InputNumber
                    min={min}
                    max={max}
                    step={step}
                    value={localValue}
                    onChange={handleValueChange}
                    disabled={disabled}
                    style={{width: 70}}
                    placeholder={placeholder}
                />
            </div>
            <Slider
                min={min}
                max={max}
                step={step}
                value={localValue ?? min}
                onChange={handleValueChange}
                disabled={disabled}
                className="!my-0"
            />
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
