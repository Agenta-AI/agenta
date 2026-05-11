/**
 * TestsetPreviewPanelWrapper
 *
 * OSS wrapper that bridges the new TestsetSelectionModal's `renderPreviewPanel`
 * render prop to the full-featured TestcasesTableShell.
 *
 * It uses `useTestcasesTable` to initialize table state for the selected revision
 * and renders `TestcasesTableShell` in view mode with selection support.
 *
 * When `isCreateMode` is true (Build in UI), it renders an editable table
 * with add row/column actions and a "Go back to list" button.
 */

import {useCallback, useEffect, useMemo, useState} from "react"

import type {PreviewPanelRenderProps} from "@agenta/playground-ui/components"
import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {PlusOutlined} from "@ant-design/icons"
import {Button, Input, Typography} from "antd"

import {useRowHeight} from "@/oss/components/InfiniteVirtualTable"
import TestcaseEditDrawer from "@/oss/components/TestcasesTableNew/components/TestcaseEditDrawer"
import {TestcasesTableShell} from "@/oss/components/TestcasesTableNew/components/TestcasesTableShell"
import {useTestcasesTable} from "@/oss/components/TestcasesTableNew/hooks/useTestcasesTable"
import {
    TESTCASE_ROW_HEIGHT_CONFIG,
    testcaseRowHeightAtom,
} from "@/oss/components/TestcasesTableNew/state/rowHeight"

export interface TestsetPreviewPanelWrapperProps extends PreviewPanelRenderProps {}

export function TestsetPreviewPanelWrapper({
    revisionId,
    selectedIds,
    onSelectionChange,
    selectionMode = "multiple",
    selectionDisabled,
    isCreateMode = false,
    onExitCreateMode,
}: TestsetPreviewPanelWrapperProps) {
    const table = useTestcasesTable({
        revisionId: revisionId ?? undefined,
        // In create mode, don't skip init so useTestcasesTable creates default columns/row
        skipEmptyRevisionInit: !isCreateMode,
    })
    const rowHeight = useRowHeight(testcaseRowHeightAtom, TESTCASE_ROW_HEIGHT_CONFIG)

    const [isAddColumnModalOpen, setIsAddColumnModalOpen] = useState(false)
    const [newColumnName, setNewColumnName] = useState("")
    const [editingTestcaseId, setEditingTestcaseId] = useState<string | null>(null)

    useEffect(() => {
        setEditingTestcaseId(null)
    }, [revisionId, isCreateMode])

    // Map entity-layer selectedIds to table row keys
    const selectedRowKeys = useMemo<React.Key[]>(
        () => (selectedIds ?? []).map((id) => id as React.Key),
        [selectedIds],
    )

    const handleSelectedRowKeysChange = useCallback(
        (keys: React.Key[]) => {
            if (selectionDisabled) return
            onSelectionChange(keys.map(String))
        },
        [onSelectionChange, selectionDisabled],
    )

    const handleRowClick = useCallback(
        (record: any) => {
            const key = record?.id ?? record?.key
            if (key === undefined || key === null) return

            if (!selectionDisabled) {
                if (selectionMode === "single") {
                    onSelectionChange([String(key)])
                } else {
                    const keyStr = String(key)
                    const exists = (selectedIds ?? []).includes(keyStr)
                    if (exists) {
                        onSelectionChange((selectedIds ?? []).filter((k) => k !== keyStr))
                    } else {
                        onSelectionChange([...(selectedIds ?? []), keyStr])
                    }
                }
            }

            if (isCreateMode) {
                const recordId = record?.id ?? (typeof key === "string" ? key : String(key))
                setEditingTestcaseId(recordId)
            }
        },
        [selectionMode, selectionDisabled, selectedIds, onSelectionChange, isCreateMode],
    )

    const handleAddRow = useCallback(() => {
        if (!isCreateMode) return
        const newRow = table.addTestcase()
        const newRowKey = String(newRow.key ?? newRow.id ?? Date.now())

        if (!selectionDisabled) {
            if (selectionMode === "single") {
                onSelectionChange([newRowKey])
            } else {
                const exists = (selectedIds ?? []).includes(newRowKey)
                if (!exists) onSelectionChange([...(selectedIds ?? []), newRowKey])
            }
        }

        message.success("Row added. Fill in the cells and click Create & Load.")
        setEditingTestcaseId(newRowKey)
    }, [isCreateMode, selectionMode, selectionDisabled, selectedIds, onSelectionChange, table])

    const handleDeleteSelected = useCallback(() => {
        if (!isCreateMode || !(selectedIds ?? []).length) return
        table.deleteTestcases(selectedIds!.map(String))
        onSelectionChange([])
        message.success("Selected rows removed.")
        setEditingTestcaseId(null)
    }, [isCreateMode, selectedIds, onSelectionChange, table])

    const handleConfirmAddColumn = useCallback(() => {
        if (!isCreateMode) return
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
    }, [newColumnName, isCreateMode, table])

    const actionsNode = isCreateMode ? (
        <div className="flex items-center gap-2">
            <Button size="small" icon={<PlusOutlined />} onClick={handleAddRow}>
                Add row
            </Button>
            <Button size="small" onClick={() => setIsAddColumnModalOpen(true)}>
                Add column
            </Button>
        </div>
    ) : null

    if (!revisionId) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <span className="text-lg font-medium text-gray-400">
                    Select a testset to preview
                </span>
            </div>
        )
    }

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
                    enableSelection={!isCreateMode && !selectionDisabled}
                    selectionType={selectionMode === "single" ? "radio" : "checkbox"}
                    autoHeight
                    disableDeleteAction={!isCreateMode}
                    scopeIdPrefix="modal-preview"
                    onAddColumn={isCreateMode ? () => setIsAddColumnModalOpen(true) : undefined}
                />
            </div>

            {isCreateMode && (
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

            <EnhancedModal
                title="Add column"
                open={isAddColumnModalOpen}
                onCancel={() => {
                    setIsAddColumnModalOpen(false)
                    setNewColumnName("")
                }}
                footer={null}
                destroyOnHidden
            >
                <ModalContent>
                    <div className="flex flex-col gap-2">
                        <Typography.Text className="text-sm">Column name</Typography.Text>
                        <Input
                            value={newColumnName}
                            onChange={(e) => setNewColumnName(e.target.value)}
                            placeholder="e.g. prompt or metadata.notes"
                            autoFocus
                            onPressEnter={handleConfirmAddColumn}
                        />
                        <Typography.Text type="secondary" className="text-xs">
                            Tip: Use dot notation like{" "}
                            <code className="bg-gray-100 px-1 rounded">meta.correct_answer</code> to
                            group related columns.
                        </Typography.Text>
                    </div>
                </ModalContent>
                <ModalFooter>
                    <Button
                        onClick={() => {
                            setIsAddColumnModalOpen(false)
                            setNewColumnName("")
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="primary"
                        onClick={handleConfirmAddColumn}
                        disabled={!newColumnName.trim()}
                    >
                        OK
                    </Button>
                </ModalFooter>
            </EnhancedModal>
        </>
    )
}
