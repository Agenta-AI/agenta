/**
 * ObjectSchemaControl
 *
 * Schema-driven object renderer that displays all properties of an object inline.
 * Uses SchemaPropertyRenderer for each property based on its schema.
 *
 * This replaces the pattern from PlaygroundVariantPropertyControl's object renderer
 * but uses the entity controller pattern instead of legacy playground atoms.
 *
 * Handles:
 * - Objects like llm_config with nested properties
 * - Special object types (ToolConfiguration, etc.)
 * - Recursive rendering of nested objects
 */

import {memo, useMemo, useState} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {Button, Tooltip, Typography} from "antd"
import clsx from "clsx"

import type {SchemaProperty} from "../../../shared"
import {formatLabel} from "../utils"

// Forward declaration - actual component imported to avoid circular deps
import type {SchemaPropertyRendererProps} from "./SchemaPropertyRenderer"

export interface ObjectSchemaControlProps {
    /** The schema property defining the object structure */
    schema: SchemaProperty | null | undefined
    /** Display label for the object */
    label: string
    /** Current value (object) */
    value: Record<string, unknown> | null | undefined
    /** Change handler for the entire object */
    onChange: (value: Record<string, unknown>) => void
    /** Optional description for tooltip */
    description?: string
    /** Whether to show tooltip */
    withTooltip?: boolean
    /** Disable all controls */
    disabled?: boolean
    /** Additional CSS classes */
    className?: string
    /** Path to this object (for debugging) */
    path?: string[]
    /** Whether to show header with label (default: true) */
    showHeader?: boolean
    /** Whether object is initially collapsed (default: false) */
    defaultCollapsed?: boolean
    /** Callback to update a specific property within the object */
    onPropertyChange?: (propertyPath: string[], value: unknown) => void
    /** SchemaPropertyRenderer component (passed to avoid circular imports) */
    SchemaPropertyRenderer?: React.ComponentType<SchemaPropertyRendererProps>
}

/**
 * Check if this is a special object type that needs custom rendering
 */
function getSpecialObjectType(
    schema: SchemaProperty | null | undefined,
): "tool_configuration" | "messages" | null {
    if (!schema) return null

    const name = (schema.name as string | undefined) || (schema.title as string | undefined)
    if (name === "ToolConfiguration") return "tool_configuration"

    // Check for messages array (chat messages)
    if (schema.type === "array" && schema.items) {
        const itemSchema = schema.items as SchemaProperty
        if (itemSchema.properties?.role && itemSchema.properties?.content) {
            return "messages"
        }
    }

    return null
}

/**
 * Renders an object's properties inline using SchemaPropertyRenderer for each.
 *
 * Supports:
 * - llm_config objects (model, temperature, etc.)
 * - Nested objects with recursive rendering
 * - Collapsible headers
 *
 * @example
 * ```tsx
 * <ObjectSchemaControl
 *   schema={llmConfigSchema}
 *   label="LLM Configuration"
 *   value={llmConfig}
 *   onChange={(v) => dispatch({ type: 'setAtPath', path: ['llm_config'], value: v })}
 * />
 * ```
 */
export const ObjectSchemaControl = memo(function ObjectSchemaControl({
    schema,
    label,
    value,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    className,
    path = [],
    showHeader = true,
    onPropertyChange,
    SchemaPropertyRenderer,
}: ObjectSchemaControlProps) {
    // Get description from schema or prop
    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Check for special object types
    const specialType = useMemo(() => getSpecialObjectType(schema), [schema])

    // Get sorted property keys from schema
    const propertyKeys = useMemo(() => {
        if (!schema?.properties) return []

        const keys = Object.keys(schema.properties)

        // Sort: model first, then alphabetically
        return keys.sort((a, b) => {
            if (a.toLowerCase() === "model") return -1
            if (b.toLowerCase() === "model") return 1
            return a.localeCompare(b)
        })
    }, [schema?.properties])

    // Handle property change
    const handlePropertyChange = (propertyKey: string, newValue: unknown) => {
        if (onPropertyChange) {
            // Use path-based update if available
            onPropertyChange([...path, propertyKey], newValue)
        } else {
            // Fall back to updating entire object
            const newObject = {
                ...(value || {}),
                [propertyKey]: newValue,
            }
            onChange(newObject)
        }
    }

    // No schema or properties - show placeholder
    if (!schema?.properties || propertyKeys.length === 0) {
        return (
            <div className={clsx("flex flex-col gap-1", className)}>
                {showHeader && (
                    <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
                )}
                <Typography.Text type="secondary" className="text-xs">
                    No properties defined
                </Typography.Text>
            </div>
        )
    }

    // Special handling for tool configuration
    if (specialType === "tool_configuration") {
        return (
            <div className={clsx("flex flex-col gap-2", className)}>
                {showHeader && (
                    <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
                )}
                <div className="bg-gray-50 p-3 rounded-md border border-gray-200">
                    <Typography.Text type="secondary" className="text-xs">
                        Tool Configuration (JSON Editor)
                    </Typography.Text>
                    <pre className="text-xs mt-2 overflow-auto max-h-[200px]">
                        {JSON.stringify(value, null, 2)}
                    </pre>
                </div>
            </div>
        )
    }

    // No SchemaPropertyRenderer provided - show simple display
    if (!SchemaPropertyRenderer) {
        return (
            <div className={clsx("flex flex-col gap-2", className)}>
                {showHeader && (
                    <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
                )}
                <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto max-h-[200px]">
                    {JSON.stringify(value, null, 2)}
                </pre>
            </div>
        )
    }

    // Render object properties inline
    const content = (
        <div className="flex flex-col gap-3">
            {propertyKeys.map((propertyKey) => {
                const propertySchema = schema.properties![propertyKey]
                const propertyValue = value?.[propertyKey]
                const propertyLabel = formatLabel(propertyKey)

                return (
                    <SchemaPropertyRenderer
                        key={propertyKey}
                        schema={propertySchema}
                        label={propertyLabel}
                        value={propertyValue}
                        onChange={(newValue) => handlePropertyChange(propertyKey, newValue)}
                        disabled={disabled}
                        withTooltip={withTooltip}
                        path={[...path, propertyKey]}
                        className="pl-2 border-l-2 border-gray-100"
                    />
                )
            })}
        </div>
    )

    // With header
    if (showHeader) {
        const headerContent = (
            <div className="flex items-center gap-2 mb-2">
                <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
                <Typography.Text type="secondary" className="text-xs">
                    ({propertyKeys.length} properties)
                </Typography.Text>
            </div>
        )

        return (
            <div className={clsx("flex flex-col", className)}>
                {withTooltip && tooltipText ? (
                    <Tooltip title={tooltipText} placement="right">
                        {headerContent}
                    </Tooltip>
                ) : (
                    headerContent
                )}
                {content}
            </div>
        )
    }

    return <div className={className}>{content}</div>
})

/**
 * Collapsible variant of ObjectSchemaControl
 * Used when objects are displayed in a list and should be collapsible
 */
export const CollapsibleObjectControl = memo(function CollapsibleObjectControl({
    schema,
    label,
    value,
    onChange,
    description,
    withTooltip = true,
    disabled = false,
    className,
    path = [],
    defaultCollapsed = true,
    onPropertyChange,
    SchemaPropertyRenderer,
}: ObjectSchemaControlProps) {
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed)

    const tooltipText = description ?? (schema?.description as string | undefined) ?? ""

    // Get property count for display
    const propertyCount = schema?.properties ? Object.keys(schema.properties).length : 0

    return (
        <div className={clsx("flex flex-col gap-2", className)}>
            <Button
                type="text"
                className="flex items-center gap-2 px-0 h-auto"
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                <Tooltip
                    title={tooltipText}
                    placement="right"
                    open={withTooltip ? undefined : false}
                >
                    <Typography.Text className="text-sm font-medium">{label}</Typography.Text>
                </Tooltip>
                <Typography.Text type="secondary" className="text-xs">
                    ({propertyCount} properties)
                </Typography.Text>
            </Button>

            {!isCollapsed && (
                <ObjectSchemaControl
                    schema={schema}
                    label=""
                    value={value}
                    onChange={onChange}
                    disabled={disabled}
                    withTooltip={withTooltip}
                    path={path}
                    showHeader={false}
                    onPropertyChange={onPropertyChange}
                    SchemaPropertyRenderer={SchemaPropertyRenderer}
                />
            )}
        </div>
    )
})
