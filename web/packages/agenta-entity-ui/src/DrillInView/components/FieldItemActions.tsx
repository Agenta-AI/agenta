/**
 * FieldItemActions Component
 *
 * Renders the action buttons for a drill-in field item:
 * - Copy button
 * - Delete button
 * - Add button (for arrays/objects)
 */

import {useCallback} from "react"

import {copyToClipboard} from "@agenta/ui/utils"
import {Copy, Trash2, Plus} from "lucide-react"

// ============================================================================
// TYPES
// ============================================================================

export interface FieldItemActionsProps {
    /**
     * Field value to copy
     */
    value: unknown

    /**
     * Whether the field is expandable (can add items)
     */
    isExpandable: boolean

    /**
     * Whether copy is enabled
     */
    canCopy: boolean

    /**
     * Whether delete is enabled
     */
    canDelete: boolean

    /**
     * Whether add is enabled
     */
    canAdd: boolean

    /**
     * Handler for copy action
     */
    onCopy?: () => void

    /**
     * Handler for delete action
     */
    onDelete: () => void

    /**
     * Handler for add action
     */
    onAdd: () => void

    /**
     * CSS class names
     */
    classNames: {
        fieldHeaderActions?: string
    }

    /**
     * CSS styles
     */
    styles?: {
        fieldHeaderActions?: React.CSSProperties
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function FieldItemActions({
    value,
    isExpandable,
    canCopy,
    canDelete,
    canAdd,
    onCopy,
    onDelete,
    onAdd,
    classNames,
    styles,
}: FieldItemActionsProps) {
    const handleCopy = useCallback(async () => {
        if (onCopy) {
            onCopy()
            return
        }

        const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
        await copyToClipboard(text)
    }, [value, onCopy])

    return (
        <div className={classNames.fieldHeaderActions} style={styles?.fieldHeaderActions}>
            {/* Copy button */}
            {canCopy && (
                <button
                    type="button"
                    onClick={handleCopy}
                    className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700"
                    aria-label="Copy value"
                >
                    <Copy size={14} />
                </button>
            )}

            {/* Delete button */}
            {canDelete && (
                <button
                    type="button"
                    onClick={onDelete}
                    className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-red-600"
                    aria-label="Delete field"
                >
                    <Trash2 size={14} />
                </button>
            )}

            {/* Add button (for arrays/objects) */}
            {canAdd && isExpandable && (
                <button
                    type="button"
                    onClick={onAdd}
                    className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-green-600"
                    aria-label="Add item"
                >
                    <Plus size={14} />
                </button>
            )}
        </div>
    )
}

export default FieldItemActions
