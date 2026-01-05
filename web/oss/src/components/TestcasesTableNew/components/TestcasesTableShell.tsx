import {useCallback, useMemo, useState} from "react"

import {MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {CaretDown, CaretRight, Copy, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Skeleton, Tooltip} from "antd"
import type {MenuProps} from "antd"
import type {ColumnType, ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

import {
    ColumnVisibilityHeader,
    ColumnVisibilityMenuTrigger,
    InfiniteVirtualTableFeatureShell,
    type TableScopeConfig,
} from "@/oss/components/InfiniteVirtualTable"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import type {Column} from "@/oss/state/entities/testcase/columnState"
import {testcaseIsDirtyAtom} from "@/oss/state/entities/testcase/dirtyState"
import {testsetMetadataAtom} from "@/oss/state/entities/testcase/queries"

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
        menuItems: MenuProps["items"]
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
    /** Maximum number of rows to display (for preview mode) */
    maxRows?: number
    /** Callback when add column button is clicked (shown in actions column header) */
    onAddColumn?: () => void
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
        maxRows,
        onAddColumn,
    } = props

    // Get metadata for export filename
    const metadata = useAtomValue(testsetMetadataAtom)

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
            pageSize: maxRows ?? 50, // Use maxRows if provided, otherwise default to 50
            enableInfiniteScroll: !maxRows, // Disable infinite scroll when maxRows is set
            columnVisibilityStorageKey: "testcases:columns",
            viewportTrackingEnabled: true,
        }),
        [scopeIdPrefix, revisionIdParam, maxRows],
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
                      fixed: "left" as const,
                      columnTitle: showRowIndex ? (
                          <span className="text-xs text-gray-500">#</span>
                      ) : undefined,
                      // Dirty indicator background is now handled reactively in TestcaseSelectionCell
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
                                  mode={mode}
                                  originNode={
                                      <span className="text-xs text-gray-500">{index + 1}</span>
                                  }
                              />
                          ) : (
                              <TestcaseSelectionCell
                                  testcaseId={record.id}
                                  rowIndex={index}
                                  mode={mode}
                                  originNode={originNode}
                              />
                          ),
                  }
                : undefined,
        [enableSelection, selectedRowKeys, onSelectedRowKeysChange, globalStore, showRowIndex, mode],
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

    // Empty state columns - shown when user has no data (not loading)
    const emptyStateColumns = useMemo(() => [{key: "__empty", name: "No columns yet"}], [])

    // Handle group column rename - renames all nested columns
    const handleGroupRename = useCallback(
        (groupPath: string, newName: string): boolean => {
            // Get all columns that belong to this group
            const columnsInGroup = table.columns.filter((col) =>
                col.key.startsWith(groupPath + "."),
            )

            if (columnsInGroup.length === 0) return false

            // Rename each nested column
            let allSucceeded = true
            columnsInGroup.forEach((col) => {
                // Replace the group prefix with the new group name
                const relativePath = col.key.substring(groupPath.length + 1)
                const newColumnName = `${newName}.${relativePath}`
                const success = table.renameColumn(col.key, newColumnName)
                if (!success) allSucceeded = false
            })

            return allSucceeded
        },
        [table],
    )

    // Handle group column delete - deletes all nested columns
    const handleGroupDelete = useCallback(
        (groupPath: string) => {
            // Get all columns that belong to this group
            const columnsInGroup = table.columns.filter((col) =>
                col.key.startsWith(groupPath + "."),
            )

            // Delete each nested column
            columnsInGroup.forEach((col) => {
                table.deleteColumn(col.key)
            })
        },
        [table],
    )

    // Columns definition
    // Use TestcaseCell for entity-aware rendering (reads from entity atoms in global store)
    // Supports grouped columns (e.g., "group.column" renders under "group" header)
    const columns = useMemo<ColumnsType<TestcaseTableRow>>(() => {
        const isEditable = mode === "edit"

        // Differentiate between loading state and empty state
        const hasNoColumns = table.columns.length === 0
        const isActuallyLoading = table.isLoading

        // Use skeleton columns only when loading, empty state columns when truly empty
        const columnsToRender = hasNoColumns
            ? isActuallyLoading
                ? skeletonColumns
                : emptyStateColumns
            : table.columns

        const isShowingSkeleton = hasNoColumns && isActuallyLoading
        const isShowingEmpty = hasNoColumns && !isActuallyLoading

        // Create column definition for a single column
        // Wrap title with ColumnVisibilityHeader to enable viewport tracking
        const createColumnDef = (
            col: Column,
            displayName: string,
        ): ColumnType<TestcaseTableRow> => ({
            key: col.key,
            dataIndex: col.key,
            title:
                isEditable && !isShowingSkeleton && !isShowingEmpty ? (
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
                // Show empty state message when no columns exist (not loading)
                if (isShowingEmpty) {
                    return (
                        <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                            Add a column to get started
                        </div>
                    )
                }
                // For rows with id (both new and server rows), use entity-aware cell
                // This ensures column renames are reflected correctly
                const rowId = record.id || String(record.key)
                if (rowId) {
                    return (
                        <TestcaseCell
                            key={`${rowId}-${col.key}`}
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
        // groupPath is the full path (e.g., "current_rfp.event"), display only the last segment
        const createCollapsedColumnDef = (
            groupPath: string,
            _childColumns: Column[],
        ): ColumnType<TestcaseTableRow> => {
            const displayName = groupPath.includes(".")
                ? groupPath.substring(groupPath.lastIndexOf(".") + 1)
                : groupPath

            return {
                key: groupPath,
                dataIndex: groupPath,
                title: (
                    <div className="flex items-center gap-1 w-full max-w-full overflow-hidden">
                        <span
                            className="flex-shrink-0 cursor-pointer"
                            onClick={(e) => {
                                e.stopPropagation()
                                e.preventDefault()
                                toggleGroupCollapse(groupPath)
                            }}
                        >
                            <CaretRight size={12} />
                        </span>
                        <div className="flex-1 min-w-0">
                            <EditableColumnHeader
                                columnKey={groupPath}
                                columnName={displayName}
                                onRename={(oldName, newName) => handleGroupRename(groupPath, newName)} // prettier-ignore
                                onDelete={() => handleGroupDelete(groupPath)}
                                disabled={!isEditable}
                                inlineActionsMinWidth={80}
                            />
                        </div>
                    </div>
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
                    if (isShowingEmpty) {
                        return (
                            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                                Add a column to get started
                            </div>
                        )
                    }
                    const rowId = record.id || String(record.key)
                    if (rowId) {
                        // Show the parent column (full JSON object)
                        return (
                            <TestcaseCell
                                key={`${rowId}-${groupPath}`}
                                testcaseId={rowId}
                                columnKey={groupPath}
                                maxLines={maxLinesForRowHeight}
                            />
                        )
                    }
                    return null
                },
            }
        }

        // Render group header with collapse/expand icon and editable controls
        // groupPath is the full path (e.g., "current_rfp.event"), display only the last segment
        // Wrapped with ColumnVisibilityHeader for viewport tracking
        const renderGroupHeader = (groupPath: string, isCollapsed: boolean, childCount: number) => {
            // Get just the last segment for display (e.g., "event" from "current_rfp.event")
            const displayName = groupPath.includes(".")
                ? groupPath.substring(groupPath.lastIndexOf(".") + 1)
                : groupPath

            return (
                <div className="flex items-center gap-1 w-full max-w-full overflow-hidden">
                    <span
                        className="flex-shrink-0 cursor-pointer"
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
                    >
                        {isCollapsed ? <CaretRight size={12} /> : <CaretDown size={12} />}
                    </span>
                    <div className="flex-1 min-w-0">
                        <EditableColumnHeader
                            columnKey={groupPath}
                            columnName={displayName}
                            onRename={(oldName, newName) => handleGroupRename(groupPath, newName)} // prettier-ignore
                            onDelete={() => handleGroupDelete(groupPath)}
                            disabled={!isEditable}
                            inlineActionsMinWidth={80}
                        />
                    </div>
                    <span className="text-gray-400 text-xs flex-shrink-0">({childCount})</span>
                </div>
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

        // Custom actions column with Add Column button in header
        const actionsColumn: ColumnsType<TestcaseTableRow> = [
            {
                title: (
                    <div className="flex items-center gap-1 justify-end">
                        {onAddColumn && mode === "edit" && (
                            <Tooltip title="Add column">
                                <Button
                                    type="text"
                                    size="small"
                                    icon={<PlusOutlined />}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        onAddColumn()
                                    }}
                                />
                            </Tooltip>
                        )}
                        <ColumnVisibilityMenuTrigger variant="icon" />
                    </div>
                ),
                key: "actions",
                width: 56,
                fixed: "right",
                align: "center",
                columnVisibilityLocked: true as any,
                render: (_, record) => {
                    if (record.__isSkeleton || isShowingSkeleton) return null

                    const menuItems: any[] = [
                        {
                            key: "edit",
                            label: "Edit",
                            icon: <PencilSimple size={16} />,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                if (record.id) onRowClick(record)
                            },
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                if (record.key) {
                                    table.deleteTestcases([String(record.key)])
                                    message.success("Deleted testcase. Save to apply changes.")
                                }
                            },
                        },
                    ]

                    // Add copy ID
                    const recordId = (record as any).id || (record as any).key
                    if (recordId) {
                        menuItems.push({type: "divider"})
                        menuItems.push({
                            key: "copy-id",
                            label: "Copy ID",
                            icon: <Copy size={16} />,
                            onClick: (e: any) => {
                                e.domEvent.stopPropagation()
                                copyToClipboard(String(recordId))
                            },
                        })
                    }

                    return (
                        <Dropdown trigger={["click"]} menu={{items: menuItems}}>
                            <Tooltip title="Actions">
                                <Button
                                    onClick={(e) => e.stopPropagation()}
                                    type="text"
                                    icon={<MoreOutlined />}
                                    size="small"
                                />
                            </Tooltip>
                        </Dropdown>
                    )
                },
            },
        ]

        return [...dataColumns, ...actionsColumn]
    }, [
        table.columns,
        table.isLoading,
        table.renameColumn,
        table.deleteColumn,
        table.deleteTestcases,
        mode,
        maxLinesForRowHeight,
        rowHeight.heightPx,
        skeletonColumns,
        emptyStateColumns,
        onRowClick,
        hideControls,
        collapsedGroupsSet,
        toggleGroupCollapse,
        onAddColumn,
        handleGroupRename,
        handleGroupDelete,
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
            filename: `${metadata?.testsetName || "testset"}.csv`,
        }),
        [table.columns, metadata?.testsetName],
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
            settingsDropdownMenuItems={hideControls ? undefined : rowHeight.menuItems}
            store={globalStore}
        />
    )
}
