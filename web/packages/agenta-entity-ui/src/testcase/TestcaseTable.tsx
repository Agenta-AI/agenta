/**
 * TestcaseTable Component
 *
 * A reusable table component for displaying testcases with optional selection support.
 * Uses testcaseDataController for unified data access and InfiniteVirtualTableFeatureShell for rendering.
 *
 * @example
 * ```typescript
 * // View-only mode (no selection)
 * import { TestcaseTable } from '@agenta/entity-ui'
 *
 * <TestcaseTable
 *   config={{ scopeId: 'my-table', revisionId: 'rev-123' }}
 * />
 *
 * // With selection
 * <TestcaseTable
 *   config={{ scopeId: 'my-table', revisionId: 'rev-123' }}
 *   selectable
 *   onSelectionChange={(ids) => console.log('Selected:', ids)}
 * />
 * ```
 */

import {useCallback, useEffect, useMemo, useState} from "react"

import {
    testcaseDataController,
    testcaseMolecule,
    type Column,
    type TestcaseDataConfig,
    type TestcaseTableRow,
} from "@agenta/entities/testcase"
import {getValueAtStringPath} from "@agenta/shared"
import {
    bgColors,
    cn,
    CollapsibleGroupHeader,
    groupColumns,
    InfiniteVirtualTableFeatureShell,
    SmartCellContent,
    TableEmptyState,
    TableLoadingState,
    useSelectionState,
    type GroupColumnsOptions,
    type RowHeightFeatureConfig,
    type TableScopeConfig,
} from "@agenta/ui"
import {Checkbox} from "antd"
import type {ColumnType, ColumnsType} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

// ============================================================================
// TYPES
// ============================================================================

export interface TestcaseTableProps {
    /** Data source configuration */
    config: TestcaseDataConfig
    /** Enable row selection (default: false) */
    selectable?: boolean
    /**
     * Externally controlled selection state.
     * When provided, selection is controlled externally instead of via testcaseDataController.
     */
    selectedIds?: string[]
    /** Callback when selection changes (only used when selectable=true) */
    onSelectionChange?: (ids: string[]) => void
    /** Whether to allow multiple selection (default: true, only used when selectable=true) */
    multiSelect?: boolean
    /** Whether selection is disabled (grayed out but visible, only used when selectable=true) */
    selectionDisabled?: boolean
    /** Custom row height config */
    rowHeightConfig?: RowHeightFeatureConfig
    /** Whether to show settings dropdown */
    showSettings?: boolean
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Width for selection checkbox column */
const SELECTION_COLUMN_WIDTH = 48
/** Width for collapsed group column */
const COLLAPSED_GROUP_WIDTH = 200
/** Default width for data columns */
const DEFAULT_COLUMN_WIDTH = 150
/** Label suffix for collapsed groups */
const COLLAPSED_LABEL = "collapsed"

// Default row height configuration
const DEFAULT_ROW_HEIGHT_CONFIG: RowHeightFeatureConfig = {
    storageKey: "agenta:testcase-table:row-height",
    defaultSize: "medium",
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function TestcaseTable({
    config,
    selectable = false,
    selectedIds: externalSelectedIds,
    onSelectionChange,
    multiSelect = true,
    selectionDisabled = false,
    rowHeightConfig = DEFAULT_ROW_HEIGHT_CONFIG,
    showSettings = true,
}: TestcaseTableProps) {
    // Determine if selection is externally controlled
    const isExternallyControlled = externalSelectedIds !== undefined
    // Collapsed groups state
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

    // Toggle collapse state for a group
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
    const globalStore = useMemo(() => getDefaultStore(), [])

    // Use data controller selectors for data
    const rows = useAtomValue(testcaseDataController.selectors.rows(config))
    const isLoading = useAtomValue(testcaseDataController.selectors.isLoading(config))
    const columns = useAtomValue(testcaseDataController.selectors.columns(config))
    const allRowIds = useAtomValue(testcaseDataController.selectors.allRowIds(config))

    // Selection state - either external or from controller
    const internalSelectedIdsSet = useAtomValue(
        testcaseDataController.selectors.selectedIds(config.scopeId),
    )

    // Use external selection if provided, otherwise use internal
    // Compute selection state using shared hook
    // Note: We use the hook instead of controller selectors because the component
    // supports both external control (selectedIds prop) and internal control.
    // When externally controlled, controller selectors would read stale internal state.
    const {
        selectedSet: selectedIdsSet,
        isAllSelected,
        isSomeSelected,
    } = useSelectionState(
        allRowIds,
        isExternallyControlled ? externalSelectedIds : internalSelectedIdsSet,
    )
    const selectedIds = useMemo(() => [...selectedIdsSet], [selectedIdsSet])

    // Internal controller actions (only used when not externally controlled)
    const setInternalSelection = useSetAtom(testcaseDataController.actions.setSelection)
    const toggleInternalSelection = useSetAtom(testcaseDataController.actions.toggleSelection)
    const selectAllInternal = useSetAtom(testcaseDataController.actions.selectAll)
    const clearInternalSelection = useSetAtom(testcaseDataController.actions.clearSelection)
    const resetSelection = useSetAtom(testcaseDataController.actions.resetSelection)

    // Cleanup selection state on unmount to prevent memory leaks
    useEffect(() => {
        return () => {
            resetSelection(config.scopeId)
        }
    }, [config.scopeId, resetSelection])

    // Table scope configuration
    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: config.scopeId,
            pageSize: config.pageSize ?? 100,
            enableInfiniteScroll: false,
        }),
        [config.scopeId, config.pageSize],
    )

    // Build pagination object for IVT
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
                // External mode - just call the callback
                onSelectionChange?.(newSelection)
            } else {
                // Internal mode - update controller state
                if (multiSelect) {
                    toggleInternalSelection(config.scopeId, rowId, true)
                } else {
                    if (checked) {
                        setInternalSelection(config.scopeId, [rowId])
                    } else {
                        clearInternalSelection(config.scopeId)
                    }
                }
                // Also notify parent if callback provided
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
                // External mode - just call the callback
                onSelectionChange?.(checked ? allRowIds : [])
            } else {
                // Internal mode - update controller state
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

    // Helper to get data source for a record
    const getDataSource = useCallback(
        (record: TestcaseTableRow): Record<string, unknown> | null => {
            if (record.__isNew || record.__isSkeleton) {
                return testcaseMolecule.get.data(record.id) as Record<string, unknown> | null
            }
            return record as Record<string, unknown>
        },
        [],
    )

    // Build grouped columns structure using groupColumns utility
    const tableColumns: ColumnsType<TestcaseTableRow> = useMemo(() => {
        // Selection column
        const selectionColumn: ColumnType<TestcaseTableRow> = {
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

        // Group options for column grouping
        const groupOptions: GroupColumnsOptions<TestcaseTableRow> = {
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
                    const dataSource = getDataSource(record)
                    if (!dataSource) return null
                    const value = getValueAtStringPath(dataSource, groupPath)
                    return <SmartCellContent value={value} />
                },
            }),
        }

        // Create column definition for each column
        const createColumnDef = (
            col: Column,
            displayName: string,
        ): ColumnType<TestcaseTableRow> => ({
            key: col.key,
            title: displayName,
            width: DEFAULT_COLUMN_WIDTH,
            ellipsis: true,
            render: (_, record) => {
                const dataSource = getDataSource(record)
                if (!dataSource) return null
                const value = getValueAtStringPath(dataSource, col.key)
                return <SmartCellContent value={value} />
            },
        })

        // Group columns using the utility
        const groupedColumns = groupColumns<TestcaseTableRow>(
            columns,
            createColumnDef,
            groupOptions,
        )

        // Only include selection column when selectable
        return selectable ? [selectionColumn, ...groupedColumns] : groupedColumns
    }, [
        columns,
        selectable,
        multiSelect,
        isAllSelected,
        isSomeSelected,
        selectedIdsSet,
        selectionDisabled,
        collapsedGroups,
        toggleGroupCollapse,
        handleSelectAll,
        handleRowSelect,
        getDataSource,
    ])

    // Loading state
    if (isLoading && rows.length === 0) {
        return <TableLoadingState rows={8} />
    }

    // Empty state
    if (!isLoading && rows.length === 0) {
        return <TableEmptyState message="No testcases found" />
    }

    return (
        <div className="h-full">
            <InfiniteVirtualTableFeatureShell<TestcaseTableRow>
                columns={tableColumns}
                pagination={pagination}
                rowHeightConfig={rowHeightConfig}
                tableScope={tableScope}
                rowKey="id"
                autoHeight
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
