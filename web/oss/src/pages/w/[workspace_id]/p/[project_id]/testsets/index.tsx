import {useCallback, useEffect, useMemo, useState} from "react"

import {
    MinusCircleOutlined,
    PlusCircleOutlined,
    PlusOutlined,
    LoadingOutlined,
} from "@ant-design/icons"
import {Copy, Note, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Tag, Typography} from "antd"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useTableActions,
    createStandardColumns,
    TableDescription,
} from "@/oss/components/InfiniteVirtualTable"
import {fetchTestsetRevisions} from "@/oss/components/TestsetsTable/atoms/fetchTestsetRevisions"
import {
    testsetsDatasetStore,
    testsetsRefreshTriggerAtom,
    type TestsetTableRow,
} from "@/oss/components/TestsetsTable/atoms/tableStore"
import TestsetsHeaderFilters from "@/oss/components/TestsetsTable/components/TestsetsHeaderFilters"
import useURL from "@/oss/hooks/useURL"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"
import type {TestsetCreationMode} from "@/oss/lib/Types"

const TestsetModal: any = dynamic(() => import("@/oss/components/pages/testset/modals"))
const DeleteTestsetModal: any = dynamic(
    () => import("@/oss/components/pages/testset/modals/DeleteTestset"),
)

const Testset = () => {
    const {projectURL} = useURL()

    // Refresh trigger for the table
    const setRefreshTrigger = useSetAtom(testsetsRefreshTriggerAtom)

    // Modal state
    const [isCreateTestsetModalOpen, setIsCreateTestsetModalOpen] = useState(false)
    const [testsetCreationMode, setTestsetCreationMode] = useState<TestsetCreationMode>("create")
    const [editTestsetValues, setEditTestsetValues] = useState<TestsetTableRow | null>(null)
    const [current, setCurrent] = useState(0)
    const [selectedTestsetToDelete, setSelectedTestsetToDelete] = useState<TestsetTableRow[]>([])
    const [isDeleteTestsetModalOpen, setIsDeleteTestsetModalOpen] = useState(false)

    useBreadcrumbsEffect({breadcrumbs: {testsets: {label: "testsets"}}}, [])

    // Refresh table data (will be used when modals are uncommented)
    const _refreshTable = () => setRefreshTrigger((prev) => prev + 1)

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

    // Table manager - consolidates pagination, selection, row handlers, export, delete buttons
    const table = useTableManager({
        datasetStore: testsetsDatasetStore,
        scopeId: "testsets-page",
        pageSize: 50,
        rowHeight: 48,
        onRowClick: actions.handleView,
        rowClassName: "testsets-table__row",
        exportFilename: "testsets.csv",
        exportDisabledTooltip: "Select testsets to export",
        onBulkDelete: (records) => {
            setSelectedTestsetToDelete(records)
            setIsDeleteTestsetModalOpen(true)
        },
        deleteDisabledTooltip: "Select testsets to delete",
    })

    // Track expanded rows and their loaded children
    const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([])
    const [loadingRows, setLoadingRows] = useState<Set<string>>(new Set())
    const [childrenCache, setChildrenCache] = useState<Map<string, TestsetTableRow[]>>(new Map())

    // Transform revisions to TestsetTableRow shape for tree data
    // Note: We skip variants entirely - testsets expand directly to revisions
    const transformRevisionToRow = useCallback(
        (revision: any, testsetId: string, testsetName: string): TestsetTableRow => ({
            key: `${testsetId}-${revision.id}`,
            id: revision.id,
            name: testsetName, // Use testset name for display
            created_at: revision.created_at,
            updated_at: revision.updated_at || revision.created_at,
            created_by_id: revision.created_by_id,
            __isSkeleton: false,
            __isRevision: true, // Mark as revision for different rendering
            __parentId: testsetId,
            __testsetId: testsetId,
            __version: revision.version, // Store version for display
        }),
        [],
    )

    // Handle row expand - fetch revisions directly from testset (no variants)
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
                    const revisions = await fetchTestsetRevisions({testsetId: record.id})
                    const childRows = revisions.map((r) =>
                        transformRevisionToRow(r, record.id, record.name),
                    )
                    setChildrenCache((prev) => new Map(prev).set(rowKey, childRows))
                } catch (error) {
                    console.error("Failed to fetch revisions:", error)
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
        [childrenCache, transformRevisionToRow],
    )

    // Build rows with children for tree data (supports nested children)
    const rowsWithChildren = useMemo(() => {
        // Helper to recursively add children from cache
        const addChildren = (row: TestsetTableRow): TestsetTableRow => {
            // Use row.key for cache lookup (matches expandedRowKeys)
            const children = childrenCache.get(row.key)
            if (children && children.length > 0) {
                // Recursively add children to each child row
                const childrenWithNested = children.map(addChildren)
                return {...row, children: childrenWithNested}
            }
            return row
        }

        return table.rows.map(addChildren)
    }, [table.rows, childrenCache])

    // Columns with expand icon integrated into Name column
    // Note: 2-level hierarchy only (Testset → Revision), no variants
    const columns = useMemo(
        () =>
            createStandardColumns<TestsetTableRow>([
                {
                    type: "text",
                    key: "name",
                    title: "Name",
                    width: 300,
                    fixed: "left",
                    render: (_value, record) => {
                        const isRevision = (record as any).__isRevision
                        // Use record.key for state checks (matches rowKey extractor)
                        const isExpanded = expandedRowKeys.includes(record.key)
                        const isLoading = loadingRows.has(record.key)
                        const isSkeleton = record.__isSkeleton

                        // Revision rows - show name + version tag with indent
                        if (isRevision) {
                            const version = (record as any).__version
                            return (
                                <div className="flex items-center gap-2 pl-6">
                                    <span>{record.name}</span>
                                    {version && (
                                        <Tag className="bg-[rgba(5,23,41,0.06)]" bordered={false}>
                                            v{version}
                                        </Tag>
                                    )}
                                </div>
                            )
                        }

                        // Testset rows (parent) - show expand icon
                        return (
                            <div className="flex items-center gap-2">
                                {!isSkeleton && (
                                    <span
                                        className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleExpand(!isExpanded, record)
                                        }}
                                    >
                                        {isLoading ? (
                                            <LoadingOutlined style={{fontSize: 14}} />
                                        ) : isExpanded ? (
                                            <MinusCircleOutlined style={{fontSize: 14}} />
                                        ) : (
                                            <PlusCircleOutlined style={{fontSize: 14}} />
                                        )}
                                    </span>
                                )}
                                <span>{record.name}</span>
                            </div>
                        )
                    },
                },
                {type: "date", key: "created_at", title: "Date Created"},
                {type: "user", key: "created_by_id", title: "Created by"},
                {
                    type: "actions",
                    width: 48,
                    maxWidth: 48,
                    items: [
                        {
                            key: "details",
                            label: "View details",
                            icon: <Note size={16} />,
                            onClick: actions.handleView,
                            hidden: (record) => (record as any).__isRevision,
                        },
                        {
                            key: "clone",
                            label: "Clone",
                            icon: <Copy size={16} />,
                            onClick: actions.handleClone,
                            hidden: (record) => (record as any).__isRevision,
                        },
                        {
                            key: "rename",
                            label: "Rename",
                            icon: <PencilSimple size={16} />,
                            onClick: actions.handleRename,
                            hidden: (record) => (record as any).__isRevision,
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: actions.handleDelete,
                            hidden: (record) => (record as any).__isRevision,
                        },
                    ],
                    onExportRow: table.handleExportRow,
                    isExporting: Boolean(table.rowExportingKey),
                    getRecordId: (record) => record.id,
                },
            ]),
        [
            actions,
            table.handleExportRow,
            table.rowExportingKey,
            expandedRowKeys,
            loadingRows,
            handleExpand,
        ],
    )

    // Update columns ref for export
    useEffect(() => {
        table.columnsRef.current = columns
    }, [columns, table.columnsRef])

    const headerTitle = useMemo(
        () => (
            <div className="flex flex-col gap-1">
                <Typography.Title level={3} style={{margin: 0}}>
                    Testsets
                </Typography.Title>
                <TableDescription>Manage your testsets for evaluations.</TableDescription>
            </div>
        ),
        [],
    )

    const filtersNode = useMemo(() => <TestsetsHeaderFilters />, [])

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

    return (
        <div className="flex flex-col h-full min-h-0 grow w-full">
            <InfiniteVirtualTableFeatureShell<TestsetTableRow>
                {...table.shellProps}
                dataSource={rowsWithChildren}
                columns={columns}
                title={headerTitle}
                filters={filtersNode}
                primaryActions={createButton}
                tableProps={{
                    ...table.shellProps.tableProps,
                    expandable: treeExpandable,
                }}
                tableClassName="agenta-testsets-table"
                className="flex-1 min-h-0"
                exportFilename="testsets.csv"
                autoHeight
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
                />
            )}

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
        </div>
    )
}

export default Testset
