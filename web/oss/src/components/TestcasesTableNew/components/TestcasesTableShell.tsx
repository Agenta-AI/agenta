import {useMemo} from "react"

import {PencilSimple, Trash} from "@phosphor-icons/react"
import {Input, Skeleton} from "antd"
import type {ColumnsType} from "antd/es/table"
import clsx from "clsx"
import {getDefaultStore} from "jotai/vanilla"

import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    type TableScopeConfig,
} from "@/oss/components/InfiniteVirtualTable"
import {testcaseIsDirtyAtom} from "@/oss/state/entities/testcase/dirtyState"

import {message} from "../../AppMessageContext"
import {testcasesDatasetStore, type TestcaseTableRow} from "../atoms/tableStore"
import type {UseTestcasesTableResult} from "../hooks/types"

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
    } = props

    // Table scope configuration
    const tableScope = useMemo<TableScopeConfig>(
        () => ({
            scopeId: `testcases-${revisionIdParam}`,
            pageSize: 50, // Paginated loading
            enableInfiniteScroll: true, // Enable infinite scroll for pagination
            columnVisibilityStorageKey: "testcases:columns",
        }),
        [revisionIdParam],
    )

    // Get the global Jotai store so entity atoms are accessible inside the table
    const globalStore = useMemo(() => getDefaultStore(), [])

    // Row selection configuration with dirty indicator
    const rowSelection = useMemo(
        () =>
            mode === "edit"
                ? {
                      selectedRowKeys,
                      onChange: onSelectedRowKeysChange,
                      columnWidth: 48,
                      onCell: (record: TestcaseTableRow) => {
                          // Check if testcase has unsaved changes
                          if (record.id) {
                              const isDirty = globalStore.get(testcaseIsDirtyAtom(record.id))
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
                      ) => (
                          <TestcaseSelectionCell
                              testcaseId={record.id}
                              rowIndex={index}
                              originNode={originNode}
                          />
                      ),
                  }
                : undefined,
        [mode, selectedRowKeys, onSelectedRowKeysChange, globalStore],
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
    const columns = useMemo<ColumnsType<TestcaseTableRow>>(() => {
        const isEditable = mode === "edit"

        // Use skeleton columns if actual columns are empty (loading state)
        const columnsToRender = table.columns.length > 0 ? table.columns : skeletonColumns
        const isShowingSkeleton = table.columns.length === 0

        const dataColumns: ColumnsType<TestcaseTableRow> = columnsToRender.map((col) => ({
            key: col.key,
            dataIndex: col.key,
            title:
                isEditable && !isShowingSkeleton ? (
                    <EditableColumnHeader
                        columnKey={col.key}
                        columnName={col.name}
                        onRename={table.renameColumn}
                        onDelete={table.deleteColumn}
                    />
                ) : (
                    col.name
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
                // If record has id, use entity-aware cell that reads from atom
                if (record.id) {
                    return (
                        <TestcaseCell
                            testcaseId={record.id}
                            columnKey={col.key}
                            maxLines={maxLinesForRowHeight}
                        />
                    )
                }
                // Fallback for new rows without id yet
                return <TestcaseCellContent value={value} maxLines={maxLinesForRowHeight} />
            },
        }))

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
    }, [table, mode, maxLinesForRowHeight, rowHeight.heightPx, skeletonColumns, onRowClick])

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
        () => ({
            onDelete: onDeleteSelected,
            disabled: selectedRowKeys.length === 0 || mode === "view",
            disabledTooltip: "Select testcases to delete",
        }),
        [onDeleteSelected, selectedRowKeys.length, mode],
    )

    // Table props
    const tableProps = useMemo(
        () => ({
            size: "small" as const,
            bordered: true,
            onRow: (record: TestcaseTableRow) => ({
                onClick: () => onRowClick(record),
                className: `cursor-pointer hover:bg-gray-50 ${
                    String(record.key).startsWith("new-")
                        ? "bg-green-50 border-l-2 border-l-green-500"
                        : ""
                }`,
            }),
        }),
        [onRowClick],
    )

    // Filters
    const filters = useMemo(
        () => (
            <Input
                allowClear
                placeholder="Search testcases..."
                className="w-64"
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
            />
        ),
        [searchTerm, onSearchChange],
    )

    return (
        <InfiniteVirtualTableFeatureShell<TestcaseTableRow>
            datasetStore={testcasesDatasetStore}
            tableScope={tableScope}
            columns={columns}
            rowKey="key"
            title={header}
            filters={filters}
            primaryActions={actions}
            deleteAction={deleteAction}
            exportOptions={exportOptions}
            autoHeight={true}
            rowHeight={rowHeight.heightPx}
            fallbackControlsHeight={96}
            fallbackHeaderHeight={48}
            tableClassName={clsx(
                "agenta-testcase-table",
                `agenta-testcase-table--row-${rowHeight.size}`,
            )}
            tableProps={tableProps}
            rowSelection={rowSelection}
            useSettingsDropdown
        />
    )
}
