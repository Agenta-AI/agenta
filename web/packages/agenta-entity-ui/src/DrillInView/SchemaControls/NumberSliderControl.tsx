/**
 * NumberSliderControl
 *
 * Schema-driven numeric input with slider for range selection.
 * Used for temperature, max tokens, top P, penalties, etc.
 */

import {memo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {LabeledField, SliderInput} from "@agenta/ui"

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
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    return (
        <LabeledField
            label={label}
            description={tooltipText}
            withTooltip={withTooltip}
            direction="horizontal"
            className={className}
        >
            <SliderInput
                value={value}
                onChange={onChange}
                min={min}
                max={max}
                step={step}
                disabled={disabled}
                allowClear={allowClear}
                placeholder={placeholder}
            />
        </LabeledField>
    )
})
