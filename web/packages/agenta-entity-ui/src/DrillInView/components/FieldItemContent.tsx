/**
 * FieldItemContent Component
 *
 * Renders the content section of a drill-in field item.
 * All fields render inline via SchemaPropertyRenderer — no drill-in navigation.
 */

import {useCallback, useMemo} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import type {PathItem} from "@agenta/shared/utils"
import {formatLabel} from "@agenta/ui/drill-in"

import {SchemaPropertyRenderer} from "../SchemaControls/SchemaPropertyRenderer"

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
    isExpandable: _isExpandable,
    childCount: _childCount,
    isEditable,
    onDrillIn: _onDrillIn,
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

    // All fields render inline via SchemaPropertyRenderer — no drill-in navigation.
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
