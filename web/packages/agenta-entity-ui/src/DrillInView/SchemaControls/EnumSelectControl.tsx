/**
 * EnumSelectControl
 *
 * Schema-driven dropdown select for enumerated values.
 * Used for model selection, output type, prompt syntax, etc.
 */

import {memo, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    ComboboxValue,
} from "@agenta/primitive-ui/components/combobox"
import {formatEnumLabel} from "@agenta/shared/utils"
import {LabeledField, SimpleDropdownSelect} from "@agenta/ui/components/presentational"
import {cn} from "@agenta/ui/styles"

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
 * Extract options from a schema's enum or a `oneOf` of `{const, title}` entries.
 *
 * Two shapes are supported. A flat `enum` (the common case) maps each value through
 * `formatEnumLabel`. A `oneOf` of `{const, title}` entries (used by the agent harness field,
 * where each option carries a display name and a versioned slug identity alongside its bare
 * value) keeps the bare `const` as the value and shows the `title` as the label, so the option
 * value the control writes back is unchanged while the dropdown reads clearly.
 */
export function getEnumOptions(
    schema: SchemaProperty | null | undefined,
): {value: string; label: string}[] {
    const oneOf = (schema as {oneOf?: unknown})?.oneOf
    if (Array.isArray(oneOf)) {
        const options = oneOf
            .filter(
                (entry): entry is {const: unknown; title?: unknown} =>
                    !!entry &&
                    typeof entry === "object" &&
                    "const" in (entry as Record<string, unknown>),
            )
            .map((entry) => ({
                value: String(entry.const),
                label:
                    typeof entry.title === "string" && entry.title
                        ? entry.title
                        : formatEnumLabel(entry.const),
            }))
        if (options.length > 0) {
            return options
        }
    }

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
        return getEnumOptions(schema)
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
            <Combobox value={value ?? undefined} onValueChange={(val) => onChange(val ?? null)}>
                <ComboboxTrigger className="w-full" size="sm">
                    <ComboboxValue placeholder={placeholder} />
                </ComboboxTrigger>
                <ComboboxContent>
                    <ComboboxInput placeholder="Search..." />
                    <ComboboxEmpty>No results found</ComboboxEmpty>
                    {options.map((o) => (
                        <ComboboxItem key={o.value} value={o.value}>
                            {o.label}
                        </ComboboxItem>
                    ))}
                </ComboboxContent>
            </Combobox>
        </LabeledField>
    )
})
