import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {DownOutlined, MoreOutlined, PlusOutlined} from "@ant-design/icons"
import {Link, PencilSimple, Trash} from "@phosphor-icons/react"
import {
    Button,
    Dropdown,
    Grid,
    Input,
    Modal,
    Popover,
    Skeleton,
    Space,
    Tag,
    Tooltip,
    Typography,
} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"
import {useRouter} from "next/router"

import {
    createStandardColumns,
    InfiniteVirtualTableFeatureShell,
    TableDescription,
    useRowHeight,
    type TableScopeConfig,
} from "@/oss/components/InfiniteVirtualTable"
import {UserReference} from "@/oss/components/References/UserReference"
import useBlockNavigation from "@/oss/hooks/useBlockNavigation"
import useURL from "@/oss/hooks/useURL"
import {copyToClipboard} from "@/oss/lib/helpers/copyToClipboard"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import {isTestcaseDirtyAtomFamily} from "@/oss/state/entities/testcase/dirtyState"
import {projectIdAtom} from "@/oss/state/project"

import AlertPopup from "../AlertPopup/AlertPopup"
import {message} from "../AppMessageContext"

import {
    testcasesDatasetStore,
    testcasesRevisionIdAtom,
    testcasesSearchTermAtom,
    type TestcaseTableRow,
} from "./atoms/tableStore"
import CommitTestsetModal from "./components/CommitTestsetModal"
import EditableColumnHeader from "./components/EditableColumnHeader"
import {TestcaseCell} from "./components/TestcaseCell"
import TestcaseCellContent from "./components/TestcaseCellContent"
import TestcaseEditDrawer from "./components/TestcaseEditDrawer"
import TestcaseSelectionCell from "./components/TestcaseSelectionCell"
import {useTestcasesTable} from "./hooks/useTestcasesTable"
import {testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG} from "./state/rowHeight"

/**
 * Props for TestcasesTableNew component
 */
export interface TestcasesTableNewProps {
    /** Display mode: edit allows modifications, view is read-only */
    mode?: "edit" | "view"
}

/**
 * Testcases table using InfiniteVirtualTableFeatureShell
 *
 * **Architecture:**
 * - InfiniteVirtualTableFeatureShell: Table rendering, selection, built-in actions
 * - Dataset store: Data fetching (loads entire revision)
 * - Entity atoms: Drawer editing and reactive updates
 * - Custom hooks: Save/add/delete mutations (git-based revisions)
 *
 * **Data Flow:**
 * 1. Dataset store fetches revision → all testcases
 * 2. Entity atoms hydrated from revision data
 * 3. Drawer edits → entity atoms
 * 4. Save → collects from entity atoms → creates new revision
 * 5. Refetch → re-hydrates entity atoms
 *
 * @component
 */
export function TestcasesTableNew({mode = "edit"}: TestcasesTableNewProps) {
    const router = useRouter()
    const {testset_id: revisionIdParam} = router.query
    const {projectURL} = useURL()
    const _screens = Grid.useBreakpoint()

    // Global state
    const _projectId = useAtomValue(projectIdAtom)
    const setRevisionId = useSetAtom(testcasesRevisionIdAtom)
    const [searchTerm, setSearchTerm] = useAtom(testcasesSearchTermAtom)

    // Row height using generic IVT system
    const rowHeight = useRowHeight(testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG)

    // Local state
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])
    const [editingTestcaseId, setEditingTestcaseId] = useState<string | null>(null)
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false)
    const [isCommitModalOpen, setIsCommitModalOpen] = useState(false)
    const [isAddColumnModalOpen, setIsAddColumnModalOpen] = useState(false)
    const [newColumnName, setNewColumnName] = useState("")
    const [isIdCopied, setIsIdCopied] = useState(false)
    // Local state for edit modal (to allow cancel without saving)
    const [editModalName, setEditModalName] = useState("")
    const [editModalDescription, setEditModalDescription] = useState("")

    // Track programmatic navigation after save to skip blocker
    const skipBlockerRef = useRef(false)

    // Sync revisionId from URL to atom
    useEffect(() => {
        setRevisionId(revisionIdParam as string)
    }, [revisionIdParam, setRevisionId])

    // Main table hook (for mutations and metadata)
    const table = useTestcasesTable({
        revisionId: revisionIdParam as string,
    })

    // Breadcrumbs
    useBreadcrumbsEffect(
        {
            breadcrumbs: {
                testsets: {label: "testsets", href: `${projectURL}/testsets`},
                "testset-detail": {label: table.testsetName, value: revisionIdParam as string},
            },
            condition: Boolean(projectURL),
        },
        [table.testsetName, router.asPath, projectURL],
    )

    // Block navigation if unsaved changes (skip if programmatic navigation after save)
    useBlockNavigation(
        table.hasUnsavedChanges,
        {
            title: "Unsaved changes",
            message:
                "You have unsaved changes in your testset. Do you want to see these changes before leaving the page?",
            okText: "Save",
            onOk: async () => {
                await handleSaveTestset()
                return true
            },
            cancelText: "Cancel",
            thirdButtonText: "Discard changes",
            onThirdButton: async () => {
                table.clearChanges()
            },
        },
        () => {
            // Skip blocker if we're doing programmatic navigation after save
            if (skipBlockerRef.current) {
                skipBlockerRef.current = false
                return false
            }
            return true
        },
    )

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

    // Pagination - use real callbacks from hook
    // Note: rowRefs contains {id, key, __isNew} - cells read data from entity atoms
    const tablePagination = useMemo(
        () => ({
            rows: table.rowRefs,
            loadNextPage: table.loadNextPage,
            resetPages: table.resetPages,
        }),
        [table.rowRefs, table.loadNextPage, table.resetPages],
    )

    // Get the global Jotai store so entity atoms are accessible inside the table
    const globalStore = useMemo(() => getDefaultStore(), [])

    // Row selection configuration with dirty indicator
    const rowSelection = useMemo(
        () =>
            mode === "edit"
                ? {
                      selectedRowKeys,
                      onChange: setSelectedRowKeys,
                      columnWidth: 48,
                      onCell: (record: TestcaseTableRow) => {
                          // Use isTestcaseDirtyAtomFamily which compares entity data vs server cache
                          // This correctly handles column renames with infinite scrolling
                          if (record.id) {
                              const isDirty = globalStore.get(isTestcaseDirtyAtomFamily(record.id))
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
        [mode, selectedRowKeys, globalStore],
    )

    // Handlers
    const handleOpenCommitModal = useCallback(() => {
        setIsCommitModalOpen(true)
    }, [])

    const handleCommit = useCallback(
        async (commitMessage: string) => {
            try {
                const newRevisionId = await table.saveTestset(commitMessage)
                if (newRevisionId) {
                    message.success("A new revision has been created")
                    setSelectedRowKeys([])
                    setIsCommitModalOpen(false)

                    // Navigate to the new revision URL
                    if (newRevisionId !== revisionIdParam) {
                        // Skip the navigation blocker for this programmatic navigation
                        skipBlockerRef.current = true
                        router.replace(`${projectURL}/testsets/${newRevisionId}`, undefined, {
                            shallow: false,
                        })
                    }
                }
            } catch (error) {
                console.error("Failed to save testset:", error)
                message.error("Failed to save changes")
            }
        },
        [table, revisionIdParam, router, projectURL],
    )

    const handleSaveTestset = useCallback(async () => {
        // Open commit modal instead of saving directly
        handleOpenCommitModal()
    }, [handleOpenCommitModal])

    const handleAddTestcase = useCallback(() => {
        const newRow = table.addTestcase()
        if (newRow.id) {
            setEditingTestcaseId(newRow.id)
        }
    }, [table])

    const handleDeleteSelected = useCallback(() => {
        if (selectedRowKeys.length === 0) return

        table.deleteTestcases(selectedRowKeys.map(String))
        setSelectedRowKeys([])
        message.success(`Deleted ${selectedRowKeys.length} testcase(s). Save to apply changes.`)
    }, [selectedRowKeys, table])

    const handleRowClick = useCallback((record: TestcaseTableRow) => {
        if (record.id) {
            setEditingTestcaseId(record.id)
        }
    }, [])

    const handleAddColumn = useCallback(() => {
        if (newColumnName.trim()) {
            const success = table.addColumn(newColumnName.trim())
            if (success) {
                setNewColumnName("")
                setIsAddColumnModalOpen(false)
                message.success("Column added. Save to apply changes.")
            } else {
                message.error("Column name already exists")
            }
        }
    }, [newColumnName, table])

    // Parse CSV text into array of objects
    const parseCSV = useCallback((text: string): Record<string, unknown>[] => {
        const lines = text.split("\n").filter((line) => line.trim())
        if (lines.length === 0) return []

        const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""))
        const rows: Record<string, unknown>[] = []

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""))
            const row: Record<string, unknown> = {}
            headers.forEach((header, idx) => {
                row[header] = values[idx] || ""
            })
            rows.push(row)
        }

        return rows
    }, [])

    const handleAppendFromFile = useCallback(
        async (file: File) => {
            try {
                const text = await file.text()
                const extension = file.name.split(".").pop()?.toLowerCase()
                let rows: Record<string, unknown>[] = []

                if (extension === "json") {
                    const parsed = JSON.parse(text)
                    if (Array.isArray(parsed)) {
                        rows = parsed
                    }
                } else if (extension === "csv") {
                    rows = parseCSV(text)
                } else {
                    message.error("Unsupported file format. Please use CSV or JSON.")
                    return
                }

                if (rows.length === 0) {
                    message.warning("No data found in file")
                    return
                }

                const addedCount = table.appendTestcases(rows)
                const skippedCount = rows.length - addedCount

                if (addedCount > 0) {
                    message.success(
                        `Added ${addedCount} row(s).${skippedCount > 0 ? ` ${skippedCount} duplicate(s) skipped.` : ""} Save to apply changes.`,
                    )
                } else {
                    message.warning("All rows were duplicates and skipped.")
                }
            } catch (error) {
                console.error("Error parsing file:", error)
                message.error("Failed to parse file. Please check the format.")
            }
        },
        [table, parseCSV],
    )

    const handleCopyId = useCallback(async () => {
        if (!revisionIdParam) return
        await copyToClipboard(revisionIdParam as string, false)
        setIsIdCopied(true)
        setTimeout(() => setIsIdCopied(false), 2000)
    }, [revisionIdParam])

    const handleDiscardChanges = useCallback(() => {
        if (!table.hasUnsavedChanges) return

        AlertPopup({
            title: "Discard changes",
            message:
                "Are you sure you want to discard all unsaved changes? This action cannot be undone.",
            okText: "Discard",
            okButtonProps: {danger: true},
            onOk: () => {
                table.clearChanges()
                // No need to refetch - clearChanges resets entity store and hydrated IDs,
                // so data will re-hydrate from existing React Query cache
                message.success("Changes discarded")
            },
        })
    }, [table])

    const handleRenameConfirm = useCallback(() => {
        // Apply changes from modal state to table state
        table.setTestsetName(editModalName)
        table.setDescription(editModalDescription)
        setIsRenameModalOpen(false)
    }, [editModalName, editModalDescription, table])

    // Drawer navigation
    const editingRowIndex = useMemo(() => {
        if (!editingTestcaseId) return -1
        return table.testcaseIds.findIndex((id) => id === editingTestcaseId)
    }, [editingTestcaseId, table.testcaseIds])

    const handlePreviousTestcase = useCallback(() => {
        if (editingRowIndex > 0) {
            setEditingTestcaseId(table.testcaseIds[editingRowIndex - 1])
        }
    }, [editingRowIndex, table.testcaseIds])

    const handleNextTestcase = useCallback(() => {
        if (editingRowIndex < table.testcaseIds.length - 1) {
            setEditingTestcaseId(table.testcaseIds[editingRowIndex + 1])
        }
    }, [editingRowIndex, table.testcaseIds])

    // Max lines from row height config (already computed by useRowHeight)
    const maxLinesForRowHeight = rowHeight.maxLines

    // Columns definition
    // Use TestcaseCell for entity-aware rendering (reads from entity atoms in global store)
    const columns = useMemo(() => {
        const isEditable = mode === "edit"
        const dataColumns = table.columns.map((col) => ({
            type: "text" as const,
            key: col.key,
            title: isEditable ? (
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

        return createStandardColumns<TestcaseTableRow>([
            ...dataColumns,
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
                            if (record.id) setEditingTestcaseId(record.id)
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
    }, [table.columns, table, mode, maxLinesForRowHeight])

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
            onDelete: handleDeleteSelected,
            disabled: selectedRowKeys.length === 0 || mode === "view",
            disabledTooltip: "Select testcases to delete",
        }),
        [handleDeleteSelected, selectedRowKeys.length, mode],
    )

    // Table props
    const tableProps = useMemo(
        () => ({
            size: "small" as const,
            bordered: true,
            onRow: (record: TestcaseTableRow) => ({
                onClick: () => handleRowClick(record),
                className: `cursor-pointer hover:bg-gray-50 ${
                    String(record.key).startsWith("new-")
                        ? "bg-green-50 border-l-2 border-l-green-500"
                        : ""
                }`,
            }),
        }),
        [handleRowClick],
    )

    // Header title
    // Revision selector dropdown items
    const revisionMenuItems = useMemo(() => {
        return table.availableRevisions
            .filter((revision) => revision.version > 0)
            .sort((a, b) => b.version - a.version)
            .map((revision) => ({
                key: revision.id,
                label: (
                    <div className="flex flex-col gap-0.5 py-1">
                        <div className="flex items-center gap-2">
                            <span className="font-medium">v{revision.version}</span>
                            {revision.created_at && (
                                <Typography.Text type="secondary" className="text-xs">
                                    {new Date(revision.created_at).toLocaleDateString()}
                                </Typography.Text>
                            )}
                        </div>
                        {revision.message && (
                            <Typography.Text
                                type="secondary"
                                className="text-xs truncate max-w-[200px]"
                                title={revision.message}
                            >
                                {revision.message}
                            </Typography.Text>
                        )}
                        {revision.author && (
                            <div className="text-xs">
                                <UserReference userId={revision.author} />
                            </div>
                        )}
                    </div>
                ),
                onClick: () =>
                    router.push(`${projectURL}/testsets/${revision.id}`, undefined, {
                        shallow: true,
                    }),
            }))
    }, [table.availableRevisions, router, projectURL])

    // Check if this is the only revision (disable delete if so)
    // v0 is not a valid revision, so we filter it out when counting
    const validRevisions = table.availableRevisions.filter((r) => r.version > 0)
    const isOnlyRevision = validRevisions.length <= 1

    // Handle delete revision
    const handleDeleteRevision = useCallback(async () => {
        if (!revisionIdParam || isOnlyRevision) return

        Modal.confirm({
            title: "Delete Revision",
            content: `Are you sure you want to delete revision v${table.metadata?.revisionVersion}? This action cannot be undone.`,
            okText: "Delete",
            okButtonProps: {danger: true},
            onOk: async () => {
                try {
                    const {archiveTestsetRevision} = await import("@/oss/services/testsets/api")
                    await archiveTestsetRevision(revisionIdParam as string)
                    message.success("Revision deleted successfully")

                    // Navigate to the latest revision
                    const latestRevision = table.availableRevisions
                        .filter((r) => r.id !== revisionIdParam)
                        .sort((a, b) => b.version - a.version)[0]

                    if (latestRevision) {
                        router.replace(`${projectURL}/testsets/${latestRevision.id}`)
                    } else {
                        // No revisions left, go back to testsets list
                        router.replace(`${projectURL}/testsets`)
                    }
                } catch (error) {
                    console.error("Failed to delete revision:", error)
                    message.error("Failed to delete revision")
                }
            },
        })
    }, [
        revisionIdParam,
        isOnlyRevision,
        table.metadata?.revisionVersion,
        table.availableRevisions,
        router,
        projectURL,
    ])

    // Header actions dropdown menu items
    const headerActionsMenuItems = useMemo(
        () => [
            {
                key: "edit-details",
                label: "Edit name & description",
                icon: <PencilSimple size={16} />,
                onClick: () => {
                    // Initialize modal state with current values
                    setEditModalName(table.testsetName)
                    setEditModalDescription(table.description)
                    setIsRenameModalOpen(true)
                },
            },
            {
                key: "delete-revision",
                label: "Delete revision",
                icon: <Trash size={16} />,
                danger: true,
                disabled: isOnlyRevision,
                onClick: handleDeleteRevision,
            },
        ],
        [table.testsetName, table.description, isOnlyRevision, handleDeleteRevision],
    )

    // Tooltip for ID copy
    const tooltipTitle = isIdCopied ? "Copied!" : "Click to copy ID"

    const headerTitle = useMemo(
        () => (
            <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                    <Typography.Title level={3} style={{margin: 0}}>
                        {table.testsetName || "Testset"}
                    </Typography.Title>
                    <Dropdown
                        menu={{
                            items: revisionMenuItems,
                            style: {maxHeight: 400, overflowY: "auto"},
                        }}
                        trigger={["click"]}
                        disabled={table.loadingRevisions || revisionMenuItems.length === 0}
                    >
                        <Button size="small" className="flex items-center gap-1">
                            v{table.metadata?.revisionVersion ?? "#"}
                            <DownOutlined style={{fontSize: 10}} />
                        </Button>
                    </Dropdown>
                    <Tooltip title={tooltipTitle}>
                        <Tag
                            className="cursor-pointer flex items-center gap-1"
                            onClick={handleCopyId}
                        >
                            <Link size={14} weight="bold" />
                            <span>ID</span>
                        </Tag>
                    </Tooltip>
                    <Dropdown menu={{items: headerActionsMenuItems}} trigger={["click"]}>
                        <Button type="text" size="small" icon={<MoreOutlined />} />
                    </Dropdown>
                </div>
                <Popover
                    trigger="hover"
                    placement="bottomLeft"
                    content={
                        <div className="flex flex-col gap-2 max-w-xs">
                            {table.metadata?.commitMessage && (
                                <div>
                                    <Typography.Text type="secondary" className="block">
                                        Commit Message
                                    </Typography.Text>
                                    <Typography.Text>
                                        {table.metadata.commitMessage}
                                    </Typography.Text>
                                </div>
                            )}
                            {table.metadata?.author && (
                                <div>
                                    <Typography.Text type="secondary" className="block">
                                        Author
                                    </Typography.Text>
                                    <UserReference userId={table.metadata.author} />
                                </div>
                            )}
                            {table.metadata?.createdAt && (
                                <div>
                                    <Typography.Text type="secondary" className="block">
                                        Created
                                    </Typography.Text>
                                    <Typography.Text>
                                        {new Date(table.metadata.createdAt).toLocaleString()}
                                    </Typography.Text>
                                </div>
                            )}
                            {table.metadata?.updatedAt && (
                                <div>
                                    <Typography.Text type="secondary" className="block">
                                        Updated
                                    </Typography.Text>
                                    <Typography.Text>
                                        {new Date(table.metadata.updatedAt).toLocaleString()}
                                    </Typography.Text>
                                </div>
                            )}
                        </div>
                    }
                >
                    <span className="cursor-help">
                        <TableDescription>
                            {table.description ||
                                "Specify column names similar to the Input parameters. A column with 'correct_answer' name will be treated as a ground truth column."}
                        </TableDescription>
                    </span>
                </Popover>
            </div>
        ),
        [
            table.testsetName,
            table.description,
            table.loadingRevisions,
            table.metadata,
            revisionMenuItems,
            tooltipTitle,
            handleCopyId,
            headerActionsMenuItems,
        ],
    )

    // Filters
    const filters = useMemo(
        () => (
            <Input
                allowClear
                placeholder="Search testcases..."
                className="w-64"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
            />
        ),
        [searchTerm, setSearchTerm],
    )

    // Primary actions
    const primaryActions = useMemo(
        () => (
            <Space>
                {table.hasUnsavedChanges && (
                    <Button onClick={handleDiscardChanges} disabled={mode === "view"}>
                        Discard
                    </Button>
                )}
                <Button
                    onClick={handleAddTestcase}
                    icon={<PlusOutlined />}
                    disabled={mode === "view"}
                >
                    Row
                </Button>
                <Button
                    onClick={() => {
                        setNewColumnName("")
                        setIsAddColumnModalOpen(true)
                    }}
                    icon={<PlusOutlined />}
                    disabled={mode === "view"}
                >
                    Column
                </Button>
                <Button
                    type="primary"
                    onClick={handleSaveTestset}
                    loading={table.isSaving}
                    disabled={!table.hasUnsavedChanges || mode === "view"}
                >
                    Commit
                </Button>
            </Space>
        ),
        [
            handleSaveTestset,
            table.isSaving,
            table.hasUnsavedChanges,
            handleAddTestcase,
            handleDiscardChanges,
            handleAppendFromFile,
            mode,
        ],
    )

    // Loading state
    if (table.isLoading && table.rowRefs.length === 0) {
        return (
            <div className="flex flex-col h-full w-full p-6 gap-4">
                <Skeleton.Input active style={{width: 200, height: 32}} />
                <Skeleton active paragraph={{rows: 10}} />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full w-full overflow-hidden p-6">
            <InfiniteVirtualTableFeatureShell<TestcaseTableRow>
                datasetStore={testcasesDatasetStore}
                tableScope={tableScope}
                columns={columns}
                rowKey="key"
                title={headerTitle}
                filters={filters}
                primaryActions={primaryActions}
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
                pagination={tablePagination}
                useSettingsDropdown
                settingsDropdownMenuItems={rowHeight.menuItems}
                resizableColumns
                store={globalStore}
            />

            {/* Edit Drawer */}
            <TestcaseEditDrawer
                testcaseId={editingTestcaseId}
                columns={table.columns}
                open={!!editingTestcaseId}
                onClose={() => setEditingTestcaseId(null)}
                isNewRow={editingTestcaseId ? editingTestcaseId.startsWith("new-") : false}
                onPrevious={handlePreviousTestcase}
                onNext={handleNextTestcase}
                hasPrevious={editingRowIndex > 0}
                hasNext={editingRowIndex < table.testcaseIds.length - 1}
                testcaseNumber={editingRowIndex >= 0 ? editingRowIndex + 1 : undefined}
                onSaveTestset={table.saveTestset}
                isSavingTestset={table.isSaving}
            />

            {/* Rename Modal */}
            <Modal
                title="Edit Testset Details"
                open={isRenameModalOpen}
                onOk={handleRenameConfirm}
                onCancel={() => setIsRenameModalOpen(false)}
                okText="Save"
            >
                <div className="flex flex-col gap-4">
                    <div>
                        <Typography.Text strong className="block mb-1">
                            Name
                        </Typography.Text>
                        <Input
                            value={editModalName}
                            onChange={(e) => setEditModalName(e.target.value)}
                            placeholder="Testset name"
                            autoFocus
                        />
                    </div>
                    <div>
                        <Typography.Text strong className="block mb-1">
                            Description
                        </Typography.Text>
                        <Input.TextArea
                            value={editModalDescription}
                            onChange={(e) => setEditModalDescription(e.target.value)}
                            placeholder="Testset description (optional)"
                            rows={3}
                        />
                    </div>
                </div>
            </Modal>

            {/* Commit Modal */}
            <CommitTestsetModal
                open={isCommitModalOpen}
                onCancel={() => setIsCommitModalOpen(false)}
                onCommit={handleCommit}
                isCommitting={table.isSaving}
                currentVersion={table.metadata?.revisionVersion}
                latestVersion={Math.max(
                    0,
                    ...table.availableRevisions.map((r) => Number(r.version)),
                )}
                changesSummary={isCommitModalOpen ? table.changesSummary : undefined}
            />

            {/* Add Column Modal */}
            <Modal
                title="Add Column"
                open={isAddColumnModalOpen}
                onOk={handleAddColumn}
                onCancel={() => setIsAddColumnModalOpen(false)}
                okText="Add"
                okButtonProps={{disabled: !newColumnName.trim()}}
                destroyOnHidden
            >
                <div className="py-2">
                    <Typography.Text className="block mb-2">Column name:</Typography.Text>
                    <Input
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        placeholder="Enter column name"
                        autoFocus
                        onPressEnter={handleAddColumn}
                    />
                </div>
            </Modal>
        </div>
    )
}

export default TestcasesTableNew
