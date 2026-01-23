/**
 * GroupedChoiceControl
 *
 * Schema-driven grouped select for model selection and other grouped choices.
 * Uses injected SelectLLMProvider for model selection or a grouped Select for other cases.
 *
 * Handles schema properties with:
 * - x-parameter: "grouped_choice"
 * - choices: { provider: [...models] } structure
 */

import {memo, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {cn, LabeledField} from "@agenta/ui"
import {Select} from "antd"

import {useDrillInUI} from "../context"

import {getOptionsFromSchema} from "./schemaUtils"

export interface GroupedChoiceControlProps {
    /** The schema property defining grouped options */
    schema?: SchemaProperty | null
    /** Display label for the control */
    label?: string
    /** Current value */
    value: string | null | undefined
    /** Change handler */
    onChange: (value: string | null) => void
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
}

/**
 * Check if this schema represents a model selection field
 */
function isModelField(schema: SchemaProperty | null | undefined): boolean {
    if (!schema) return false

    const title = ((schema.title as string | undefined) || "").toLowerCase()
    const xParam = schema["x-parameter"] as string | undefined

    return title === "model" || xParam === "grouped_choice"
}

/**
 * A controlled select component for choosing from grouped options.
 *
 * For model selection (x-parameter: "grouped_choice" or title: "Model"),
 * uses injected SelectLLMProvider which provides:
 * - Grouped options by provider
 * - Search functionality
 * - Custom secrets indicator
 * - Add provider button
 *
 * For other grouped choices, uses a standard grouped Select.
 */
export const GroupedChoiceControl = memo(function GroupedChoiceControl({
    schema,
    label,
    value,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    placeholder = "Select...",
    className,
}: GroupedChoiceControlProps) {
    // Get injected SelectLLMProvider component
    const {SelectLLMProvider} = useDrillInUI()

    // All hooks must be called before any early returns
    const schemaOptions = useMemo(() => getOptionsFromSchema(schema), [schema])
    const isModel = useMemo(() => isModelField(schema), [schema])

    // Get description from schema or prop
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Options are already in the correct format from getOptionsFromSchema (may be null)
    const selectOptions = schemaOptions?.options ?? []

    // Model selection - use SelectLLMProvider if available
    // SelectLLMProvider can fetch its own options, so it works even without schema options
    if (isModel && SelectLLMProvider) {
        return (
            <LabeledField
                label={label}
                description={tooltipText}
                withTooltip={withTooltip && !!label}
                className={className}
            >
                <SelectLLMProvider
                    showGroup
                    showAddProvider
                    showCustomSecretsOnOptions
                    options={selectOptions}
                    value={value ?? undefined}
                    onChange={(val: string | undefined) => onChange(val ?? null)}
                    disabled={disabled}
                    placeholder={placeholder}
                    className="w-full"
                    size="small"
                />
            </LabeledField>
        )
    }

    // No options available and not a model field - return null
    if (selectOptions.length === 0) {
        return null
    }

    // Other grouped choices or no SelectLLMProvider - use standard grouped Select
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
                options={selectOptions}
                disabled={disabled}
                placeholder={placeholder}
                className="w-full"
                size="small"
                showSearch
                optionFilterProp="label"
            />
        </LabeledField>
    )
})
