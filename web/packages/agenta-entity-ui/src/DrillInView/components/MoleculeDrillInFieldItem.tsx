/**
 * MoleculeDrillInFieldItem Component
 *
 * Renders a single field in the drill-in view.
 * Supports header, content, and actions slots for customization.
 */

import {useCallback, useMemo} from "react"

import {type PathItem, type DataPath, isExpandable, getChildCount} from "@agenta/shared"
import {ChevronRight, ChevronDown, Copy, Trash2, Plus} from "lucide-react"

import type {FieldHeaderSlotProps, FieldContentSlotProps, FieldActionsSlotProps} from "../types"
import {buildClassName} from "../utils/classNames"

import {useDrillIn} from "./MoleculeDrillInContext"

// ============================================================================
// TYPES
// ============================================================================

interface MoleculeDrillInFieldItemProps {
    item: PathItem
}

// ============================================================================
// COMPONENT
// ============================================================================

export function MoleculeDrillInFieldItem({item}: MoleculeDrillInFieldItemProps) {
    const {
        entity,
        currentPath,
        navigateInto,
        updateValue,
        deleteValue,
        addValue,
        behaviors,
        classNames,
        styles,
        slots,
        isCollapsed,
        toggleCollapse,
        isDirty,
    } = useDrillIn()

    // Full path to this field
    const fullPath: DataPath = useMemo(() => [...currentPath, item.key], [currentPath, item.key])

    // Field state
    const fieldKey = fullPath.join(".")
    const collapsed = isCollapsed(fieldKey)
    const expandable = isExpandable(item.value)
    const childCount = expandable ? getChildCount(item.value) : undefined
    const canDrillIn = expandable

    // ========== HANDLERS ==========

    const handleToggleCollapse = useCallback(() => {
        toggleCollapse(fieldKey)
    }, [fieldKey, toggleCollapse])

    const handleDrillIn = useCallback(() => {
        if (canDrillIn) {
            navigateInto(item.key)
        }
    }, [canDrillIn, item.key, navigateInto])

    const handleCopy = useCallback(() => {
        const text =
            typeof item.value === "string" ? item.value : JSON.stringify(item.value, null, 2)
        navigator.clipboard.writeText(text)
    }, [item.value])

    const handleDelete = useCallback(() => {
        deleteValue(fullPath)
    }, [deleteValue, fullPath])

    const handleAdd = useCallback(() => {
        // Determine default value based on content
        if (Array.isArray(item.value)) {
            addValue(fullPath, item.value.length, "")
        } else if (typeof item.value === "object" && item.value !== null) {
            addValue(fullPath, "newField", "")
        }
    }, [addValue, fullPath, item.value])

    const handleChange = useCallback(
        (value: unknown) => {
            updateValue(fullPath, value)
        },
        [fullPath, updateValue],
    )

    // ========== CLASS NAMES ==========

    const fieldItemClassName = useMemo(() => {
        return buildClassName("fieldItem", {
            collapsed,
            expanded: expandable && !collapsed,
            editable: behaviors.editable,
            dirty: isDirty,
        })
    }, [collapsed, expandable, behaviors.editable, isDirty])

    // ========== DEFAULT RENDERS ==========

    const defaultRenderHeader = useCallback(() => {
        return (
            <div className={classNames.fieldHeader} style={styles?.fieldHeader}>
                {/* Collapse toggle */}
                {behaviors.collapsible && expandable && (
                    <button
                        type="button"
                        onClick={handleToggleCollapse}
                        className="mr-1 p-0.5 hover:bg-gray-100 rounded"
                        aria-label={collapsed ? "Expand" : "Collapse"}
                    >
                        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                )}

                {/* Title */}
                <span
                    className={classNames.fieldHeaderTitle}
                    style={styles?.fieldHeaderTitle}
                    onClick={canDrillIn ? handleDrillIn : undefined}
                    role={canDrillIn ? "button" : undefined}
                    tabIndex={canDrillIn ? 0 : undefined}
                >
                    {item.name}
                </span>

                {/* Meta (item count) */}
                {childCount !== undefined && (
                    <span className={classNames.fieldHeaderMeta} style={styles?.fieldHeaderMeta}>
                        ({childCount} {childCount === 1 ? "item" : "items"})
                    </span>
                )}
            </div>
        )
    }, [
        classNames,
        styles,
        behaviors.collapsible,
        expandable,
        collapsed,
        canDrillIn,
        item.name,
        childCount,
        handleToggleCollapse,
        handleDrillIn,
    ])

    const defaultRenderActions = useCallback(() => {
        return (
            <div className={classNames.fieldHeaderActions} style={styles?.fieldHeaderActions}>
                {/* Copy button */}
                {behaviors.copyable && (
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
                {behaviors.deletable && (
                    <button
                        type="button"
                        onClick={handleDelete}
                        className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-red-600"
                        aria-label="Delete field"
                    >
                        <Trash2 size={14} />
                    </button>
                )}

                {/* Add button (for arrays/objects) */}
                {behaviors.addable && expandable && (
                    <button
                        type="button"
                        onClick={handleAdd}
                        className="p-1 hover:bg-gray-100 rounded text-gray-500 hover:text-green-600"
                        aria-label="Add item"
                    >
                        <Plus size={14} />
                    </button>
                )}
            </div>
        )
    }, [
        classNames,
        styles,
        behaviors.copyable,
        behaviors.deletable,
        behaviors.addable,
        expandable,
        handleCopy,
        handleDelete,
        handleAdd,
    ])

    const defaultRenderContent = useCallback(() => {
        // Simple value display
        const displayValue =
            typeof item.value === "string" ? item.value : JSON.stringify(item.value, null, 2)

        return (
            <div className={classNames.fieldContent} style={styles?.fieldContent}>
                {expandable ? (
                    <button
                        type="button"
                        onClick={handleDrillIn}
                        className="text-blue-600 hover:underline"
                    >
                        View {childCount} {childCount === 1 ? "item" : "items"} →
                    </button>
                ) : (
                    <div className={classNames.valueRenderer} style={styles?.valueRenderer}>
                        {behaviors.editable ? (
                            <textarea
                                value={displayValue}
                                onChange={(e) => handleChange(e.target.value)}
                                className="w-full p-2 border rounded font-mono"
                                rows={Math.min(displayValue.split("\n").length, 10)}
                            />
                        ) : (
                            <pre className="text-gray-700 whitespace-pre-wrap break-words">
                                {displayValue}
                            </pre>
                        )}
                    </div>
                )}
            </div>
        )
    }, [
        classNames,
        styles,
        item.value,
        expandable,
        childCount,
        behaviors.editable,
        handleDrillIn,
        handleChange,
    ])

    // ========== SLOT PROPS ==========

    const headerSlotProps: FieldHeaderSlotProps = useMemo(
        () => ({
            field: item,
            path: fullPath,
            entity,
            isCollapsed: collapsed,
            onToggleCollapse: handleToggleCollapse,
            canCollapse: behaviors.collapsible && expandable,
            isDirty,
            childCount,
            defaultRender: defaultRenderHeader,
        }),
        [
            item,
            fullPath,
            entity,
            collapsed,
            handleToggleCollapse,
            behaviors.collapsible,
            expandable,
            isDirty,
            childCount,
            defaultRenderHeader,
        ],
    )

    const contentSlotProps: FieldContentSlotProps = useMemo(
        () => ({
            field: item,
            path: fullPath,
            entity,
            editable: behaviors.editable,
            onChange: handleChange,
            onDrillIn: handleDrillIn,
            canDrillIn,
            defaultRender: defaultRenderContent,
        }),
        [
            item,
            fullPath,
            entity,
            behaviors.editable,
            handleChange,
            handleDrillIn,
            canDrillIn,
            defaultRenderContent,
        ],
    )

    const actionsSlotProps: FieldActionsSlotProps = useMemo(
        () => ({
            field: item,
            path: fullPath,
            entity,
            actions: {
                canCopy: behaviors.copyable,
                canDelete: behaviors.deletable,
                canAdd: behaviors.addable && expandable,
                onCopy: handleCopy,
                onDelete: handleDelete,
                onAdd: handleAdd,
            },
            defaultRender: defaultRenderActions,
        }),
        [
            item,
            fullPath,
            entity,
            behaviors.copyable,
            behaviors.deletable,
            behaviors.addable,
            expandable,
            handleCopy,
            handleDelete,
            handleAdd,
            defaultRenderActions,
        ],
    )

    // ========== RENDER ==========

    return (
        <div className={fieldItemClassName} style={styles?.fieldItem}>
            {/* Header row */}
            <div className="flex items-center justify-between">
                {/* Header slot */}
                {slots?.fieldHeader ? slots.fieldHeader(headerSlotProps) : defaultRenderHeader()}

                {/* Actions slot */}
                {slots?.fieldActions
                    ? slots.fieldActions(actionsSlotProps)
                    : defaultRenderActions()}
            </div>

            {/* Content - only shown when not collapsed */}
            {(!behaviors.collapsible || !collapsed) && (
                <>
                    {slots?.fieldContent
                        ? slots.fieldContent(contentSlotProps)
                        : defaultRenderContent()}
                </>
            )}
        </div>
    )
}
