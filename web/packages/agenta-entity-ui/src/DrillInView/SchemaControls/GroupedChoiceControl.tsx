/**
 * GroupedChoiceControl
 *
 * Schema-driven grouped select for model selection and other grouped choices.
 * Uses SelectLLMProviderBase from @agenta/ui for model selection (with config data
 * from DrillInUIContext) or a grouped Select for other cases.
 *
 * Handles schema properties with:
 * - x-parameter: "grouped_choice"
 * - choices: { provider: [...models] } structure
 */

import {memo, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import {LabeledField} from "@agenta/ui/components/presentational"
import {SelectLLMProviderBase} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
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
 * uses SelectLLMProviderBase from @agenta/ui which provides:
 * - Grouped options by provider
 * - Search functionality
 * - Custom secrets (via extraOptionGroups from context)
 * - Add provider button (via footerContent from context)
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
    // Get LLM provider config data from context (vault secrets, footer)
    const {llmProviderConfig} = useDrillInUI()

    // All hooks must be called before any early returns
    const schemaOptions = useMemo(() => getOptionsFromSchema(schema), [schema])
    const isModel = useMemo(() => isModelField(schema), [schema])

    // Merge schema options with extra option groups from vault/custom secrets
    const mergedOptions = useMemo(() => {
        const base = schemaOptions?.options ?? []
        const extra = llmProviderConfig?.extraOptionGroups ?? []
        return [...extra, ...base]
    }, [schemaOptions, llmProviderConfig?.extraOptionGroups])

    // Get description from schema or prop
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Options are already in the correct format from getOptionsFromSchema (may be null)
    const selectOptions = schemaOptions?.options ?? []

    // Model selection - use SelectLLMProviderBase with merged options
    if (isModel) {
        return (
            <LabeledField
                label={label}
                description={tooltipText}
                withTooltip={withTooltip && !!label}
                className={className}
            >
                <SelectLLMProviderBase
                    showGroup
                    options={mergedOptions}
                    value={value ?? undefined}
                    onChange={(val) => onChange((val as string) ?? null)}
                    disabled={disabled}
                    placeholder={placeholder}
                    className="w-full"
                    size="small"
                    footerContent={llmProviderConfig?.footerContent}
                />
            </LabeledField>
        )
    }

    // No options available and not a model field - return null
    if (selectOptions.length === 0) {
        return null
    }

    // Other grouped choices - use standard grouped Select
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
