/**
 * EnumSelectControl
 *
 * Schema-driven dropdown select for enumerated values.
 * Used for model selection, output type, prompt syntax, etc.
 */

import {memo, useMemo} from "react"

import {cn, LabeledField, SimpleDropdownSelect} from "@agenta/ui"
import {Select} from "antd"

import type {SchemaProperty} from "../../../shared"

export interface EnumSelectControlProps {
    /** The schema property defining enum options */
    schema?: SchemaProperty | null
    /** Display label for the control */
    label?: string
    /** Current value */
    value: string | null | undefined
    /** Change handler */
    onChange: (value: string | null) => void
    /** Override options (takes precedence over schema.enum) */
    options?: {value: string; label: string}[]
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
    /** Render as compact dropdown button instead of full select */
    variant?: "select" | "dropdown"
    /** Additional CSS classes */
    className?: string
}

/**
 * Format enum value as readable label
 */
function formatEnumLabel(value: unknown): string {
    if (typeof value !== "string") return String(value)

    // Convert snake_case or camelCase to Title Case
    return value
        .replace(/_/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .split(" ")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(" ")
}

/**
 * Extract options from schema enum
 */
function getOptionsFromSchema(
    schema: SchemaProperty | null | undefined,
): {value: string; label: string}[] {
    if (!schema?.enum || !Array.isArray(schema.enum)) {
        return []
    }

    return schema.enum.map((value) => ({
        value: String(value),
        label: formatEnumLabel(value),
    }))
}

/**
 * A controlled select component for choosing from enumerated options.
 *
 * Uses schema to determine:
 * - Available options (from enum)
 * - Description for tooltip
 *
 * Supports two variants:
 * - "select": Full AntD Select component with search
 * - "dropdown": Compact button with dropdown menu
 */
export const EnumSelectControl = memo(function EnumSelectControl({
    schema,
    label,
    value,
    onChange,
    options: overrideOptions,
    description,
    withTooltip = true,
    disabled = false,
    placeholder = "Select...",
    allowClear = false,
    variant = "select",
    className,
}: EnumSelectControlProps) {
    // Get options from override or schema
    const options = useMemo(() => {
        if (overrideOptions && overrideOptions.length > 0) {
            return overrideOptions
        }
        return getOptionsFromSchema(schema)
    }, [overrideOptions, schema])

    // Get description from schema or prop
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Dropdown variant (compact button) - use SimpleDropdownSelect from @agenta/ui
    if (variant === "dropdown") {
        return (
            <SimpleDropdownSelect
                value={value ?? ""}
                options={options}
                onChange={(val) => onChange(val || null)}
                disabled={disabled}
                placeholder={placeholder}
                className={cn("capitalize", className)}
                description={tooltipText}
                withTooltip={withTooltip}
            />
        )
    }

    // Select variant (full select)
    return (
        <LabeledField
            label={label}
            description={tooltipText}
            withTooltip={withTooltip && !!label}
            className={cn(className)}
        >
            <Select
                value={value ?? undefined}
                onChange={(val) => onChange(val ?? null)}
                options={options}
                disabled={disabled}
                placeholder={placeholder}
                allowClear={allowClear}
                className="w-full"
                size="small"
                showSearch
                filterOption={(input, option) =>
                    (option?.label?.toString() ?? "").toLowerCase().includes(input.toLowerCase())
                }
            />
        </LabeledField>
    )
})
