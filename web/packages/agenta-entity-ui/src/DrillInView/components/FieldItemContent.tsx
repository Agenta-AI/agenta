/**
 * FieldItemContent Component
 *
 * Renders the content section of a drill-in field item:
 * - Schema-aware inline rendering via SchemaPropertyRenderer (prompts, inline objects, messages)
 * - Drill-in link (for expandable fields without inline rendering)
 * - Value display/editor (for leaf fields)
 */

import {useCallback, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities"
import type {PathItem} from "@agenta/shared/utils"
import {formatLabel} from "@agenta/ui/drill-in"

import {isMessagesSchema} from "../SchemaControls/MessagesSchemaControl"
import {isPromptSchema, isPromptValue} from "../SchemaControls/PromptSchemaControl"
import {SchemaPropertyRenderer} from "../SchemaControls/SchemaPropertyRenderer"
import {shouldRenderObjectInline} from "../SchemaControls/schemaUtils"

// ============================================================================
// TYPES
// ============================================================================

export interface FieldItemContentProps {
    /**
     * Field item being rendered
     */
    item: PathItem

    /**
     * Full path to this field (for SchemaPropertyRenderer)
     */
    path?: string[]

    /**
     * Whether the field is expandable (has children)
     */
    isExpandable: boolean

    /**
     * Child count (for expandable fields)
     */
    childCount?: number

    /**
     * Whether the field can be drilled into
     */
    canDrillIn: boolean

    /**
     * Whether the field is editable
     */
    isEditable: boolean

    /**
     * Handler for drilling into the field
     */
    onDrillIn: () => void

    /**
     * Handler for value changes
     */
    onChange: (value: unknown) => void

    /**
     * Optional JSON schema for schema-aware rendering.
     * When provided, SchemaPropertyRenderer uses it for rich controls.
     * When null/undefined, SchemaPropertyRenderer falls back to value-based detection.
     */
    schema?: SchemaProperty | null

    /**
     * Original server value for preserving custom descriptions.
     * Passed to FeedbackConfigurationControl via SchemaPropertyRenderer.
     */
    originalValue?: unknown

    /**
     * Entity ID for scoping modal state per variant (e.g., response format modal)
     */
    entityId?: string

    /**
     * CSS class names
     */
    classNames: {
        fieldContent?: string
        valueRenderer?: string
    }

    /**
     * CSS styles
     */
    styles?: {
        fieldContent?: React.CSSProperties
        valueRenderer?: React.CSSProperties
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function FieldItemContent({
    item,
    path,
    isExpandable,
    childCount,
    isEditable,
    onDrillIn,
    onChange,
    schema,
    originalValue,
    entityId,
    classNames,
    styles,
}: FieldItemContentProps) {
    const label = useMemo(
        () => (schema?.title as string) ?? formatLabel(item.key),
        [schema, item.key],
    )

    const handleChange = useCallback(
        (value: unknown) => {
            onChange(value)
        },
        [onChange],
    )

    // Check if an expandable value should be rendered inline via SchemaPropertyRenderer
    // (prompt objects, inline objects, messages arrays, feedback_config)
    const shouldRenderInline = useMemo(() => {
        if (!isExpandable) return false
        // Schema-based detection
        if (schema) {
            const xParam = schema["x-parameter"] as string | undefined
            if (isPromptSchema(schema)) return true
            if (isMessagesSchema(schema)) return true
            if (shouldRenderObjectInline(schema)) return true
            // Check for feedback_config x-parameter
            if (xParam === "feedback_config") return true
            // Check for fields_tags_editor x-parameter
            if (xParam === "fields_tags_editor") return true
        }
        // Value-based detection (no schema)
        if (isPromptValue(item.value)) return true
        return false
    }, [isExpandable, schema, item.value])

    // For expandable fields that should NOT render inline → show drill-in button
    if (isExpandable && !shouldRenderInline) {
        return (
            <div className={classNames.fieldContent} style={styles?.fieldContent}>
                <button
                    type="button"
                    onClick={onDrillIn}
                    className="text-blue-600 hover:underline border-0 bg-transparent cursor-pointer"
                >
                    View {childCount} {childCount === 1 ? "item" : "items"} →
                </button>
            </div>
        )
    }

    // For leaf fields or inline-renderable expandable fields → use SchemaPropertyRenderer
    return (
        <div className={classNames.fieldContent} style={styles?.fieldContent}>
            <div className={classNames.valueRenderer} style={styles?.valueRenderer}>
                <SchemaPropertyRenderer
                    schema={schema}
                    label={label}
                    value={item.value}
                    onChange={handleChange}
                    disabled={!isEditable}
                    path={path}
                    originalValue={originalValue}
                    entityId={entityId}
                />
            </div>
        </div>
    )
}

export default FieldItemContent
