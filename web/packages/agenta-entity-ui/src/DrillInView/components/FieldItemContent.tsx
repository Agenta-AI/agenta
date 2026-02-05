/**
 * FieldItemContent Component
 *
 * Renders the content section of a drill-in field item:
 * - Drill-in link (for expandable fields)
 * - Value display or editor (for leaf fields)
 */

import {useCallback, useMemo} from "react"

import type {PathItem} from "@agenta/shared/utils"

// ============================================================================
// TYPES
// ============================================================================

export interface FieldItemContentProps {
    /**
     * Field item being rendered
     */
    item: PathItem

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
    isExpandable,
    childCount,
    canDrillIn,
    isEditable,
    onDrillIn,
    onChange,
    classNames,
    styles,
}: FieldItemContentProps) {
    // Simple value display
    const displayValue = useMemo(() => {
        return typeof item.value === "string" ? item.value : JSON.stringify(item.value, null, 2)
    }, [item.value])

    const handleChange = useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            onChange(e.target.value)
        },
        [onChange],
    )

    const rowCount = useMemo(() => {
        return Math.min(displayValue.split("\n").length, 10)
    }, [displayValue])

    if (isExpandable) {
        return (
            <div className={classNames.fieldContent} style={styles?.fieldContent}>
                <button type="button" onClick={onDrillIn} className="text-blue-600 hover:underline">
                    View {childCount} {childCount === 1 ? "item" : "items"} →
                </button>
            </div>
        )
    }

    return (
        <div className={classNames.fieldContent} style={styles?.fieldContent}>
            <div className={classNames.valueRenderer} style={styles?.valueRenderer}>
                {isEditable ? (
                    <textarea
                        value={displayValue}
                        onChange={handleChange}
                        className="w-full p-2 border rounded font-mono"
                        rows={rowCount}
                    />
                ) : (
                    <pre className="text-gray-700 whitespace-pre-wrap break-words">
                        {displayValue}
                    </pre>
                )}
            </div>
        </div>
    )
}

export default FieldItemContent
