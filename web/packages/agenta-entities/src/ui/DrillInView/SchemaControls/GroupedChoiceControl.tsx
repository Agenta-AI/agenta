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

import {Select, Tooltip, Typography} from "antd"
import clsx from "clsx"

import type {SchemaProperty} from "../../../shared"
import {useDrillInUI} from "../context"

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
 * Extract grouped options from schema.choices
 * Converts { provider: [model1, model2] } to the format expected by SelectLLMProvider
 */
function getGroupedOptionsFromSchema(
    schema: SchemaProperty | null | undefined,
): Record<string, string[]> | null {
    if (!schema) return null

    // Check for choices property (grouped options)
    const choices = (schema as any)?.choices
    if (choices && typeof choices === "object" && !Array.isArray(choices)) {
        return choices as Record<string, string[]>
    }

    return null
}

/**
 * Check if this schema represents a model selection field
 */
function isModelField(schema: SchemaProperty | null | undefined): boolean {
    if (!schema) return false

    const title = (schema as any)?.title?.toLowerCase() || ""
    const xParam = (schema as any)?.["x-parameter"]

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
    const groupedOptions = useMemo(() => getGroupedOptionsFromSchema(schema), [schema])
    const isModel = useMemo(() => isModelField(schema), [schema])

    // Get description from schema or prop
    const tooltipText = description ?? (schema as any)?.description ?? ""

    // Convert grouped options to SelectLLMProvider format
    // { provider: [model1, model2] } -> [{ label: "Provider", options: [...] }]
    const selectOptions = useMemo(() => {
        if (!groupedOptions) return []
        return Object.entries(groupedOptions).map(([group, models]) => ({
            label: group.charAt(0).toUpperCase() + group.slice(1).replace(/_/g, " "),
            options: (models as string[]).map((model) => ({
                label: model,
                value: model,
            })),
        }))
    }, [groupedOptions])

    // For non-model grouped choices - prepare options for standard Select
    const groupedSelectOptions = useMemo(() => {
        if (!groupedOptions) return []
        return Object.entries(groupedOptions).map(([group, models]) => ({
            label: group.charAt(0).toUpperCase() + group.slice(1).replace(/_/g, " "),
            options: (models as string[]).map((model) => ({
                label: model,
                value: model,
            })),
        }))
    }, [groupedOptions])

    // No grouped options - return null
    if (!groupedOptions) {
        return null
    }

    // Model selection - use SelectLLMProvider if available
    if (isModel && SelectLLMProvider) {
        const content = (
            <div className={clsx("flex flex-col gap-1", className)}>
                {label && (
                    <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
                )}
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
    }

    // Other grouped choices or no SelectLLMProvider - use standard grouped Select
    const selectContent = (
        <div className={clsx("flex flex-col gap-1", className)}>
            {label && <Typography.Text className="text-sm font-medium">{label}</Typography.Text>}
            <Select
                value={value ?? undefined}
                onChange={(val) => onChange(val ?? null)}
                options={groupedSelectOptions}
                disabled={disabled}
                placeholder={placeholder}
                className="w-full"
                size="small"
                showSearch
                optionFilterProp="label"
            />
        </div>
    )

    if (withTooltip && tooltipText && label) {
        return (
            <Tooltip title={tooltipText} placement="right">
                {selectContent}
            </Tooltip>
        )
    }

    return selectContent
})
