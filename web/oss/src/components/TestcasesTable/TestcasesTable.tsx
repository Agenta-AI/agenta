import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    CheckCircleFilled,
    DeleteOutlined,
    EditOutlined,
    MoreOutlined,
    PlusOutlined,
    SaveOutlined,
} from "@ant-design/icons"
import {Link, PencilSimple} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Space, Tag, Tooltip, Typography, Popconfirm, Modal} from "antd"
import type {ColumnsType} from "antd/es/table"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useEditableTable,
    ColumnVisibilityMenuTrigger,
    TableDescription,
} from "@/oss/components/InfiniteVirtualTable"
import useBlockNavigation from "@/oss/hooks/useBlockNavigation"
import useURL from "@/oss/hooks/useURL"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {convertToCsv, downloadCsv} from "@/oss/lib/helpers/fileManipulations"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {updateTestset} from "@/oss/services/testsets/api"
import {useQueryParamState} from "@/oss/state/appState"
import {testcaseIdAtom, clearTestcaseParamAtom} from "@/oss/state/url"

import {message} from "../AppMessageContext"

import {
    testcasesDatasetStore,
    testcasesTestsetIdAtom,
    testsetMetadataQueryAtom,
    type TestcaseTableRow,
} from "./atoms/tableStore"
import TestcaseEditDrawer from "./components/TestcaseEditDrawer"

interface TestcasesTableProps {
    mode?: "edit" | "view"
}

const TestcasesTable = ({mode: _mode = "edit"}: TestcasesTableProps) => {
    const router = useRouter()
    const {testset_id} = router.query
    const {projectURL} = useURL()

    // URL state for testcase drawer deep linking
    const testcaseIdParam = useAtomValue(testcaseIdAtom)
    const clearTestcaseParam = useSetAtom(clearTestcaseParamAtom)
    const [, setTestcaseIdParam] = useQueryParamState("testcase_id")
    const containerRef = useRef<HTMLDivElement>(null)
    const tableRef = useRef<{
        scrollTo: (config: {index: number; align?: "top" | "bottom" | "auto"}) => void
    } | null>(null)

    // Atoms
    const setTestsetId = useSetAtom(testcasesTestsetIdAtom)
    const testsetMetadataQuery = useAtomValue(testsetMetadataQueryAtom)

    // Derived state from query
    const fetchedTestsetName = testsetMetadataQuery.data?.name ?? ""

    // Local state
    const [isLoading, setIsLoading] = useState(false)
    const [isIdCopied, setIsIdCopied] = useState(false)
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
    const [editingColumnIndex, setEditingColumnIndex] = useState<number | null>(null)
    const [editingColumnName, setEditingColumnName] = useState("")
    const [isAddColumnModalOpen, setIsAddColumnModalOpen] = useState(false)
    const [newColumnName, setNewColumnName] = useState("")
    const [localTestsetName, setLocalTestsetName] = useState<string | null>(null)
    const [searchTerm, setSearchTerm] = useState("")

    // Drawer state for editing testcases
    const [editDrawerOpen, setEditDrawerOpen] = useState(false)
    const [editingRow, setEditingRow] = useState<TestcaseTableRow | null>(null)

    // Use local name if edited, otherwise use fetched name
    const testsetName = localTestsetName ?? fetchedTestsetName
    const testsetNameChanged = localTestsetName !== null && localTestsetName !== fetchedTestsetName

    // Table manager
    const table = useTableManager({
        datasetStore: testcasesDatasetStore,
        scopeId: "testcases-table",
    })

    // Editable table hook - handles all edit state management
    const [editState, editActions] = useEditableTable<TestcaseTableRow>({
        systemFields: [
            "id",
            "key",
            "testset_id",
            "created_at",
            "__isSkeleton",
            "testcase_dedup_id",
        ],
        createNewRow: () => ({
            testset_id: testset_id as string,
            created_at: new Date().toISOString(),
        }),
    })

    // Get pagination rows - use this instead of table.rows for reactivity
    const paginationRows = table.pagination.rows

    // Set testset ID from URL and reset pagination when it changes
    const resetPages = table.pagination.resetPages
    useEffect(() => {
        if (testset_id && typeof testset_id === "string") {
            setTestsetId(testset_id)
            // Reset local state when testset changes
            setLocalTestsetName(null)
            // Reset pagination to trigger initial fetch with new testsetId
            resetPages()
        }
    }, [testset_id, setTestsetId, resetPages])

    // Derive columns from the first row of loaded data
    const columnsLength = editState.columns.length
    const deriveColumnsFromRow = editState.deriveColumnsFromRow
    useEffect(() => {
        if (paginationRows.length > 0 && columnsLength === 0) {
            deriveColumnsFromRow(paginationRows[0])
        }
    }, [paginationRows, columnsLength, deriveColumnsFromRow])

    // Open drawer from URL deep link
    useEffect(() => {
        if (testcaseIdParam && typeof testcaseIdParam === "string" && paginationRows.length > 0) {
            // Find the row with matching id
            const row = paginationRows.find((r) => r.id === testcaseIdParam)
            if (row && !editDrawerOpen) {
                setEditingRow(row)
                setEditDrawerOpen(true)
            }
        }
    }, [testcaseIdParam, paginationRows, editDrawerOpen])

    // Breadcrumbs
    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                testsets: {label: "testsets", href: `${projectURL}/testsets`},
                "testset-detail": {label: testsetName, value: testset_id as string},
            },
            condition: testsetName.trim() && !!testset_id,
        },
        [testsetName],
    )

    // Track unsaved changes
    const hasUnsavedChanges = editState.hasUnsavedChanges || testsetNameChanged

    // Block navigation on unsaved changes
    useBlockNavigation(hasUnsavedChanges, {
        title: "Unsaved changes",
        message:
            "You have unsaved changes in your testset. Do you want to save these changes before leaving the page?",
        okText: "Save",
        onOk: async () => {
            await handleSave()
            return !!testsetName
        },
        cancelText: "Proceed without saving",
    })

    // Get display rows with edits applied and search filtering
    const displayRows = useMemo(() => {
        const rows = editActions.getDisplayRows(paginationRows)

        // Apply client-side search filter
        if (!searchTerm.trim()) {
            return rows
        }

        const lowerSearch = searchTerm.toLowerCase()
        return rows.filter((row) => {
            // Search across all column values
            return editState.columns.some((col) => {
                const value = row[col.key]
                if (value == null) return false
                return String(value).toLowerCase().includes(lowerSearch)
            })
        })
    }, [paginationRows, editActions, searchTerm, editState.columns])

    // Handle add column
    const handleAddColumn = useCallback(() => {
        if (!newColumnName.trim()) {
            message.error("Column name cannot be empty")
            return
        }

        const success = editActions.addColumn(newColumnName.trim())
        if (!success) {
            message.error("Column name already exists")
            return
        }

        setNewColumnName("")
        setIsAddColumnModalOpen(false)
    }, [newColumnName, editActions])

    // Handle rename column
    const handleRenameColumn = useCallback(
        (oldName: string, newName: string) => {
            if (!newName.trim()) {
                message.error("Column name cannot be empty")
                setEditingColumnIndex(null)
                return
            }
            if (oldName === newName.trim()) {
                setEditingColumnIndex(null)
                return
            }

            const success = editActions.renameColumn(oldName, newName.trim())
            if (!success) {
                message.error("Column name already exists")
                return
            }

            setEditingColumnIndex(null)
        },
        [editActions],
    )

    // Handle delete rows
    const handleDeleteRows = useCallback(() => {
        editActions.deleteRows(selectedRowKeys)
        setSelectedRowKeys([])
    }, [selectedRowKeys, editActions])

    // Handle save
    const handleSave = useCallback(async () => {
        if (!testsetName) {
            message.error("Please enter a testset name")
            return
        }

        setIsLoading(true)
        try {
            // Get final row data using the hook
            const finalRows = editActions.getFinalRowData(paginationRows)

            const response = await updateTestset(testset_id as string, testsetName, finalRows)

            if (response.status === 200) {
                message.success("Changes saved successfully!")

                // Clear local state
                editActions.clearLocalState()
                setLocalTestsetName(null) // Reset to use fetched name

                // Refetch metadata to get updated name from server
                testsetMetadataQuery.refetch()
            }
        } catch (error) {
            console.error("Error saving testset:", error)
            message.error("Failed to save changes")
        } finally {
            setIsLoading(false)
        }
    }, [testsetName, testset_id, paginationRows, editActions, testsetMetadataQuery])

    // Handle export
    const handleExport = useCallback(() => {
        const finalRows = editActions.getFinalRowData(paginationRows)
        const columnKeys = editState.columns.map((c) => c.key)
        const csvData = convertToCsv(finalRows, columnKeys)
        downloadCsv(csvData, `${testsetName}.csv`)
    }, [editActions, editState.columns, paginationRows, testsetName])

    // Handle copy ID
    const handleCopyId = useCallback(async () => {
        await copyToClipboard(testset_id as string, false)
        setIsIdCopied(true)
        setTimeout(() => setIsIdCopied(false), 2000)
    }, [testset_id])

    // Handle add row - creates row and opens drawer for editing
    const handleAddRow = useCallback(() => {
        const newRow = editActions.addRow()
        // Scroll to the top since new rows are prepended at the top
        requestAnimationFrame(() => {
            tableRef.current?.scrollTo({index: 0, align: "top"})
        })
        // Open drawer for the new row
        setEditingRow(newRow)
        setEditDrawerOpen(true)
    }, [editActions])

    // Handle opening drawer for editing an existing row
    const handleEditRow = useCallback(
        (row: TestcaseTableRow) => {
            setEditingRow(row)
            setEditDrawerOpen(true)
            // Update URL with testcase_id for deep linking
            const rowId = row.id as string | undefined
            if (rowId) {
                setTestcaseIdParam(rowId, {shallow: true})
            }
        },
        [setTestcaseIdParam],
    )

    // Handle closing the drawer - clear URL state first to prevent re-open from useEffect
    const handleCloseDrawer = useCallback(() => {
        clearTestcaseParam()
        setEditDrawerOpen(false)
        setEditingRow(null)
    }, [clearTestcaseParam])

    // Clear URL param when drawer closes (via afterOpenChange)
    const handleDrawerAfterOpenChange = useCallback(
        (isOpen: boolean) => {
            if (!isOpen) {
                clearTestcaseParam()
            }
        },
        [clearTestcaseParam],
    )

    // Handle saving changes from the drawer
    const handleDrawerSave = useCallback(
        (rowKey: string, updates: Record<string, unknown>) => {
            // Apply each field update
            Object.entries(updates).forEach(([columnKey, value]) => {
                editActions.editCell(rowKey, columnKey, value)
            })
        },
        [editActions],
    )

    // Build columns for the table
    const tableColumns = useMemo<ColumnsType<TestcaseTableRow>>(() => {
        const cols: ColumnsType<TestcaseTableRow> = editState.columns.map((col, index) => ({
            title: (
                <div className="flex items-center justify-between gap-2 w-full">
                    {editingColumnIndex === index ? (
                        <Input
                            size="small"
                            value={editingColumnName}
                            onChange={(e) => setEditingColumnName(e.target.value)}
                            onPressEnter={() => handleRenameColumn(col.key, editingColumnName)}
                            onBlur={() => handleRenameColumn(col.key, editingColumnName)}
                            autoFocus
                            className="flex-1"
                        />
                    ) : (
                        <span className="flex-1 truncate">{col.name}</span>
                    )}
                    <div className="flex items-center gap-1">
                        {editingColumnIndex === index ? (
                            <Button
                                type="text"
                                size="small"
                                icon={<SaveOutlined />}
                                onClick={() => handleRenameColumn(col.key, editingColumnName)}
                            />
                        ) : (
                            <Button
                                type="text"
                                size="small"
                                icon={<EditOutlined />}
                                onClick={() => {
                                    setEditingColumnIndex(index)
                                    setEditingColumnName(col.name)
                                }}
                            />
                        )}
                        <Popconfirm
                            title="Delete column?"
                            description="This will remove the column from all rows."
                            onConfirm={() => editActions.deleteColumn(col.key)}
                            okText="Delete"
                            cancelText="Cancel"
                        >
                            <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                        </Popconfirm>
                    </div>
                </div>
            ),
            dataIndex: col.key,
            key: col.key,
            width: 200,
            ellipsis: true,
            render: (_value: unknown, record: TestcaseTableRow) => {
                if (record.__isSkeleton) return null
                const cellValue = record[col.key]
                const displayValue = String(cellValue ?? "")
                return (
                    <div
                        className="w-full cursor-pointer py-1 px-2 -mx-2 rounded hover:bg-gray-50 transition-colors min-h-[24px]"
                        onClick={() => handleEditRow(record)}
                        title={displayValue}
                    >
                        <Typography.Text ellipsis type={displayValue ? undefined : "secondary"}>
                            {displayValue || "—"}
                        </Typography.Text>
                    </div>
                )
            },
        }))

        // Actions column at the end
        cols.push({
            title: isAddColumnModalOpen ? (
                <div className="flex items-center gap-1 w-full">
                    <Input
                        size="small"
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        onPressEnter={handleAddColumn}
                        onBlur={() => {
                            if (newColumnName.trim()) {
                                handleAddColumn()
                            } else {
                                setIsAddColumnModalOpen(false)
                            }
                        }}
                        placeholder="Column name"
                        autoFocus
                        className="flex-1"
                    />
                    <Button
                        type="text"
                        size="small"
                        icon={<SaveOutlined />}
                        onClick={handleAddColumn}
                    />
                </div>
            ) : (
                <div className="flex items-center justify-center gap-1">
                    <Tooltip title="Add column">
                        <Button
                            type="text"
                            size="small"
                            icon={<PlusOutlined />}
                            onClick={() => setIsAddColumnModalOpen(true)}
                        />
                    </Tooltip>
                    <ColumnVisibilityMenuTrigger variant="icon" />
                </div>
            ),
            key: "actions",
            width: isAddColumnModalOpen ? 200 : 88,
            fixed: "right",
            align: "center" as const,
            render: (_: unknown, record: TestcaseTableRow) => {
                if (record.__isSkeleton) return null
                return (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                {
                                    key: "edit",
                                    label: "Edit row",
                                    icon: <EditOutlined />,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        handleEditRow(record)
                                    },
                                },
                                {
                                    key: "delete",
                                    label: "Delete row",
                                    icon: <DeleteOutlined />,
                                    danger: true,
                                    onClick: (e) => {
                                        e.domEvent.stopPropagation()
                                        editActions.deleteRows([String(record.key)])
                                    },
                                },
                            ],
                        }}
                    >
                        <Tooltip title="Row actions">
                            <Button
                                type="text"
                                size="small"
                                icon={<MoreOutlined />}
                                onClick={(e) => e.stopPropagation()}
                            />
                        </Tooltip>
                    </Dropdown>
                )
            },
        })

        return cols
    }, [
        editState.columns,
        editingColumnIndex,
        editingColumnName,
        handleRenameColumn,
        editActions,
        isAddColumnModalOpen,
        newColumnName,
        handleAddColumn,
        handleEditRow,
    ])

    // State for rename modal
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false)
    const [editingName, setEditingName] = useState("")

    const tooltipTitle = isIdCopied ? (
        <div className="flex items-center gap-1">
            <CheckCircleFilled style={{color: "green"}} />
            <span>Copied to clipboard</span>
        </div>
    ) : (
        testset_id || ""
    )

    // Handle rename modal
    const handleOpenRenameModal = useCallback(() => {
        setEditingName(testsetName)
        setIsRenameModalOpen(true)
    }, [testsetName])

    const handleRenameConfirm = useCallback(() => {
        if (editingName.trim()) {
            setLocalTestsetName(editingName.trim())
        }
        setIsRenameModalOpen(false)
    }, [editingName])

    // Header title with editable testset name
    const headerTitle = useMemo(
        () => (
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <Typography.Title level={3} style={{margin: 0}}>
                        {testsetName || "Untitled Testset"}
                    </Typography.Title>
                    <Tooltip title="Rename testset">
                        <Button
                            type="text"
                            size="small"
                            icon={<PencilSimple size={16} />}
                            onClick={handleOpenRenameModal}
                        />
                    </Tooltip>
                    <Tooltip title={tooltipTitle}>
                        <Tag
                            className="cursor-pointer flex items-center gap-1"
                            onClick={handleCopyId}
                        >
                            <Link size={14} weight="bold" />
                            <span>ID</span>
                        </Tag>
                    </Tooltip>
                </div>
                <TableDescription>
                    Specify column names similar to the Input parameters. A column with{" "}
                    <strong>'correct_answer'</strong> name will be treated as a ground truth column.
                </TableDescription>
            </div>
        ),
        [testsetName, tooltipTitle, handleCopyId, handleOpenRenameModal],
    )

    // Filters - search input
    const filtersNode = useMemo(
        () => (
            <div className="flex gap-2 flex-1 items-center min-w-[320px] shrink">
                <Input
                    allowClear
                    placeholder="Search testcases..."
                    className="min-w-0 shrink max-w-[320px]"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{minWidth: 220}}
                />
            </div>
        ),
        [searchTerm],
    )

    // Primary actions - Save button
    const primaryActions = useMemo(
        () => (
            <Button
                loading={isLoading}
                onClick={handleSave}
                type="primary"
                disabled={!hasUnsavedChanges}
            >
                Save Testset
            </Button>
        ),
        [isLoading, handleSave, hasUnsavedChanges],
    )

    // Secondary actions - Add Row, Delete Row, Export
    const secondaryActions = useMemo(
        () => (
            <Space>
                <Button onClick={handleAddRow} icon={<PlusOutlined />}>
                    Add Row
                </Button>
                <Button
                    onClick={handleDeleteRows}
                    disabled={selectedRowKeys.length === 0}
                    danger
                    icon={<DeleteOutlined />}
                >
                    Delete Row{selectedRowKeys.length > 1 ? "s" : ""}
                </Button>
                <Button onClick={handleExport}>Export CSV</Button>
            </Space>
        ),
        [handleAddRow, handleDeleteRows, selectedRowKeys.length, handleExport],
    )

    // Custom table props with row styling for unsaved rows
    const customTableProps = useMemo(
        () => ({
            ...table.tableProps,
            onRow: (record: TestcaseTableRow, index: number) => {
                const baseProps = table.tableProps.onRow?.(record, index) ?? {}
                const isNewRow = String(record.key).startsWith("new-")
                return {
                    ...baseProps,
                    className: isNewRow
                        ? `${baseProps.className ?? ""} bg-green-50 border-l-2 border-l-green-500`.trim()
                        : baseProps.className,
                }
            },
        }),
        [table.tableProps],
    )

    return (
        <div ref={containerRef} className="flex flex-col h-full w-full overflow-hidden">
            <InfiniteVirtualTableFeatureShell<TestcaseTableRow>
                datasetStore={testcasesDatasetStore}
                tableScope={table.tableScope}
                pagination={table.tablePagination}
                tableProps={customTableProps}
                columns={tableColumns}
                rowKey="key"
                title={headerTitle}
                filters={filtersNode}
                primaryActions={primaryActions}
                secondaryActions={secondaryActions}
                dataSource={displayRows}
                rowSelection={{
                    type: "checkbox",
                    selectedRowKeys,
                    onChange: (keys) => setSelectedRowKeys(keys as string[]),
                    getCheckboxProps: (record) => ({
                        disabled: Boolean(record.__isSkeleton),
                    }),
                    columnWidth: 48,
                    fixed: true,
                    renderCell: (value, record, index, originNode) => (
                        <Tooltip
                            title={`Row ${index + 1}${record.id ? ` • ${record.id.slice(-8)}` : ""}`}
                            placement="right"
                        >
                            <span>{originNode}</span>
                        </Tooltip>
                    ),
                }}
                autoHeight
                className="flex-1 min-h-0"
                tableRef={tableRef}
            />

            <Modal
                title="Rename Testset"
                open={isRenameModalOpen}
                onOk={handleRenameConfirm}
                onCancel={() => setIsRenameModalOpen(false)}
                okText="Save"
            >
                <Input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    placeholder="Testset name"
                    onPressEnter={handleRenameConfirm}
                    autoFocus
                />
            </Modal>

            <TestcaseEditDrawer
                open={editDrawerOpen}
                onClose={handleCloseDrawer}
                row={editingRow}
                columns={editState.columns}
                isNewRow={editingRow ? String(editingRow.key).startsWith("new-") : false}
                onSave={handleDrawerSave}
                afterOpenChange={handleDrawerAfterOpenChange}
            />
        </div>
    )
}

export default TestcasesTable
