import {useCallback, useEffect, useMemo, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {PlusOutlined} from "@ant-design/icons"
import {ArchiveIcon, CaretDown, DownloadSimple} from "@phosphor-icons/react"
import {Button, Dropdown, Space} from "antd"
import clsx from "clsx"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useTableActions,
} from "@/oss/components/InfiniteVirtualTable"
import TestsetsHeaderFilters from "@/oss/components/TestsetsTable/components/TestsetsHeaderFilters"
import {useProjectPermissions} from "@/oss/hooks/useProjectPermissions"
import useURL from "@/oss/hooks/useURL"
import {
    onboardingWidgetActivationAtom,
    setOnboardingWidgetActivationAtom,
} from "@/oss/lib/onboarding"
import type {TestsetCreationMode} from "@/oss/lib/Types"
import {
    downloadTestset,
    downloadRevision,
    unarchiveTestset,
    type ExportFileType,
} from "@/oss/services/testsets/api"
import {
    fetchRevisionsList,
    getTestsetTableState,
    invalidateTestsetManagementQueries,
    invalidateTestsetsListCache,
    testset,
    type TestsetTableMode,
    type TestsetTableRow,
} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project"

import {
    createTestsetsColumns,
    type TestsetsTableColumnActions,
} from "./assets/createTestsetsColumns"

const TestsetModal: any = dynamic(() => import("@/oss/components/pages/testset/modals"))
const DeleteTestsetModal: any = dynamic(
    () => import("@/oss/components/pages/testset/modals/DeleteTestset"),
)

export interface TestsetsTableProps {
    /** Optional unique scope ID for table state (selection, pagination, etc.) */
    scopeId?: string
    className?: string
    autoHeight?: boolean
    /**
     * Table interaction mode.
     * - "manage" (default): clicking rows navigates to the testset/revision page.
     * - "select": clicking a revision row calls `onSelectRevision` instead of navigating.
     */
    mode?: "manage" | "select"
    tableMode?: TestsetTableMode
    /** Callback invoked when a revision row is selected in `mode="select"`. */
    onSelectRevision?: (params: {
        revisionId: string
        testsetId: string
        testsetName: string
        version?: number | null
    }) => void
    /**
     * Currently selected testset revision id in select mode.
     * Used to clear row highlight when the parent clears selection.
     */
    selectedRevisionId?: string
}

/**
 * Reusable Testsets table built on InfiniteVirtualTable
 *
 * Renders Testset → Revision hierarchy using the git-based testsets API.
 * This component is designed to be reused both on the standalone Testsets page
 * and in other contexts (e.g. selection inside the New Evaluation modal).
 */
const TestsetsTable = ({
    scopeId = "testsets-page",
    className,
    autoHeight = true,
    mode = "manage",
    tableMode = "active",
    onSelectRevision,
    selectedRevisionId,
}: TestsetsTableProps) => {
    const router = useRouter()
    const {projectURL} = useURL()
    const {canExportData} = useProjectPermissions()
    const projectId = useAtomValue(projectIdAtom)
    const onboardingWidgetActivation = useAtomValue(onboardingWidgetActivationAtom)
    const setOnboardingWidgetActivation = useSetAtom(setOnboardingWidgetActivationAtom)
    const tableState = getTestsetTableState(tableMode)
    const isArchivedView = tableMode === "archived"

    // Refresh trigger for the table
    const setRefreshTrigger = useSetAtom(tableState.paginatedStore.refreshAtom)

    // Modal state
    const [isCreateTestsetModalOpen, setIsCreateTestsetModalOpen] = useState(false)
    const [testsetCreationMode, setTestsetCreationMode] = useState<TestsetCreationMode>("create")
    const [editTestsetValues, setEditTestsetValues] = useState<TestsetTableRow | null>(null)
    const [current, setCurrent] = useState(0)
    const [selectedTestsetToDelete, setSelectedTestsetToDelete] = useState<TestsetTableRow[]>([])
    const [isDeleteTestsetModalOpen, setIsDeleteTestsetModalOpen] = useState(false)

    useEffect(() => {
        if (isArchivedView || onboardingWidgetActivation !== "create-testset") return
        setTestsetCreationMode("create")
        setEditTestsetValues(null)
        setCurrent(0)
        setIsCreateTestsetModalOpen(true)
        setOnboardingWidgetActivation(null)
    }, [
        onboardingWidgetActivation,
        setOnboardingWidgetActivation,
        setCurrent,
        setEditTestsetValues,
        setIsCreateTestsetModalOpen,
        setTestsetCreationMode,
        isArchivedView,
    ])

    // Refresh table data
    const mutate = useCallback(() => {
        setRefreshTrigger()
    }, [setRefreshTrigger])

    // Track expanded rows and their loaded children
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])
    const [loadingRows, setLoadingRows] = useState<Set<string>>(new Set())
    const [childrenCache, setChildrenCache] = useState<Map<string, TestsetTableRow[]>>(new Map())

    const isSelectMode = mode === "select"
    const isManageMode = !isSelectMode
    const [selectedRowKey, setSelectedRowKey] = useState<string | null>(null)

    // Custom row click handler that navigates to revisions
    const handleRowClick = useCallback(
        async (record: TestsetTableRow) => {
            const isRevision = (record as any).__isRevision

            // Selection mode: emit revision selection instead of navigating
            if (isSelectMode) {
                const rowKey = String(record.key)

                // Toggle local row highlight based on what the user clicked
                setSelectedRowKey((prev) => (prev === rowKey ? null : rowKey))

                if (isRevision) {
                    const testsetId =
                        (record as any).__testsetId || (record as any).__parentId || record.id
                    const version = (record as any).__version ?? null

                    onSelectRevision?.({
                        revisionId: record.id,
                        testsetId,
                        testsetName: record.name,
                        version,
                    })
                    return
                }

                // Testset row selection -> select latest revision for that testset
                const selectFromRevision = (revision: {id: string; version?: number | null}) => {
                    if (!revision) return
                    onSelectRevision?.({
                        revisionId: revision.id,
                        testsetId: record.id,
                        testsetName: record.name,
                        version: revision.version ?? null,
                    })
                }

                // Prefer cached children (already-fetched revisions)
                const cachedChildren = childrenCache.get(String(record.key))
                if (cachedChildren && cachedChildren.length > 0) {
                    const latestRow = cachedChildren[0]
                    selectFromRevision({
                        id: latestRow.id,
                        version: (latestRow as any).__version ?? null,
                    })
                    return
                }

                // Fallback: fetch revisions to find latest
                try {
                    if (!projectId) return
                    const response = await fetchRevisionsList({
                        projectId,
                        testsetId: record.id,
                        includeArchived: isArchivedView,
                    })
                    // Filter out v0 revisions - they are placeholders
                    const revisions = response.testset_revisions.filter(
                        (r: any) => r.version !== 0 && r.version !== "0",
                    )
                    if (revisions.length > 0) {
                        const latestRevision = revisions[0]
                        const numericVersion =
                            latestRevision.version != null ? Number(latestRevision.version) : null
                        selectFromRevision({
                            id: latestRevision.id,
                            version: numericVersion,
                        })
                    }
                } catch (error) {
                    console.error("[TestsetsTable] Failed to fetch revisions for selection:", error)
                }

                return
            }

            // If it's a revision, navigate to it directly
            if (isRevision) {
                router.push(`${projectURL}/testsets/${record.id}`)
                return
            }

            // If it's a testset, navigate to the latest revision
            // First check if we have cached children
            const cachedChildren = childrenCache.get(String(record.key))
            if (cachedChildren && cachedChildren.length > 0) {
                // Navigate to the first child (latest revision)
                const latestRevision = cachedChildren[0]
                router.push(`${projectURL}/testsets/${latestRevision.id}`)
                return
            }

            // Otherwise, fetch revisions to get the latest one
            try {
                if (!projectId) return
                const response = await fetchRevisionsList({
                    projectId,
                    testsetId: record.id,
                    includeArchived: isArchivedView,
                })
                // Filter out v0 revisions - they are placeholders
                const revisions = response.testset_revisions.filter(
                    (r: any) => r.version !== 0 && r.version !== "0",
                )
                if (revisions.length > 0) {
                    // Navigate to the first revision (latest)
                    router.push(`${projectURL}/testsets/${revisions[0].id}`)
                }
            } catch (error) {
                console.error("[TestsetsTable] Failed to fetch revisions for navigation:", error)
            }
        },
        [
            projectURL,
            childrenCache,
            isSelectMode,
            onSelectRevision,
            router,
            projectId,
            isArchivedView,
        ],
    )

    // Action handlers - consolidated
    const actions = useTableActions<TestsetTableRow>({
        baseUrl: `${projectURL}/testsets`,
        onClone: (record) => {
            setTestsetCreationMode("clone")
            setEditTestsetValues(record)
            setCurrent(1)
            setIsCreateTestsetModalOpen(true)
        },
        onRename: (record) => {
            setTestsetCreationMode("rename")
            setEditTestsetValues(record)
            setCurrent(1)
            setIsCreateTestsetModalOpen(true)
        },
        onDelete: (record) => {
            setSelectedTestsetToDelete([record])
            setIsDeleteTestsetModalOpen(true)
        },
        onCreate: () => setIsCreateTestsetModalOpen(true),
        getRecordId: (record) => record.id,
    })

    // Handler for deleting a revision
    const handleDeleteRevision = useCallback(
        async (record: TestsetTableRow) => {
            const version = (record as any).__version
            const testsetId = (record as any).__testsetId

            // Check if this is the only non-v0 revision
            const cachedChildren = childrenCache.get(testsetId)
            const validRevisions = cachedChildren?.filter((r) => (r as any).__version !== 0) || []

            if (validRevisions.length <= 1) {
                message.warning("Cannot archive the only revision. Archive the testset instead.")
                return
            }

            setSelectedTestsetToDelete([
                {
                    ...record,
                    __isRevision: true,
                    __version: version,
                    __testsetId: testsetId,
                },
            ])
            setIsDeleteTestsetModalOpen(true)
        },
        [childrenCache],
    )

    // State for tracking which row is being exported
    const [exportingRowKey, setExportingRowKey] = useState<string | null>(null)

    // Export format preference (persisted in localStorage)
    const [exportFormat, setExportFormat] = useAtom(testset.filters.exportFormat)

    // Handler to export a testset or revision using the backend endpoint
    const handleExportTestset = useCallback(
        async (record: TestsetTableRow, format: ExportFileType) => {
            if (!canExportData) return
            const isRevision = (record as any).__isRevision
            const version = (record as any).__version
            const sanitizedName = record.name.replace(/[^a-zA-Z0-9-_]/g, "-")
            const exportKey = `export-${String(record.key)}`

            setExportingRowKey(String(record.key))
            // Show immediate feedback that action was triggered
            message.info(`Starting ${format.toUpperCase()} export for "${record.name}"...`)
            // Show persistent loading message
            message.loading({
                content: "Preparing export. This may take a moment for large testsets...",
                key: exportKey,
                duration: 0, // Don't auto-dismiss
            })

            try {
                if (isRevision) {
                    // For revision rows, download the specific revision
                    const filename = `${sanitizedName}-v${version}.${format}`
                    await downloadRevision(record.id, format, filename)
                    message.success({
                        content: `Revision v${version} exported as ${format.toUpperCase()}`,
                        key: exportKey,
                    })
                } else {
                    // For testset rows, download the latest revision
                    const filename = `${sanitizedName}.${format}`
                    await downloadTestset(record.id, format, filename)
                    message.success({
                        content: `Testset exported as ${format.toUpperCase()}`,
                        key: exportKey,
                    })
                }
                // Update format preference when user explicitly chooses a format
                setExportFormat(format)
            } catch (error) {
                console.error("[TestsetsTable] Failed to export:", error)
                message.error({
                    content: "Failed to export",
                    key: exportKey,
                })
            } finally {
                setExportingRowKey(null)
            }
        },
        [canExportData, setExportFormat],
    )

    // Table manager - consolidates pagination, selection, row handlers, export, delete buttons
    const table = useTableManager<TestsetTableRow>({
        datasetStore: tableState.paginatedStore.store,
        scopeId: isArchivedView ? "archived-testsets-page" : scopeId,
        pageSize: 50,
        rowHeight: 48,
        onRowClick: handleRowClick,
        rowClassName: "testsets-table__row",
        columnVisibilityStorageKey: isArchivedView
            ? "agenta:archived-testsets:column-visibility"
            : "agenta:testsets:column-visibility",
        exportFilename: isArchivedView ? "archived-testsets.csv" : "testsets.csv",
        exportDisabledTooltip: "Select testsets to export",
    })

    const handleRestoreTestset = useCallback(
        async (record: TestsetTableRow) => {
            try {
                await unarchiveTestset(record.id)
                invalidateTestsetsListCache()
                invalidateTestsetManagementQueries()
                setChildrenCache((prev) => {
                    const next = new Map(prev)
                    next.delete(String(record.key))
                    return next
                })
                table.clearSelection()
                message.success("Testset restored")
            } catch (error) {
                console.error("[TestsetsTable] Failed to restore testset:", error)
                message.error("Failed to restore testset")
            }
        },
        [table],
    )

    // Build rows with children for tree data (supports nested children)
    const rowsWithChildren = useMemo(() => {
        // Helper to recursively add children from cache
        const addChildren = (row: TestsetTableRow): TestsetTableRow => {
            // Use row.key for cache lookup (matches expandedRowKeys)
            const children = childrenCache.get(String(row.key))
            if (children && children.length > 0) {
                // Recursively add children to each child row
                const childrenWithNested = children.map(addChildren)
                return {...row, children: childrenWithNested}
            }
            return row
        }

        return table.rows.map(addChildren)
    }, [table.rows, childrenCache])

    // Custom getSelectedRecords that includes both testsets and revisions from childrenCache
    const getSelectedRecords = useCallback(() => {
        const selectedKeys = table.selectedRowKeys
        const records: TestsetTableRow[] = []

        // Check main rows (testsets)
        for (const row of table.rows) {
            if (selectedKeys.includes(row.key)) {
                records.push(row)
            }
        }

        // Check children (revisions) from cache
        for (const children of childrenCache.values()) {
            for (const child of children) {
                if (selectedKeys.includes(child.key)) {
                    records.push(child)
                }
            }
        }

        return records
    }, [table.selectedRowKeys, table.rows, childrenCache])

    // Tree expand handler - fetch revisions as children
    const handleExpand = useCallback(
        async (expanded: boolean, record: TestsetTableRow) => {
            // Use record.key for expandedRowKeys (matches rowKey extractor)
            const rowKey = String(record.key)
            const isRevision = (record as any).__isRevision

            // Revisions cannot be expanded
            if (isRevision) return

            if (expanded) {
                setExpandedRowKeys((prev) => [...prev, rowKey])

                // If already cached, no need to fetch
                if (childrenCache.has(rowKey)) return

                setLoadingRows((prev) => new Set(prev).add(rowKey))
                try {
                    // Fetch revisions directly for this testset (skip variants)
                    if (!projectId) return
                    const response = await fetchRevisionsList({
                        projectId,
                        testsetId: record.id,
                        includeArchived: isArchivedView,
                    })
                    // Filter out v0 revisions - they are placeholders and should not be displayed
                    const revisions = response.testset_revisions.filter(
                        (r: any) => r.version !== 0 && r.version !== "0",
                    )
                    const childRows: TestsetTableRow[] = revisions.map((revision: any) => ({
                        key: `${record.id}-${revision.id}`,
                        id: revision.id,
                        name: record.name,
                        created_at: revision.created_at,
                        updated_at: revision.updated_at || revision.created_at,
                        created_by_id: revision.created_by_id,
                        deletedAt: record.deletedAt ?? null,
                        deletedById: record.deletedById ?? null,
                        __isSkeleton: false,
                        __isRevision: true,
                        __parentId: record.id,
                        __testsetId: record.id,
                        // Normalize version to a number so consumers don't have to
                        __version: revision.version != null ? Number(revision.version) : null,
                        __commitMessage: revision.message,
                    }))
                    setChildrenCache((prev) => new Map(prev).set(rowKey, childRows))
                } catch (error) {
                    console.error("[TestsetsTable] Failed to fetch revisions:", error)
                } finally {
                    setLoadingRows((prev) => {
                        const next = new Set(prev)
                        next.delete(rowKey)
                        return next
                    })
                }
            } else {
                setExpandedRowKeys((prev) => prev.filter((k) => k !== rowKey))
            }
        },
        [childrenCache, projectId, isArchivedView],
    )

    const columnActions = useMemo<TestsetsTableColumnActions>(
        () => ({
            onOpen: handleRowClick,
            onClone: actions.handleClone,
            onRename: actions.handleRename,
            onDelete: actions.handleDelete,
            onDeleteRevision: handleDeleteRevision,
            onRestore: handleRestoreTestset,
            onExport: handleExportTestset,
        }),
        [actions, handleExportTestset, handleDeleteRevision, handleRestoreTestset, handleRowClick],
    )

    const columns = useMemo(
        () =>
            createTestsetsColumns(columnActions, {
                mode: tableMode,
                interactionMode: mode,
                canExportData,
                exportingRowKey,
                expandState: {
                    expandedRowKeys,
                    loadingRows,
                    onToggleExpand: (record, expanded) => handleExpand(expanded, record),
                },
            }),
        [
            canExportData,
            columnActions,
            expandedRowKeys,
            exportingRowKey,
            handleExpand,
            loadingRows,
            mode,
            tableMode,
        ],
    )

    // Update columns ref for export
    useEffect(() => {
        table.columnsRef.current = columns
    }, [columns, table.columnsRef])

    const filtersNode = useMemo(() => <TestsetsHeaderFilters tableMode={tableMode} />, [tableMode])

    const createButton = useMemo(
        () => (
            <Button
                type="primary"
                icon={<PlusOutlined className="mt-[1px]" />}
                onClick={actions.handleCreate}
            >
                Create new testset
            </Button>
        ),
        [actions.handleCreate],
    )

    const primaryActions = useMemo(() => {
        if (!isManageMode || isArchivedView) return undefined

        return (
            <Space>
                <Button
                    type="text"
                    icon={<ArchiveIcon size={14} />}
                    onClick={() => router.push(`${projectURL}/testsets/archived`)}
                >
                    Archived
                </Button>
                {createButton}
            </Space>
        )
    }, [createButton, isArchivedView, isManageMode, projectURL, router])

    // Smart export button with dropdown - remembers last used format
    const renderExportButton = useCallback(
        ({onExport, loading}: {onExport: () => void; loading: boolean}) => {
            // Use custom getSelectedRecords that includes both testsets and revisions
            const selectedRecords = getSelectedRecords()
            const disabled = !selectedRecords.length

            const handleExport = async (format: ExportFileType) => {
                // Export all selected records (testsets and/or revisions)
                for (const record of selectedRecords) {
                    await handleExportTestset(record, format)
                }
                // Update preference
                setExportFormat(format)
            }

            const menuItems = [
                {
                    key: "csv",
                    label: "Export as CSV",
                    icon: <DownloadSimple size={16} />,
                    onClick: () => handleExport("csv"),
                },
                {
                    key: "json",
                    label: "Export as JSON",
                    icon: <DownloadSimple size={16} />,
                    onClick: () => handleExport("json"),
                },
            ]

            // Smart button: clicking the main button uses the last format, dropdown allows choosing
            return (
                <Space.Compact>
                    <Button
                        onClick={() => handleExport(exportFormat)}
                        loading={loading}
                        disabled={disabled}
                        icon={<DownloadSimple size={16} />}
                    >
                        Export {exportFormat.toUpperCase()}
                    </Button>
                    <Dropdown menu={{items: menuItems}} disabled={disabled}>
                        <Button disabled={disabled} icon={<CaretDown size={14} />} />
                    </Dropdown>
                </Space.Compact>
            )
        },
        [getSelectedRecords, handleExportTestset, exportFormat, setExportFormat],
    )

    // Keep row highlight in sync with parent when selection is cleared
    useEffect(() => {
        if (!isSelectMode) return
        if (!selectedRevisionId) {
            setSelectedRowKey(null)
        }
    }, [isSelectMode, selectedRevisionId])

    // Tree data expandable config - Ant Design handles children rendering
    const treeExpandable = useMemo(
        () => ({
            expandedRowKeys,
            onExpand: handleExpand,
            // Hide default expand column - we render icon in Name cell
            expandIcon: () => null,
        }),
        [expandedRowKeys, handleExpand],
    )

    const rowSelection = useMemo(() => {
        if (isSelectMode) {
            return {
                type: "checkbox" as const,
                selectedRowKeys: selectedRowKey ? [selectedRowKey] : [],
                getCheckboxProps: (record: TestsetTableRow) => ({
                    disabled: Boolean(record.__isSkeleton),
                }),
                onChange: (_selectedRowKeys: React.Key[], selectedRows: TestsetTableRow[]) => {
                    // When user clicks the radio button, trigger row click handler
                    if (selectedRows.length > 0) {
                        handleRowClick(selectedRows[0])
                    }
                },
                columnWidth: 48,
                fixed: true,
            }
        }
        return table.rowSelection
    }, [isSelectMode, selectedRowKey, table.rowSelection, handleRowClick])

    return (
        <div className={clsx("flex flex-col h-full min-h-0 grow w-full", className)}>
            <InfiniteVirtualTableFeatureShell<TestsetTableRow>
                {...table.shellProps}
                dataSource={rowsWithChildren}
                columns={columns}
                title={undefined}
                filters={filtersNode}
                primaryActions={primaryActions}
                rowSelection={rowSelection}
                deleteAction={undefined}
                enableExport={isArchivedView ? true : isManageMode && canExportData}
                exportAction={undefined}
                renderExportButton={
                    isManageMode && canExportData && !isArchivedView
                        ? renderExportButton
                        : undefined
                }
                tableProps={{
                    ...table.shellProps.tableProps,
                    expandable: treeExpandable,
                    onRow: (record, index) => {
                        const base = table.shellProps.tableProps?.onRow?.(record, index) ?? {}
                        return {
                            ...base,
                            "data-tour":
                                index === 0
                                    ? "testset-row"
                                    : (base as Record<string, unknown>)["data-tour"],
                        }
                    },
                }}
                tableClassName="agenta-testsets-table"
                className="flex-1 min-h-0"
                autoHeight={autoHeight}
            />

            {selectedTestsetToDelete.length > 0 && (
                <DeleteTestsetModal
                    selectedTestsetToDelete={selectedTestsetToDelete}
                    mutate={mutate}
                    setSelectedTestsetToDelete={setSelectedTestsetToDelete}
                    open={isDeleteTestsetModalOpen}
                    onCancel={() => {
                        setIsDeleteTestsetModalOpen(false)
                        table.clearSelection()
                    }}
                    onAfterDelete={({
                        testsets: deletedTestsets,
                        revisions: deletedRevisions,
                    }: {
                        testsets: TestsetTableRow[]
                        revisions: TestsetTableRow[]
                    }) => {
                        setChildrenCache((prev) => {
                            const newCache = new Map(prev)

                            // Remove cache entries for deleted testsets
                            for (const t of deletedTestsets) {
                                newCache.delete(t.id)
                            }

                            // Remove deleted revisions from their parent's cache
                            for (const r of deletedRevisions) {
                                const parentId = (r as any).__testsetId
                                if (parentId && newCache.has(parentId)) {
                                    const children = newCache.get(parentId)
                                    if (children) {
                                        newCache.set(
                                            parentId,
                                            children.filter((c) => c.id !== r.id),
                                        )
                                    }
                                }
                            }

                            return newCache
                        })
                    }}
                />
            )}

            {!isArchivedView && (
                <TestsetModal
                    editTestsetValues={editTestsetValues}
                    setEditTestsetValues={setEditTestsetValues}
                    current={current}
                    setCurrent={setCurrent}
                    testsetCreationMode={testsetCreationMode}
                    setTestsetCreationMode={setTestsetCreationMode}
                    open={isCreateTestsetModalOpen}
                    onCancel={() => {
                        setIsCreateTestsetModalOpen(false)
                    }}
                />
            )}
        </div>
    )
}

export default TestsetsTable
