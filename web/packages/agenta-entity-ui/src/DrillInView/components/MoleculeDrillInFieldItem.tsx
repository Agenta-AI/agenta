/**
 * MoleculeDrillInFieldItem Component
 *
 * Renders a single field in the drill-in view.
 * Supports header, content, and actions slots for customization.
 *
 * Architecture:
 * - Delegates to FieldItemHeader, FieldItemActions, FieldItemContent subcomponents
 * - Uses copyToClipboard from @agenta/ui for clipboard operations
 * - Provides slot system for customization
 */

import {useCallback, useMemo} from "react"

import {type PathItem, type DataPath, isExpandable, getChildCount} from "@agenta/shared/utils"
import {copyToClipboard} from "@agenta/ui/utils"

import type {FieldHeaderSlotProps, FieldContentSlotProps, FieldActionsSlotProps} from "../types"
import {buildClassName} from "../utils/classNames"

import {FieldItemActions} from "./FieldItemActions"
import {FieldItemContent} from "./FieldItemContent"
import {FieldItemHeader} from "./FieldItemHeader"
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

    const handleCopy = useCallback(async () => {
        const text =
            typeof item.value === "string" ? item.value : JSON.stringify(item.value, null, 2)
        await copyToClipboard(text)
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
            <FieldItemHeader
                item={item}
                fullPath={fullPath}
                isCollapsed={collapsed}
                canCollapse={behaviors.collapsible}
                isExpandable={expandable}
                childCount={childCount}
                canDrillIn={canDrillIn}
                onToggleCollapse={handleToggleCollapse}
                onDrillIn={handleDrillIn}
                classNames={{
                    fieldHeader: classNames.fieldHeader,
                    fieldHeaderTitle: classNames.fieldHeaderTitle,
                    fieldHeaderMeta: classNames.fieldHeaderMeta,
                }}
                styles={{
                    fieldHeader: styles?.fieldHeader,
                    fieldHeaderTitle: styles?.fieldHeaderTitle,
                    fieldHeaderMeta: styles?.fieldHeaderMeta,
                }}
            />
        )
    }, [
        item,
        fullPath,
        collapsed,
        behaviors.collapsible,
        expandable,
        childCount,
        canDrillIn,
        handleToggleCollapse,
        handleDrillIn,
        classNames,
        styles,
    ])

    const defaultRenderActions = useCallback(() => {
        return (
            <FieldItemActions
                value={item.value}
                isExpandable={expandable}
                canCopy={behaviors.copyable}
                canDelete={behaviors.deletable}
                canAdd={behaviors.addable}
                onCopy={handleCopy}
                onDelete={handleDelete}
                onAdd={handleAdd}
                classNames={{
                    fieldHeaderActions: classNames.fieldHeaderActions,
                }}
                styles={{
                    fieldHeaderActions: styles?.fieldHeaderActions,
                }}
            />
        )
    }, [
        item.value,
        expandable,
        behaviors.copyable,
        behaviors.deletable,
        behaviors.addable,
        handleCopy,
        handleDelete,
        handleAdd,
        classNames,
        styles,
    ])

    const defaultRenderContent = useCallback(() => {
        return (
            <FieldItemContent
                item={item}
                isExpandable={expandable}
                childCount={childCount}
                canDrillIn={canDrillIn}
                isEditable={behaviors.editable}
                onDrillIn={handleDrillIn}
                onChange={handleChange}
                classNames={{
                    fieldContent: classNames.fieldContent,
                    valueRenderer: classNames.valueRenderer,
                }}
                styles={{
                    fieldContent: styles?.fieldContent,
                    valueRenderer: styles?.valueRenderer,
                }}
            />
        )
    }, [
        item,
        expandable,
        childCount,
        canDrillIn,
        behaviors.editable,
        handleDrillIn,
        handleChange,
        classNames,
        styles,
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
