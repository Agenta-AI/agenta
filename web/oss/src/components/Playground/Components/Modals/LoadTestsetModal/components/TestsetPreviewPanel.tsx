import {useCallback, useEffect, useState} from "react"

import {PlusOutlined} from "@ant-design/icons"
import {Table} from "@phosphor-icons/react"
import {Button, Input, Modal, Typography} from "antd"
import {useAtom, useAtomValue} from "jotai"

import {message} from "@/oss/components/AppMessageContext"
import {useRowHeight} from "@/oss/components/InfiniteVirtualTable"
import TestcaseEditDrawer from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer"
import {TestcasesTableShell} from "@/oss/components/TestcasesTableNew/components/TestcasesTableShell"
import {useTestcasesTable} from "@/oss/components/TestcasesTableNew/hooks/useTestcasesTable"
import {
    testcaseRowHeightAtom,
    TESTCASE_ROW_HEIGHT_CONFIG,
} from "@/oss/components/TestcasesTableNew/state/rowHeight"
import {selectedRevisionIdAtom} from "@/oss/state/testsetSelection"

import {isCreatingNewTestsetAtom, selectedTestcaseRowKeysAtom} from "../atoms/modalState"

const TestcasesTablePreview = ({
    revisionId,
    isCreateMode = false,
    showActions = false,
    selectionMode = "multiple",
}: {
    revisionId: string
    isCreateMode?: boolean
    showActions?: boolean
    selectionMode?: "single" | "multiple"
}) => {
    const [selectedRowKeys, setSelectedRowKeys] = useAtom(selectedTestcaseRowKeysAtom)
    const table = useTestcasesTable({revisionId, mode: isCreateMode ? "edit" : "view"})
    const rowHeight = useRowHeight(testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG)
    const [isAddColumnModalOpen, setIsAddColumnModalOpen] = useState(false)
    const [newColumnName, setNewColumnName] = useState("")
    const [editingTestcaseId, setEditingTestcaseId] = useState<string | null>(null)

    useEffect(() => {
        setEditingTestcaseId(null)
    }, [revisionId, showActions])

    const handleRowClick = useCallback(
        (record: any) => {
            const key = record?.key
            if (key === undefined || key === null) return
            setSelectedRowKeys((prev) => {
                if (selectionMode === "single") {
                    return [key]
                }
                const exists = prev.includes(key)
                if (exists) {
                    return prev.filter((k) => k !== key)
                }
                return [...prev, key]
            })
            if (showActions) {
                const recordId = record?.id ?? (typeof key === "string" ? key : String(key))
                setEditingTestcaseId(recordId)
            }
        },
        [selectionMode, setSelectedRowKeys, showActions],
    )

    const handleSelectedRowKeysChange = useCallback(
        (keys: React.Key[]) => {
            if (selectionMode === "single") {
                const nextKey = keys[keys.length - 1]
                setSelectedRowKeys(nextKey !== undefined ? [nextKey] : [])
                return
            }
            setSelectedRowKeys(keys)
        },
        [selectionMode, setSelectedRowKeys],
    )

    const handleAddRow = useCallback(() => {
        if (!showActions) return
        const newRow = table.addTestcase()
        const newRowKey = String(newRow.key ?? newRow.id ?? Date.now())
        setSelectedRowKeys((prev) => {
            if (selectionMode === "single") {
                return [newRowKey]
            }
            return prev.includes(newRowKey) ? prev : [...prev, newRowKey]
        })
        message.success("Row added. Fill in the cells and click Create & Load.")
        setEditingTestcaseId(newRowKey)
    }, [selectionMode, setSelectedRowKeys, showActions, table])

    const handleDeleteSelected = useCallback(() => {
        if (!showActions || !selectedRowKeys.length) return
        table.deleteTestcases(selectedRowKeys.map(String))
        setSelectedRowKeys([])
        message.success("Selected rows removed. Save to keep the changes.")
        setEditingTestcaseId(null)
    }, [selectedRowKeys, setSelectedRowKeys, showActions, table])

    const handleConfirmAddColumn = useCallback(() => {
        if (!showActions) return
        const trimmed = newColumnName.trim()
        if (!trimmed) {
            message.error("Column name cannot be empty")
            return
        }
        const success = table.addColumn(trimmed)
        if (!success) {
            message.error(`Column "${trimmed}" already exists`)
            return
        }
        message.success(`Added column "${trimmed}"`)
        setIsAddColumnModalOpen(false)
        setNewColumnName("")
    }, [newColumnName, showActions, table])

    const actionsNode = showActions ? (
        <div className="flex items-center gap-2">
            <Button size="small" icon={<PlusOutlined />} onClick={handleAddRow}>
                Add row
            </Button>
            <Button size="small" onClick={() => setIsAddColumnModalOpen(true)}>
                Add column
            </Button>
        </div>
    ) : null

    return (
        <>
            <div className="relative min-h-0 flex flex-col overflow-hidden h-full w-full">
                <TestcasesTableShell
                    mode={isCreateMode ? "edit" : "view"}
                    revisionIdParam={revisionId}
                    table={table}
                    rowHeight={rowHeight}
                    selectedRowKeys={selectedRowKeys}
                    onSelectedRowKeysChange={handleSelectedRowKeysChange}
                    onRowClick={handleRowClick}
                    onDeleteSelected={handleDeleteSelected}
                    searchTerm={table.searchTerm}
                    onSearchChange={table.setSearchTerm}
                    header={null}
                    actions={actionsNode}
                    hideControls={false}
                    enableSelection
                    selectionType={selectionMode === "single" ? "radio" : "checkbox"}
                    autoHeight
                    disableDeleteAction={!showActions}
                    onAddColumn={showActions ? () => setIsAddColumnModalOpen(true) : undefined}
                />
            </div>

            {showActions && (
                <TestcaseEditDrawer
                    testcaseId={editingTestcaseId}
                    columns={table.baseColumns}
                    open={Boolean(editingTestcaseId)}
                    onClose={() => setEditingTestcaseId(null)}
                    isNewRow={
                        !!editingTestcaseId &&
                        (editingTestcaseId.startsWith("new-") ||
                            editingTestcaseId.startsWith("local-"))
                    }
                    onSaveTestset={table.saveTestset}
                    isSavingTestset={table.isSaving}
                />
            )}

            <Modal
                title="Add column"
                open={isAddColumnModalOpen}
                onOk={handleConfirmAddColumn}
                onCancel={() => {
                    setIsAddColumnModalOpen(false)
                    setNewColumnName("")
                }}
                okButtonProps={{disabled: !newColumnName.trim()}}
                destroyOnHidden
            >
                <div className="flex flex-col gap-2">
                    <Typography.Text className="text-sm">Column name</Typography.Text>
                    <Input
                        value={newColumnName}
                        onChange={(e) => setNewColumnName(e.target.value)}
                        placeholder="e.g. prompt or metadata.notes"
                        autoFocus
                    />
                    <Typography.Text type="secondary" className="text-xs">
                        Tip: Use dot notation like{" "}
                        <code className="bg-gray-100 px-1 rounded">meta.correct_answer</code> to
                        group related columns.
                    </Typography.Text>
                </div>
            </Modal>
        </>
    )
}

export const TestsetPreviewPanel: React.FC<{selectionMode?: "single" | "multiple"}> = ({
    selectionMode = "multiple",
}) => {
    const selectedRevisionId = useAtomValue(selectedRevisionIdAtom)
    const isCreatingNew = useAtomValue(isCreatingNewTestsetAtom)

    if (selectedRevisionId) {
        return (
            <TestcasesTablePreview
                revisionId={selectedRevisionId}
                isCreateMode={isCreatingNew}
                showActions={isCreatingNew}
                selectionMode={selectionMode}
            />
        )
    }

    // Empty state when no revision is selected
    if (isCreatingNew) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="flex flex-col items-center text-center gap-3 rounded-2xl border border-dashed border-gray-200 bg-gray-50/70 px-10 py-12 max-w-md">
                    <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-white text-gray-400 shadow-sm">
                        <Table size={28} weight="regular" />
                    </span>
                    <div className="flex flex-col gap-1">
                        <Typography.Text className="font-semibold text-base text-gray-800">
                            Start building your testset
                        </Typography.Text>
                        <Typography.Text type="secondary">
                            Upload a CSV/JSON or click{" "}
                            <Typography.Text strong>Build in UI</Typography.Text> to add rows
                            manually. Your testcases will appear here as soon as you begin.
                        </Typography.Text>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-1 items-center justify-center">
            <Typography.Text className="text-lg font-medium -mt-1">
                Select a revision to view testcases.
            </Typography.Text>
        </div>
    )
}
