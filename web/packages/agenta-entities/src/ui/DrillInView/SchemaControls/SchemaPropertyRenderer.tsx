/**
 * SchemaPropertyRenderer
 *
 * Universal schema-driven field renderer that routes to appropriate controls
 * based on JSON Schema metadata. This is the primary component for rendering
 * configuration fields in a schema-driven UI.
 *
 * Unlike PlaygroundVariantPropertyControl, this component:
 * - Has no dependency on legacy playground atoms
 * - Accepts schema as a prop (not from global metadata)
 * - Uses simple value/onChange props (not atom-based mutations)
 * - Works with any entity controller pattern
 */

import {memo, useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"

import type {SchemaProperty} from "../../../shared"
import {formatLabel} from "../utils"

import {BooleanToggleControl} from "./BooleanToggleControl"
import {EnumSelectControl} from "./EnumSelectControl"
import {GroupedChoiceControl} from "./GroupedChoiceControl"
import {MessagesSchemaControl, isMessagesSchema} from "./MessagesSchemaControl"
import {NumberSliderControl} from "./NumberSliderControl"
import {ObjectSchemaControl} from "./ObjectSchemaControl"
import {PromptSchemaControl, isPromptSchema, isPromptValue} from "./PromptSchemaControl"
import {hasGroupedChoices, resolveAnyOfSchema, shouldRenderObjectInline} from "./schemaUtils"
import {TextInputControl} from "./TextInputControl"

export interface SchemaPropertyRendererProps {
    /** The schema property defining the field */
    schema: SchemaProperty | null | undefined
    /** Display label for the field */
    label: string
    /** Current value */
    value: unknown
    /** Change handler */
    onChange: (value: unknown) => void
    /** Optional description override */
    description?: string
    /** Whether to show tooltip */
    withTooltip?: boolean
    /** Disable the control */
    disabled?: boolean
    /** Placeholder text (for text/select fields) */
    placeholder?: string
    /** Additional CSS classes */
    className?: string
    /** Path to this property (for debugging) */
    path?: string[]
    /**
     * Force a specific control type.
     * Useful when schema type is ambiguous or for custom rendering.
     */
    as?: "number" | "text" | "enum" | "boolean" | "textarea"
    /** Hide the model selector in prompt controls (when shown elsewhere) */
    hideModelSelector?: boolean
}

/**
 * Determine the best control type for a schema property.
 * Falls back to value-based detection when schema is not available.
 */
function getControlType(
    schema: SchemaProperty | null | undefined,
    value: unknown,
    forceType?: SchemaPropertyRendererProps["as"],
):
    | "number"
    | "text"
    | "enum"
    | "boolean"
    | "textarea"
    | "object"
    | "object_inline"
    | "array"
    | "messages"
    | "prompt"
    | "grouped_choice"
    | "unknown" {
    if (forceType) return forceType

    // When schema is null, fall back to value-based detection
    if (!schema) {
        // Check for prompt object by value
        if (isPromptValue(value)) {
            return "prompt"
        }
        // For other objects without schema, render as object
        if (value && typeof value === "object" && !Array.isArray(value)) {
            return "object"
        }
        // For arrays without schema
        if (Array.isArray(value)) {
            return "array"
        }
        return "text"
    }

    // Resolve anyOf/oneOf schemas to get the actual type (handles nullable types)
    const resolvedSchema = resolveAnyOfSchema(schema)
    if (!resolvedSchema) return "text"

    // Check for prompt objects (with messages array) - must be first
    if (isPromptSchema(resolvedSchema)) {
        return "prompt"
    }

    // Check for grouped choices (e.g., model selection) - must be before enum check
    if (hasGroupedChoices(resolvedSchema)) {
        return "grouped_choice"
    }

    // Check for messages array (chat messages) - must be before generic array check
    if (isMessagesSchema(resolvedSchema)) {
        return "messages"
    }

    // Check for enum - show as select regardless of base type
    if (
        resolvedSchema.enum &&
        Array.isArray(resolvedSchema.enum) &&
        resolvedSchema.enum.length > 0
    ) {
        return "enum"
    }

    // Check schema type
    switch (resolvedSchema.type) {
        case "boolean":
            return "boolean"

        case "number":
        case "integer":
            return "number"

        case "string":
            // Check for multiline hint
            const xParams = (schema as any)?.["x-parameters"]
            if (xParams?.multiline === true || xParams?.code === true) {
                return "textarea"
            }
            return "text"

        case "object":
            // Check if object should be rendered inline (e.g., llm_config)
            if (shouldRenderObjectInline(schema)) {
                return "object_inline"
            }
            return "object"

        case "array":
            return "array"

        default:
            return "unknown"
    }
}

/**
 * Universal schema-driven field renderer.
 *
 * Routes to appropriate control based on schema type:
 * - number/integer → NumberSliderControl
 * - string (with grouped choices) → GroupedChoiceControl (e.g., model selection)
 * - string (with enum) → EnumSelectControl
 * - string → TextInputControl
 * - string (multiline) → TextInputControl with multiline
 * - boolean → BooleanToggleControl
 * - object (llm_config-like) → ObjectSchemaControl (inline properties)
 * - object → Shows nested object indicator (drill-in)
 * - array (messages) → MessagesSchemaControl (chat message UI)
 * - array → Shows array indicator (drill-in)
 *
 * Detects grouped choices via:
 * - x-parameter: "grouped_choice" or "choice" with choices object
 * - choices property as { provider: [models] } structure
 *
 * Detects messages arrays via:
 * - x-parameter: "messages"
 * - Array items with role/content properties
 *
 * @example
 * ```tsx
 * // Basic usage with schema
 * <SchemaPropertyRenderer
 *   schema={{ type: "number", minimum: 0, maximum: 1 }}
 *   label="Temperature"
 *   value={0.7}
 *   onChange={(v) => setTemperature(v as number)}
 * />
 *
 * // With entity controller
 * const schema = useAtomValue(appRevision.selectors.schemaAtPath({ revisionId, path }))
 * const value = entity.drillIn.getValueAtPath(data, path)
 * <SchemaPropertyRenderer
 *   schema={schema}
 *   label={formatLabel(path[path.length - 1])}
 *   value={value}
 *   onChange={(v) => dispatch({ type: 'setAtPath', path, value: v })}
 * />
 * ```
 */
export const SchemaPropertyRenderer = memo(function SchemaPropertyRenderer({
    schema,
    label,
    value,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    placeholder,
    className,
    path,
    as,
    hideModelSelector = false,
}: SchemaPropertyRendererProps) {
    // Resolve anyOf/oneOf schemas for rendering
    const resolvedSchema = useMemo(() => resolveAnyOfSchema(schema), [schema])
    const controlType = useMemo(() => getControlType(schema, value, as), [schema, value, as])

    // Format label from path if not provided
    // Use ?? to respect empty string (label="") vs undefined/null
    const displayLabel = label ?? (path?.length ? formatLabel(path[path.length - 1]) : "Value")

    // Get description from schema or prop
    const tooltipDesc = description ?? (schema as any)?.description

    // Render based on control type (use resolvedSchema for type info like min/max)
    switch (controlType) {
        case "number":
            return (
                <NumberSliderControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as number | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    placeholder={placeholder}
                    className={className}
                />
            )

        case "grouped_choice":
            return (
                <GroupedChoiceControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as string | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    placeholder={placeholder}
                    className={className}
                />
            )

        case "enum":
            return (
                <EnumSelectControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as string | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    placeholder={placeholder}
                    className={className}
                />
            )

        case "boolean":
            return (
                <BooleanToggleControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as boolean | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    className={className}
                />
            )

        case "textarea":
            return (
                <TextInputControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as string | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    placeholder={placeholder}
                    multiline
                    className={className}
                />
            )

        case "text":
            return (
                <TextInputControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as string | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    placeholder={placeholder}
                    className={className}
                />
            )

        case "object_inline":
            // Render object properties inline (e.g., llm_config)
            return (
                <ObjectSchemaControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as Record<string, unknown> | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    path={path}
                    className={className}
                    SchemaPropertyRenderer={SchemaPropertyRenderer}
                />
            )

        case "messages":
            // Render chat messages array with specialized UI
            return (
                <MessagesSchemaControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as unknown[] | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    disabled={disabled}
                    className={className}
                />
            )

        case "prompt":
            // Render prompt object with message cards and LLM config
            return (
                <PromptSchemaControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={value as Record<string, unknown> | null}
                    onChange={(v) => onChange(v)}
                    description={tooltipDesc}
                    disabled={disabled}
                    className={className}
                    hideModelSelector={hideModelSelector}
                />
            )

        case "object":
            // For objects, show indicator that user should navigate into it
            return (
                <div className={clsx("flex flex-col gap-1", className)}>
                    <Typography.Text className="text-sm font-medium">
                        {displayLabel}
                    </Typography.Text>
                    <Typography.Text type="secondary" className="text-xs">
                        Object with{" "}
                        {resolvedSchema?.properties
                            ? Object.keys(resolvedSchema.properties).length
                            : 0}{" "}
                        properties (click to expand)
                    </Typography.Text>
                </div>
            )

        case "array":
            // For arrays, show indicator that user should navigate into it
            return (
                <div className={clsx("flex flex-col gap-1", className)}>
                    <Typography.Text className="text-sm font-medium">
                        {displayLabel}
                    </Typography.Text>
                    <Typography.Text type="secondary" className="text-xs">
                        Array with {Array.isArray(value) ? value.length : 0} items (click to expand)
                    </Typography.Text>
                </div>
            )

        case "unknown":
        default:
            // Fallback to text input for unknown types
            return (
                <TextInputControl
                    schema={resolvedSchema}
                    label={displayLabel}
                    value={typeof value === "string" ? value : JSON.stringify(value ?? "")}
                    onChange={(v) => {
                        // Try to parse as JSON for complex types
                        try {
                            onChange(JSON.parse(v))
                        } catch {
                            onChange(v)
                        }
                    }}
                    description={tooltipDesc}
                    withTooltip={withTooltip}
                    disabled={disabled}
                    placeholder={placeholder}
                    className={className}
                />
            )
    }
})
