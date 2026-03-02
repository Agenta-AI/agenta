/**
 * EntityTable - Generic Entity Table Component
 *
 * A reusable table component for displaying entity lists with optional selection,
 * column grouping, and pagination. Uses an `EntityDataController` for data access
 * and `InfiniteVirtualTableFeatureShell` for rendering.
 *
 * Entity-specific table components (like `TestcaseTable`) should be thin wrappers
 * over this component, providing the appropriate data controller and configuration.
 *
 * @example
 * ```typescript
 * import { EntityTable } from '@agenta/entity-ui'
 * import { testcaseDataController, type TestcaseDataConfig } from '@agenta/entities/testcase'
 *
 * // View-only mode
 * <EntityTable
 *   controller={testcaseDataController}
 *   config={config}
 *   getRowData={(record) => record as Record<string, unknown>}
 * />
 *
 * // With selection
 * <EntityTable
 *   controller={testcaseDataController}
 *   config={config}
 *   getRowData={(record) => record as Record<string, unknown>}
 *   selectable
 *   onSelectionChange={(ids) => console.log('Selected:', ids)}
 * />
 * ```
 *
 * @module EntityTable
 */

import {useCallback, useEffect, useMemo, useState} from "react"

import type {
    EntityColumnDef,
    EntityDataConfigBase,
    EntityDataController,
    EntityRowBase,
} from "@agenta/entities/shared"
import {SmartCellContent} from "@agenta/ui/cell-renderers"
import {
    CollapsibleGroupHeader,
    TableEmptyState,
    TableLoadingState,
} from "@agenta/ui/components/presentational"
import {useSelectionState} from "@agenta/ui/hooks"
import {bgColors, cn} from "@agenta/ui/styles"
import {
    buildEntityColumns,
    InfiniteVirtualTableFeatureShell,
    type BuildEntityColumnsOptions,
    type RowHeightFeatureConfig,
    type TableScopeConfig,
} from "@agenta/ui/table"
import type {GroupColumnsOptions} from "@agenta/ui/utils"
import {Checkbox} from "antd"
import type {ColumnType, ColumnsType} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Props for the generic EntityTable component.
 *
 * @template TRow - Row data type (must have id and key)
 * @template TConfig - Data controller config type (must have scopeId)
 * @template TColumn - Column definition type
 */
export interface EntityTableProps<
    TRow extends EntityRowBase,
    TConfig extends EntityDataConfigBase,
    TColumn extends EntityColumnDef = EntityColumnDef,
> {
    /** Data controller for this entity type */
    controller: EntityDataController<TRow, TConfig, TColumn>
    /** Controller configuration (must be memoized by the consumer) */
    config: TConfig

    // Data resolution
    /**
     * Function to resolve full row data from a row record.
     *
     * Entity tables may store row data in molecules or other sources.
     * This function maps a table row record to the data used for cell rendering.
     *
     * @default (record) => record as Record<string, unknown>
     */
    getRowData?: (record: TRow) => Record<string, unknown> | null

    /**
     * Optional function to get a cell value directly.
     *
     * When provided, this function is called instead of using `getRowData` + path extraction.
     * This allows for fine-grained cell-level data access (e.g., from reactive atoms).
     *
     * @param record - The table row record
     * @param columnKey - The column key/path
     * @returns The cell value
     */
    getCellValue?: (record: TRow, columnKey: string) => unknown

    // Selection
    /** Enable row selection (default: false) */
    selectable?: boolean
    /** Externally controlled selection state */
    selectedIds?: string[]
    /** Callback when selection changes (only used when selectable=true) */
    onSelectionChange?: (ids: string[]) => void
    /** Whether to allow multiple selection (default: true) */
    multiSelect?: boolean
    /** Whether selection is disabled (grayed out but visible) */
    selectionDisabled?: boolean

    // Column customization
    /**
     * Enable collapsible column grouping.
     *
     * When true, uses the default grouping behavior with `CollapsibleGroupHeader`.
     * When a `GroupColumnsOptions` object, uses the provided custom grouping config.
     *
     * @default false
     */
    grouping?: boolean | GroupColumnsOptions<TRow, TColumn>
    /** Extra columns prepended to the column list */
    prependColumns?: ColumnsType<TRow>
    /** Extra columns appended to the column list */
    appendColumns?: ColumnsType<TRow>

    // Table features
    /** Row height config */
    rowHeightConfig?: RowHeightFeatureConfig
    /** Show settings dropdown (default: true) */
    showSettings?: boolean
    /** Jotai store for entity atom access (default: global store) */
    store?: ReturnType<typeof getDefaultStore>
    /** Page size for table scope (default: 100) */
    pageSize?: number
    /** Empty state message */
    emptyMessage?: string
    /** Number of skeleton rows in loading state */
    loadingRows?: number
    /** Enable auto height mode (default: true) */
    autoHeight?: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Width for selection checkbox column */
const SELECTION_COLUMN_WIDTH = 48
/** Width for collapsed group column */
const COLLAPSED_GROUP_WIDTH = 200
/** Label suffix for collapsed groups */
const COLLAPSED_LABEL = "collapsed"

/** Default row height configuration */
const DEFAULT_ROW_HEIGHT_CONFIG: RowHeightFeatureConfig = {
    storageKey: "agenta:entity-table:row-height",
    defaultSize: "medium",
}

// ============================================================================
// DEFAULT ROW DATA RESOLVER
// ============================================================================

const defaultGetRowData = <TRow,>(record: TRow): Record<string, unknown> | null =>
    record as Record<string, unknown>

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * Generic entity table with selection, grouping, and pagination support.
 *
 * Uses `EntityDataController` for unified data access and
 * `InfiniteVirtualTableFeatureShell` for rendering.
 *
 * @template TRow - Row data type
 * @template TConfig - Config type
 * @template TColumn - Column type
 */
export function EntityTable<
    TRow extends EntityRowBase,
    TConfig extends EntityDataConfigBase,
    TColumn extends EntityColumnDef = EntityColumnDef,
>({
    controller,
    config,
    getRowData = defaultGetRowData,
    getCellValue,
    selectable = false,
    selectedIds: externalSelectedIds,
    onSelectionChange,
    multiSelect = true,
    selectionDisabled = false,
    grouping = false,
    prependColumns,
    appendColumns,
    rowHeightConfig = DEFAULT_ROW_HEIGHT_CONFIG,
    showSettings = true,
    store,
    pageSize,
    emptyMessage = "No data found",
    loadingRows = 8,
    autoHeight = true,
}: EntityTableProps<TRow, TConfig, TColumn>) {
    // Determine if selection is externally controlled
    const isExternallyControlled = externalSelectedIds !== undefined
    // Collapsed groups state (only used when grouping is enabled)
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

    const toggleGroupCollapse = useCallback((groupPath: string) => {
        setCollapsedGroups((prev) => {
            const next = new Set(prev)
            if (next.has(groupPath)) {
                next.delete(groupPath)
            } else {
                next.add(groupPath)
            }
            return next
        })
    }, [])

    // Get the global Jotai store for entity atoms
    const globalStore = useMemo(() => store ?? getDefaultStore(), [store])

    // Use data controller selectors for data
    const rows = useAtomValue(controller.selectors.rows(config))
    const isLoading = useAtomValue(controller.selectors.isLoading(config))
    const columns = useAtomValue(controller.selectors.columns(config))
    const allRowIds = useAtomValue(controller.selectors.allRowIds(config))

    // Selection state - either external or from controller
    const internalSelectedIdsSet = useAtomValue(controller.selectors.selectedIds(config.scopeId))

    // Compute selection state using shared hook
    const {
        selectedSet: selectedIdsSet,
        isAllSelected,
        isSomeSelected,
    } = useSelectionState(
        allRowIds,
        isExternallyControlled ? externalSelectedIds : internalSelectedIdsSet,
    )
    const selectedIds = useMemo(() => [...selectedIdsSet], [selectedIdsSet])

    // Internal controller actions
    const setInternalSelection = useSetAtom(controller.actions.setSelection)
    const toggleInternalSelection = useSetAtom(controller.actions.toggleSelection)
    const selectAllInternal = useSetAtom(controller.actions.selectAll)
    const clearInternalSelection = useSetAtom(controller.actions.clearSelection)
    const resetSelection = useSetAtom(controller.actions.resetSelection)

    // Cleanup selection state on unmount to prevent memory leaks
    useEffect(() => {
        return () => {
            resetSelection(config.scopeId)
        }
    }, [config.scopeId, resetSelection])

    // Table scope configuration
    const resolvedPageSize =
        pageSize ?? ((config as Record<string, unknown>).pageSize as number) ?? 100
    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: config.scopeId,
            pageSize: resolvedPageSize,
            enableInfiniteScroll: false,
        }),
        [config.scopeId, resolvedPageSize],
    )

    // Build pagination object for IVT (no-op for now — paginated mode TBD)
    const pagination = useMemo(
        () => ({
            rows,
            loadNextPage: () => {},
            resetPages: () => {},
        }),
        [rows],
    )

    // Handle row selection toggle
    const handleRowSelect = useCallback(
        (rowId: string, checked: boolean) => {
            const newSelection = multiSelect
                ? checked
                    ? [...selectedIds, rowId]
                    : selectedIds.filter((id) => id !== rowId)
                : checked
                  ? [rowId]
                  : []

            if (isExternallyControlled) {
                onSelectionChange?.(newSelection)
            } else {
                if (multiSelect) {
                    toggleInternalSelection(config.scopeId, rowId, true)
                } else {
                    if (checked) {
                        setInternalSelection(config.scopeId, [rowId])
                    } else {
                        clearInternalSelection(config.scopeId)
                    }
                }
                onSelectionChange?.(newSelection)
            }
        },
        [
            config.scopeId,
            multiSelect,
            isExternallyControlled,
            toggleInternalSelection,
            setInternalSelection,
            clearInternalSelection,
            onSelectionChange,
            selectedIds,
        ],
    )

    // Handle select all toggle
    const handleSelectAll = useCallback(
        (checked: boolean) => {
            if (isExternallyControlled) {
                onSelectionChange?.(checked ? allRowIds : [])
            } else {
                if (checked) {
                    selectAllInternal(config.scopeId, allRowIds)
                } else {
                    clearInternalSelection(config.scopeId)
                }
                onSelectionChange?.(checked ? allRowIds : [])
            }
        },
        [
            config.scopeId,
            allRowIds,
            isExternallyControlled,
            selectAllInternal,
            clearInternalSelection,
            onSelectionChange,
        ],
    )

    // Build grouping options
    const groupingOptions = useMemo((): GroupColumnsOptions<TRow, TColumn> | undefined => {
        if (!grouping) return undefined

        if (typeof grouping === "object") return grouping

        // Default grouping behavior
        return {
            collapsedGroups,
            onGroupHeaderClick: toggleGroupCollapse,
            maxDepth: 1,
            renderGroupHeader: (groupPath, isCollapsed, childCount) => (
                <CollapsibleGroupHeader
                    label={groupPath}
                    isCollapsed={isCollapsed}
                    count={childCount}
                    onClick={() => toggleGroupCollapse(groupPath)}
                />
            ),
            createCollapsedColumnDef: (groupPath) => ({
                key: `__collapsed_${groupPath}`,
                title: (
                    <CollapsibleGroupHeader
                        label={groupPath}
                        isCollapsed={true}
                        count={COLLAPSED_LABEL}
                        onClick={() => toggleGroupCollapse(groupPath)}
                    />
                ),
                width: COLLAPSED_GROUP_WIDTH,
                render: (_, record) => {
                    const dataSource = getRowData(record)
                    if (!dataSource) return null
                    const value = (dataSource as Record<string, unknown>)[groupPath]
                    return <SmartCellContent value={value} />
                },
            }),
        } as GroupColumnsOptions<TRow, TColumn>
    }, [grouping, collapsedGroups, toggleGroupCollapse, getRowData])

    // Build table columns
    const tableColumns: ColumnsType<TRow> = useMemo(() => {
        // Selection column
        const selectionColumn: ColumnType<TRow> = {
            key: "__selection",
            title: multiSelect ? (
                <Checkbox
                    checked={isAllSelected}
                    indeterminate={isSomeSelected}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    disabled={selectionDisabled}
                />
            ) : null,
            width: SELECTION_COLUMN_WIDTH,
            fixed: "left",
            render: (_, record) => (
                <Checkbox
                    checked={selectedIdsSet.has(record.id)}
                    onChange={(e) => handleRowSelect(record.id, e.target.checked)}
                    disabled={selectionDisabled}
                    onClick={(e) => e.stopPropagation()}
                />
            ),
        }

        // Build entity columns using the helper
        const entityColumns = buildEntityColumns<TRow, TColumn>(columns, {
            getRowData,
            getCellValue,
            grouping: groupingOptions,
        } as BuildEntityColumnsOptions<TRow, TColumn>)

        // Assemble final columns
        const result: ColumnsType<TRow> = []
        if (selectable) result.push(selectionColumn)
        if (prependColumns) result.push(...prependColumns)
        result.push(...entityColumns)
        if (appendColumns) result.push(...appendColumns)
        return result
    }, [
        columns,
        selectable,
        multiSelect,
        isAllSelected,
        isSomeSelected,
        selectedIdsSet,
        selectionDisabled,
        groupingOptions,
        handleSelectAll,
        handleRowSelect,
        getRowData,
        getCellValue,
        prependColumns,
        appendColumns,
    ])

    // Loading state
    if (isLoading && rows.length === 0) {
        return <TableLoadingState rows={loadingRows} />
    }

    // Empty state
    if (!isLoading && rows.length === 0) {
        return <TableEmptyState message={emptyMessage} />
    }

    return (
        <div className="h-full">
            <InfiniteVirtualTableFeatureShell<TRow>
                columns={tableColumns}
                pagination={pagination}
                rowHeightConfig={rowHeightConfig}
                tableScope={tableScope}
                rowKey="id"
                autoHeight={autoHeight}
                useSettingsDropdown={showSettings}
                store={globalStore}
                tableProps={{
                    size: "small",
                    bordered: true,
                    onRow: selectable
                        ? (record) => ({
                              onClick: () =>
                                  handleRowSelect(record.id, !selectedIdsSet.has(record.id)),
                              className: cn(
                                  "cursor-pointer",
                                  selectedIdsSet.has(record.id) && bgColors.subtle,
                              ),
                          })
                        : undefined,
                }}
            />
        </div>
    )
}
