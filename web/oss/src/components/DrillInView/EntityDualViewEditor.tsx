import {memo, useCallback, useMemo, useState, type ReactNode} from "react"

import {ArrowCounterClockwise, Code, Trash, TreeStructure} from "@phosphor-icons/react"
import {Button, Segmented, Select, Tooltip} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import type {DataType} from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer/fieldUtils"
import type {EntityAPI, EntityDrillIn} from "@/oss/state/entities/shared"

import {type PropertyType} from "./DrillInControls"
import {EntityDrillInView} from "./EntityDrillInView"
import {JsonEditorWithLocalState} from "./JsonEditorWithLocalState"

type EditMode = "fields" | "json"

export interface EntityDualViewEditorProps<TEntity> {
    // Core entity props
    entityId: string
    entity: EntityAPI<TEntity, unknown> & {drillIn: EntityDrillIn<TEntity>}
    columns?: unknown // For testcase (column-based structure)

    // View mode control
    editMode?: EditMode // Controlled mode
    onEditModeChange?: (mode: EditMode) => void
    defaultEditMode?: EditMode // Uncontrolled default

    // Multi-item navigation (for DataPreviewEditor's span selector)
    items?: {key: string; label: string}[]
    selectedItemId?: string
    onItemChange?: (id: string) => void

    // Field mapping (for AddToTestset flow)
    columnOptions?: {value: string; label: string}[]
    onMapToColumn?: (path: string, column: string) => void
    onUnmap?: (path: string) => void
    mappedPaths?: Map<string, string>

    // Actions
    onRemove?: () => void
    showRemoveButton?: boolean
    onRevert?: () => void // Called after discard, for additional cleanup

    // DrillIn configuration
    editable?: boolean
    showAddControls?: boolean
    showDeleteControls?: boolean
    rootTitle?: string
    initialPath?: string | string[]
    focusPath?: string
    onFocusPathHandled?: () => void
    onPropertyClick?: (path: string) => void

    // Customization
    headerContent?: ReactNode
    showDirtyBadge?: boolean
    showRevertButton?: boolean
    showViewToggle?: boolean // Show the view mode toggle (default: true)
    className?: string

    // For testcase: locked field types
    lockedFieldTypes?: Record<string, DataType>
    onLockedFieldTypesChange?: (types: Record<string, DataType>) => void
    getDefaultValueForType?: (type: PropertyType) => unknown

    // Path persistence for navigation
    onPathChange?: (path: string[]) => void
}

function EntityDualViewEditorInner<TEntity>({
    entityId,
    entity,
    columns,
    editMode: controlledEditMode,
    onEditModeChange,
    defaultEditMode = "fields",
    items,
    selectedItemId,
    onItemChange,
    columnOptions,
    onMapToColumn,
    onUnmap,
    mappedPaths,
    onRemove,
    showRemoveButton = false,
    onRevert,
    editable = true,
    showAddControls = false,
    showDeleteControls = false,
    rootTitle = "Root",
    initialPath,
    focusPath,
    onFocusPathHandled,
    onPropertyClick,
    headerContent,
    showDirtyBadge = true,
    showRevertButton = true,
    showViewToggle = true,
    className,
    lockedFieldTypes,
    onLockedFieldTypesChange,
    getDefaultValueForType,
    onPathChange,
}: EntityDualViewEditorProps<TEntity>) {
    // Internal state for uncontrolled mode
    const [internalEditMode, setInternalEditMode] = useState<EditMode>(defaultEditMode)

    // Use controlled mode if provided, otherwise use internal state
    const editMode = controlledEditMode ?? internalEditMode
    const setEditMode = useCallback(
        (mode: EditMode) => {
            if (onEditModeChange) {
                onEditModeChange(mode)
            } else {
                setInternalEditMode(mode)
            }
        },
        [onEditModeChange],
    )

    // Get entity data and dirty state
    const entityData = useAtomValue(entity.selectors.data(entityId))
    const isDirty = useAtomValue(entity.selectors.isDirty(entityId))
    const dispatch = useSetAtom(entity.controller(entityId))

    // Handle revert
    const handleRevert = useCallback(() => {
        dispatch({type: "discard"})
        onRevert?.()
    }, [dispatch, onRevert])

    // Handle property click from JSON editor - switch to fields and navigate
    const handlePropertyClick = useCallback(
        (path: string) => {
            setEditMode("fields")
            onPropertyClick?.(path)
        },
        [setEditMode, onPropertyClick],
    )

    // Format data as JSON for the JSON editor
    const jsonValue = useMemo(() => {
        if (!entityData) return "{}"

        // For entities with columns, format just the column values
        if (columns && Array.isArray(columns)) {
            const values: Record<string, unknown> = {}
            ;(columns as {key: string}[]).forEach((col) => {
                const value = (entityData as Record<string, unknown>)[col.key]
                values[col.key] = value ?? ""
            })
            return JSON.stringify(values, null, 2)
        }

        // For other entities, get the root-level data using drillIn
        const rootData = entity.drillIn.getValueAtPath(entityData, [])
        return JSON.stringify(rootData, null, 2)
    }, [entityData, columns, entity.drillIn])

    // Handle JSON editor changes
    const handleJsonChange = useCallback(
        (value: string) => {
            try {
                const parsed = JSON.parse(value)
                dispatch({type: "update", changes: parsed})
            } catch {
                // Invalid JSON - ignore
            }
        },
        [dispatch],
    )

    // Build multi-item navigation prefix
    const itemNavigationPrefix = useMemo(() => {
        if (!items || items.length <= 1) return null

        const selectOptions = items.map((item) => ({
            value: item.key,
            label: item.label,
        }))

        return (
            <div className="flex items-center">
                <Select
                    size="small"
                    value={selectedItemId ?? entityId}
                    onChange={(value) => onItemChange?.(value)}
                    options={selectOptions}
                    popupMatchSelectWidth={false}
                />
                <span className="text-gray-300 mx-2 text-sm">/</span>
            </div>
        )
    }, [items, selectedItemId, entityId, onItemChange])

    return (
        <div className={`flex flex-col gap-2 ${className ?? ""}`}>
            {/* Header with toggle and actions */}
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                    {headerContent}
                    {showDirtyBadge && isDirty && (
                        <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-medium">
                            edited
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {showViewToggle && (
                        <Segmented
                            size="small"
                            value={editMode}
                            onChange={(value) => setEditMode(value as EditMode)}
                            options={[
                                {
                                    value: "fields",
                                    icon: <TreeStructure size={14} />,
                                },
                                {
                                    value: "json",
                                    icon: <Code size={14} />,
                                },
                            ]}
                        />
                    )}
                    {showRevertButton && isDirty && (
                        <Tooltip title="Revert changes">
                            <Button
                                size="small"
                                type="text"
                                icon={<ArrowCounterClockwise size={14} />}
                                onClick={handleRevert}
                            />
                        </Tooltip>
                    )}
                    {showRemoveButton && onRemove && (
                        <Button
                            size="small"
                            variant="text"
                            color="danger"
                            icon={<Trash size={14} />}
                            onClick={onRemove}
                        />
                    )}
                </div>
            </div>

            {/* Content */}
            {editMode === "fields" ? (
                <EntityDrillInView
                    entityId={entityId}
                    entity={entity}
                    columns={columns}
                    rootTitle={rootTitle}
                    breadcrumbPrefix={itemNavigationPrefix}
                    showBackArrow={!itemNavigationPrefix}
                    editable={editable}
                    showAddControls={showAddControls}
                    showDeleteControls={showDeleteControls}
                    columnOptions={columnOptions}
                    onMapToColumn={onMapToColumn}
                    onUnmap={onUnmap}
                    mappedPaths={mappedPaths}
                    initialPath={initialPath}
                    focusPath={focusPath}
                    onFocusPathHandled={onFocusPathHandled}
                    onPropertyClick={onPropertyClick}
                    lockedFieldTypes={lockedFieldTypes}
                    onLockedFieldTypesChange={onLockedFieldTypesChange}
                    getDefaultValueForType={getDefaultValueForType}
                    onPathChange={onPathChange}
                />
            ) : (
                <div
                    className={`px-4 ${isDirty ? "[&_.agenta-shared-editor]:border-blue-400" : ""}`}
                >
                    <JsonEditorWithLocalState
                        editorKey={`entity-${entityId}-json`}
                        initialValue={jsonValue}
                        onValidChange={handleJsonChange}
                        onPropertyClick={handlePropertyClick}
                    />
                </div>
            )}
        </div>
    )
}

export const EntityDualViewEditor = memo(
    EntityDualViewEditorInner,
) as typeof EntityDualViewEditorInner
