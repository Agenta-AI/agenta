import {useEffect, useMemo, useState} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {Copy, Note, PencilSimple, Trash} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {
    InfiniteVirtualTableFeatureShell,
    useTableManager,
    useTableActions,
    createStandardColumns,
} from "@/oss/components/InfiniteVirtualTable"
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

    // Columns - simplified with standard definitions
    const columns = useMemo(
        () =>
            createStandardColumns<TestsetTableRow>([
                {type: "text", key: "name", title: "Name", width: 300, fixed: "left"},
                {type: "date", key: "created_at", title: "Date Created"},
                {type: "user", key: "created_by_id", title: "Created by"},
                {
                    type: "actions",
                    items: [
                        {
                            key: "details",
                            label: "View details",
                            icon: <Note size={16} />,
                            onClick: actions.handleView,
                        },
                        {
                            key: "clone",
                            label: "Clone",
                            icon: <Copy size={16} />,
                            onClick: actions.handleClone,
                        },
                        {
                            key: "rename",
                            label: "Rename",
                            icon: <PencilSimple size={16} />,
                            onClick: actions.handleRename,
                        },
                        {type: "divider"},
                        {
                            key: "delete",
                            label: "Delete",
                            icon: <Trash size={16} />,
                            danger: true,
                            onClick: actions.handleDelete,
                        },
                    ],
                    onExportRow: table.handleExportRow,
                    isExporting: Boolean(table.rowExportingKey),
                    getRecordId: (record) => record.id,
                },
            ]),
        [actions, table.handleExportRow, table.rowExportingKey],
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
                <Typography.Paragraph type="secondary" style={{marginBottom: 0}}>
                    Manage your testsets for evaluations.
                </Typography.Paragraph>
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

    return (
        <div className="flex flex-col h-full min-h-0 grow w-full">
            <InfiniteVirtualTableFeatureShell<TestsetTableRow>
                {...table.shellProps}
                columns={columns}
                title={headerTitle}
                filters={filtersNode}
                primaryActions={createButton}
                secondaryActions={table.deleteButton}
                tableClassName="agenta-testsets-table"
                className="flex-1 min-h-0"
                exportFilename="testsets.csv"
                autoHeight
            />

            {/* {selectedTestsetToDelete.length > 0 && (
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
            /> */}
        </div>
    )
}

export default Testset
