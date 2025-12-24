import {useCallback, useMemo, useState} from "react"

import {CaretDown, CaretRight} from "@phosphor-icons/react"
import {PencilSimple, Trash} from "@phosphor-icons/react"
import {Input, Skeleton, Typography} from "antd"
import type {ColumnType, ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {getDefaultStore} from "jotai/vanilla"

import {
    ColumnVisibilityHeader,
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type TableScopeConfig,
} from "@/oss/components/InfiniteVirtualTable"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import {testcaseIsDirtyAtom} from "@/oss/state/entities/testcase/dirtyState"

import {message} from "../../AppMessageContext"
import {testcasesDatasetStore, type TestcaseTableRow} from "../atoms/tableStore"
import type {UseTestcasesTableResult} from "../hooks/types"
import {groupColumns} from "../utils/groupColumns"

import EditableColumnHeader from "./EditableColumnHeader"
import {TestcaseCell} from "./TestcaseCell"
import TestcaseCellContent from "./TestcaseCellContent"
import TestcaseSelectionCell from "./TestcaseSelectionCell"

/**
 * Props for TestcasesTableShell component
 */
export interface TestcasesTableShellProps {
    mode: "edit" | "view"
    revisionIdParam: string | undefined
    table: UseTestcasesTableResult
    rowHeight: {
        size: "small" | "medium" | "large"
        heightPx: number
        maxLines: number
    }
    selectedRowKeys: React.Key[]
    onSelectedRowKeysChange: (keys: React.Key[]) => void
    onRowClick: (record: TestcaseTableRow) => void
    onDeleteSelected: () => void
    searchTerm: string
    onSearchChange: (term: string) => void
    header: React.ReactNode
    actions: React.ReactNode
    hideControls?: boolean
    enableSelection?: boolean
    autoHeight?: boolean
    disableDeleteAction?: boolean
    /** Show row index instead of checkboxes (still shows dirty indicator) */
    showRowIndex?: boolean
    /** Prefix for scopeId to avoid conflicts when multiple tables use same revisionId */
    scopeIdPrefix?: string
}

/**
 * TestcasesTableShell - Table wrapper with InfiniteVirtualTable configuration
 *
 * Handles:
 * - Table scope configuration
 * - Row selection with dirty state indicators
 * - Column definitions with editable headers
 * - Export configuration
 * - Delete action
 * - Search filter
 * - All table-specific rendering logic
 *
 * @component
 */
export function TestcasesTableShell(props: TestcasesTableShellProps) {
    const {
        mode,
        revisionIdParam,
        table,
        rowHeight,
        selectedRowKeys,
        onSelectedRowKeysChange,
        onRowClick,
        onDeleteSelected,
        searchTerm,
        onSearchChange,
        header,
        actions,
        hideControls = false,
        enableSelection = mode !== "view",
        autoHeight = true,
        disableDeleteAction = false,
        showRowIndex = false,
        scopeIdPrefix = "testcases",
    } = props

    // Collapsed groups state (using useState for simplicity - persists only during session)
    const [collapsedGroups, setCollapsedGroups] = useState<string[]>([])
    const collapsedGroupsSet = useMemo(() => new Set(collapsedGroups), [collapsedGroups])

    // Toggle collapse state for a group
    const toggleGroupCollapse = useCallback((groupName: string) => {
        setCollapsedGroups((prev) => {
            if (prev.includes(groupName)) {
                return prev.filter((g) => g !== groupName)
            }
            return [...prev, groupName]
        })
    }, [])

    // Table scope configuration
    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: `${scopeIdPrefix}-${revisionIdParam}`,
            pageSize: 50, // Paginated loading
            enableInfiniteScroll: true, // Enable infinite scroll for pagination
            columnVisibilityStorageKey: "testcases:columns",
            // Increase exit debounce to prevent infinite loop on scroll-stop-scroll pattern
            viewportExitDebounceMs: 300,
        }),
        [scopeIdPrefix, revisionIdParam],
    )

    // Get the global Jotai store so entity atoms are accessible inside the table
    const globalStore = useMemo(() => getDefaultStore(), [])

    // Row selection configuration with dirty indicator
    const rowSelection = useMemo(
        () =>
            enableSelection
                ? {
                      selectedRowKeys: showRowIndex ? [] : selectedRowKeys,
                      onChange: showRowIndex ? undefined : onSelectedRowKeysChange,
                      columnWidth: 48,
                      columnTitle: showRowIndex ? (
                          <span className="text-xs text-gray-500">#</span>
                      ) : undefined,
                      onCell: (record: TestcaseTableRow) => {
                          // Check if testcase has unsaved changes (for dirty indicator)
                          const recordKey = String(record.key || record.id)
                          const isNewRow =
                              recordKey.startsWith("new-") || recordKey.startsWith("local-")
                          if (record.id) {
                              const isDirty =
                                  isNewRow || globalStore.get(testcaseIsDirtyAtom(record.id))
                              if (isDirty) {
                                  return {
                                      // Use inline style to override hover styles
                                      style: {backgroundColor: "rgb(255 251 235)"}, // amber-50
                                  }
                              }
                          }
                          return {}
                      },
                      renderCell: (
                          _value: boolean,
                          record: TestcaseTableRow,
                          index: number,
                          originNode: React.ReactNode,
                      ) =>
                          showRowIndex ? (
                              <TestcaseSelectionCell
                                  testcaseId={record.id}
                                  rowIndex={index}
                                  originNode={
                                      <span className="text-xs text-gray-500">{index + 1}</span>
                                  }
                              />
                          ) : (
                              <TestcaseSelectionCell
                                  testcaseId={record.id}
                                  rowIndex={index}
                                  originNode={originNode}
                              />
                          ),
                  }
                : undefined,
        [enableSelection, selectedRowKeys, onSelectedRowKeysChange, globalStore, showRowIndex],
    )

    // Max lines from row height config (already computed by useRowHeight)
    const maxLinesForRowHeight = rowHeight.maxLines

    // Skeleton columns to show while loading (when actual columns are empty)
    const skeletonColumns = useMemo(
        () => [
            {key: "__skeleton_1", name: "--"},
            {key: "__skeleton_2", name: "--"},
            {key: "__skeleton_3", name: "--"},
        ],
        [],
    )

    // Columns definition
    // Use TestcaseCell for entity-aware rendering (reads from entity atoms in global store)
    // Supports grouped columns (e.g., "group.column" renders under "group" header)
    const columns = useMemo<ColumnsType<TestcaseTableRow>>(() => {
        const isEditable = mode === "edit"

        // Use skeleton columns if actual columns are empty (loading state)
        const columnsToRender = table.columns.length > 0 ? table.columns : skeletonColumns
        const isShowingSkeleton = table.columns.length === 0

        // Create column definition for a single column
        // Wrap title with ColumnVisibilityHeader to enable viewport tracking
        const createColumnDef = (
            col: Column,
            displayName: string,
        ): ColumnType<TestcaseTableRow> => ({
            key: col.key,
            dataIndex: col.key,
            title: (
                <ColumnVisibilityHeader columnKey={col.key}>
                    {isEditable && !isShowingSkeleton ? (
                        <EditableColumnHeader
                            columnKey={col.key}
                            columnName={displayName}
                            onRename={table.renameColumn}
                            onDelete={table.deleteColumn}
                        />
                    ) : (
                        <span className="truncate" title={col.key}>
                            {displayName}
                        </span>
                    )}
                </ColumnVisibilityHeader>
            ),
            width: 200,
            render: (value: unknown, record: TestcaseTableRow) => {
                // Show skeleton for skeleton rows or when showing skeleton columns
                if (record.__isSkeleton || isShowingSkeleton) {
                    // Use row height to determine skeleton height (subtract padding)
                    const skeletonHeight = Math.max(24, rowHeight.heightPx - 32)
                    return (
                        <Skeleton.Input
                            active
                            size="small"
                            className="w-full"
                            style={{height: skeletonHeight, minHeight: skeletonHeight}}
                        />
                    )
                }
                // For rows with id (both new and server rows), use entity-aware cell
                // This ensures column renames are reflected correctly
                const rowId = record.id || String(record.key)
                if (rowId) {
                    return (
                        <TestcaseCell
                            testcaseId={rowId}
                            columnKey={col.key}
                            maxLines={maxLinesForRowHeight}
                        />
                    )
                }
                // Fallback for rows without id
                return <TestcaseCellContent value={value} maxLines={maxLinesForRowHeight} />
            },
        })

        // Create collapsed column definition (shows full JSON when group is collapsed)
        const createCollapsedColumnDef = (
            groupName: string,
            _childColumns: Column[],
        ): ColumnType<TestcaseTableRow> => ({
            key: groupName,
            dataIndex: groupName,
            title: (
                <ColumnVisibilityHeader columnKey={groupName}>
                    <div
                        className="flex items-center gap-1 cursor-pointer"
                        onClick={() => toggleGroupCollapse(groupName)}
                    >
                        <CaretRight size={12} />
                        <Typography.Text ellipsis>{groupName}</Typography.Text>
                    </div>
                </ColumnVisibilityHeader>
            ),
            width: 200,
            render: (_value: unknown, record: TestcaseTableRow) => {
                if (record.__isSkeleton || isShowingSkeleton) {
                    const skeletonHeight = Math.max(24, rowHeight.heightPx - 32)
                    return (
                        <Skeleton.Input
                            active
                            size="small"
                            className="w-full"
                            style={{height: skeletonHeight, minHeight: skeletonHeight}}
                        />
                    )
                }
                const rowId = record.id || String(record.key)
                if (rowId) {
                    // Show the parent column (full JSON object)
                    return (
                        <TestcaseCell
                            testcaseId={rowId}
                            columnKey={groupName}
                            maxLines={maxLinesForRowHeight}
                        />
                    )
                }
                return null
            },
        })

        // Render group header with collapse/expand icon
        // groupPath is the full path (e.g., "current_rfp.event"), display only the last segment
        // Wrapped with ColumnVisibilityHeader for viewport tracking
        const renderGroupHeader = (groupPath: string, isCollapsed: boolean, childCount: number) => {
            // Get just the last segment for display (e.g., "event" from "current_rfp.event")
            const displayName = groupPath.includes(".")
                ? groupPath.substring(groupPath.lastIndexOf(".") + 1)
                : groupPath

            return (
                <ColumnVisibilityHeader columnKey={groupPath}>
                    <div
                        className="flex items-center gap-1 cursor-pointer select-none max-w-full overflow-hidden"
                        onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            toggleGroupCollapse(groupPath)
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault()
                                toggleGroupCollapse(groupPath)
                            }
                        }}
                        title={groupPath}
                    >
                        <span className="flex-shrink-0">
                            {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                        </span>
                        <span className="truncate min-w-0">{displayName}</span>
                        <span className="text-gray-400 text-xs flex-shrink-0">({childCount})</span>
                    </div>
                </ColumnVisibilityHeader>
            )
        }

        // Group columns that have "." in their key (e.g., "inputs.country" groups under "inputs")
        const dataColumns = groupColumns<TestcaseTableRow>(columnsToRender, createColumnDef, {
            collapsedGroups: collapsedGroupsSet,
            onGroupHeaderClick: toggleGroupCollapse,
            renderGroupHeader,
            createCollapsedColumnDef,
        })

        if (mode === "view") {
            return [...dataColumns]
        }

        if (hideControls) {
            return [...dataColumns]
        }

        const actionsColumn = createStandardColumns<TestcaseTableRow>([
            {
                type: "actions",
                width: 56,
                showCopyId: true,
                items: [
                    {
                        key: "edit",
                        label: "Edit",
                        icon: <PencilSimple size={16} />,
                        onClick: (record) => {
                            if (record.id) onRowClick(record)
                        },
                    },
                    {type: "divider"},
                    {
                        key: "delete",
                        label: "Delete",
                        icon: <Trash size={16} />,
                        danger: true,
                        onClick: (record) => {
                            if (record.key) {
                                table.deleteTestcases([String(record.key)])
                                message.success("Deleted testcase. Save to apply changes.")
                            }
                        },
                    },
                ],
            },
        ])

        return [...dataColumns, ...actionsColumn]
    }, [
        table.columns,
        table.renameColumn,
        table.deleteColumn,
        table.deleteTestcases,
        mode,
        maxLinesForRowHeight,
        rowHeight.heightPx,
        skeletonColumns,
        onRowClick,
        hideControls,
        collapsedGroupsSet,
        toggleGroupCollapse,
    ])

    // Export configuration
    const exportOptions = useMemo(
        () => ({
            resolveValue: (args: {row: TestcaseTableRow; columnKey: string}) => {
                return args.row[args.columnKey]
            },
            resolveColumnLabel: (context: {columnIndex: number}) => {
                const col = table.columns[context.columnIndex]
                return col?.name || col?.key
            },
            filename: `${table.testsetName || "testset"}.csv`,
        }),
        [table.columns, table.testsetName],
    )

    // Delete action
    const deleteAction = useMemo(
        () =>
            disableDeleteAction
                ? undefined
                : {
                      onDelete: onDeleteSelected,
                      disabled: selectedRowKeys.length === 0 || mode === "view",
                      disabledTooltip: "Select testcases to delete",
                  },
        [disableDeleteAction, onDeleteSelected, selectedRowKeys.length, mode],
    )

    // Table props
    const tableProps = useMemo(
        () => ({
            size: "small" as const,
            bordered: true,
            onRow: (record: TestcaseTableRow) => ({
                onClick: () => onRowClick(record),
                className: "cursor-pointer hover:bg-gray-50",
            }),
        }),
        [onRowClick],
    )

    // Filters
    const filters = useMemo(
        () =>
            hideControls ? null : (
                <Input
                    allowClear
                    placeholder="Search testcases..."
                    className="w-64"
                    value={searchTerm}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            ),
        [hideControls, searchTerm, onSearchChange],
    )

    return (
        <InfiniteVirtualTableFeatureShell<TestcaseTableRow>
            datasetStore={testcasesDatasetStore}
            tableScope={tableScope}
            columns={columns}
            rowKey="key"
            title={header}
            filters={filters || undefined}
            primaryActions={hideControls ? undefined : actions}
            deleteAction={hideControls ? undefined : deleteAction}
            exportOptions={exportOptions}
            autoHeight={autoHeight}
            rowHeight={rowHeight.heightPx}
            fallbackControlsHeight={96}
            fallbackHeaderHeight={48}
            tableClassName={clsx(
                "agenta-testcase-table",
                `agenta-testcase-table--row-${rowHeight.size}`,
            )}
            tableProps={tableProps}
            rowSelection={rowSelection}
            useSettingsDropdown={!hideControls}
            store={globalStore}
        />
    )
}
