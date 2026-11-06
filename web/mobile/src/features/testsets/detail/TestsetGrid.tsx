import {useCallback, useMemo, useState, type ReactNode} from "react"

import {testcaseDataController, type TestcaseTableRow} from "@agenta/entities/testcase"
import {TestcaseTable, type EntityColumnHeader} from "@agenta/entity-ui/testcase"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {message} from "@agenta/ui/app-message"
import {ListTableToolbar} from "@agenta/ui/list-table"
import type {ColumnDefs} from "@agenta/ui/table"
import {copyToClipboard} from "@agenta/ui/utils"
import {useAtomValue} from "jotai"

import {AddColumnButton, ColumnDialog, type ColumnDialogStep} from "./ColumnDialogs"
import {ColumnHeaderActions} from "./ColumnHeaderActions"
import {columnHeaderTarget} from "./columnHeaderTarget"
import {TestcaseRowMenu} from "./TestcaseRowMenu"
import type {TestsetEditor} from "./useTestsetEditor"

type GridEditor = Pick<
    TestsetEditor,
    | "tableConfig"
    | "readOnly"
    | "columnEditBlocked"
    | "deleteRows"
    | "addColumn"
    | "renameColumn"
    | "deleteColumns"
>

const deletedRowsMessage = (count: number) =>
    count === 1
        ? "Deleted testcase. Save to apply changes."
        : `Deleted ${count} testcase(s). Save to apply changes.`

/**
 * The testcase grid of a test set page, laid out as in the old app: one row with the search on
 * the left and the page `actions` on the right, then the table. The last column header holds
 * "Add column" and the table settings, whose menu also has "Delete selected". Every change goes
 * through the editor and stays unsaved until the commit.
 *
 * A reader who may not edit gets the rows and "Copy ID" only. While a save runs
 * (`editor.readOnly`) every change is off.
 */
export const TestsetGrid = ({
    editor,
    canEdit,
    onOpenRow,
    actions,
}: {
    editor: GridEditor
    canEdit: boolean
    onOpenRow: (rowId: string) => void
    /**
     * The page actions (Import, Add row, Commit), on the search row. It gets the saved test
     * cases a queue action sends: the selected ones the grid shows, or else every one it shows.
     */
    actions?: (queueItemIds: string[]) => ReactNode
}) => {
    const {tableConfig, readOnly, deleteRows} = editor
    const [selected, setSelected] = useState<string[]>([])
    const [step, setStep] = useState<ColumnDialogStep | null>(null)
    // Search narrows the grid only. The editor keeps reading every row, because the save
    // looks for edited rows in its list.
    const [searchTerm, setSearchTerm] = useState("")
    // A new search clears the selection, so a bulk delete never hits rows the reader cannot see.
    const applySearch = useCallback((term: string) => {
        setSearchTerm(term)
        setSelected([])
    }, [])
    const search = useDebouncedAtomSearch(applySearch, 300)
    const gridConfig = useMemo(
        () => (searchTerm.trim() ? {...tableConfig, searchTerm} : tableConfig),
        [searchTerm, tableConfig],
    )
    // The header actions read the columns the table shows, search matches included.
    const columns = useAtomValue(testcaseDataController.selectors.columns(gridConfig))

    // The table hides its toolbar while it has no rows, so then the toolbar shows above it: a
    // new test set whose rows were all deleted can still get columns.
    const gridRows = useAtomValue(testcaseDataController.selectors.rows(gridConfig))
    const noRows = gridRows.length === 0
    // A selected row can leave the search results after an edit; bulk delete takes only the
    // rows the reader can see.
    const visibleSelected = useMemo(() => {
        const visible = new Set(gridRows.map((row) => row.id))
        return selected.filter((id) => visible.has(id))
    }, [gridRows, selected])

    // A row that is not saved yet has no id the server knows, so it never goes to a queue.
    const queueItemIds = useMemo(() => {
        const saved = gridRows.filter((row) => !row.__isNew).map((row) => row.id)
        const pick = visibleSelected.filter((id) => saved.includes(id))
        return pick.length > 0 ? pick : saved
    }, [gridRows, visibleSelected])

    const deleteSelected = useCallback(() => {
        if (readOnly || visibleSelected.length === 0) return
        deleteRows(visibleSelected)
        message.success(deletedRowsMessage(visibleSelected.length))
        setSelected([])
    }, [deleteRows, readOnly, visibleSelected])

    const appendColumns = useMemo<ColumnDefs<TestcaseTableRow>>(
        () => [
            {
                key: "__row_actions",
                title: canEdit ? (
                    <AddColumnButton
                        compact
                        blockedReason={editor.columnEditBlocked}
                        onClick={() => setStep({kind: "add"})}
                    />
                ) : (
                    ""
                ),
                // Room for Add column and the settings button in the header.
                width: canEdit ? 72 : 48,
                fixed: "right",
                render: (_value, row) => (
                    <TestcaseRowMenu
                        rowId={row.id}
                        isNewRow={Boolean(row.__isNew)}
                        canEdit={canEdit}
                        deleteDisabled={readOnly}
                        onEdit={() => onOpenRow(row.id)}
                        onDelete={() => {
                            if (readOnly) return
                            deleteRows([row.id])
                            message.success(deletedRowsMessage(1))
                        }}
                        onCopyId={() =>
                            void copyToClipboard(row.id).then((copied) => {
                                if (copied) message.success("Copied")
                                else message.error("Couldn't copy the ID")
                            })
                        }
                    />
                ),
            },
        ],
        [canEdit, deleteRows, editor.columnEditBlocked, onOpenRow, readOnly],
    )

    const renderColumnHeader = useCallback(
        (header: EntityColumnHeader) => {
            const columnKeys = columnHeaderTarget(header, columns)
            if (!columnKeys) return header.title
            return (
                <ColumnHeaderActions
                    header={header}
                    blockedReason={editor.columnEditBlocked}
                    onRename={() => setStep({kind: "rename", columnKey: header.key})}
                    onDelete={() =>
                        setStep({
                            kind: "delete",
                            columnKey: header.key,
                            columnKeys,
                            isGroup: header.isGroup,
                        })
                    }
                />
            )
        },
        [columns, editor.columnEditBlocked],
    )

    const submitStep = useCallback(
        (name: string) => {
            if (step?.kind === "rename") return editor.renameColumn(step.columnKey, name)
            if (step?.kind === "delete") return editor.deleteColumns(step.columnKeys)
            return editor.addColumn(name)
        },
        [editor, step],
    )

    const settingsDelete = useMemo(
        () =>
            canEdit
                ? {
                      onDelete: deleteSelected,
                      disabled: readOnly || visibleSelected.length === 0,
                      label: "Delete selected",
                  }
                : undefined,
        [canEdit, deleteSelected, readOnly, visibleSelected.length],
    )

    return (
        <>
            {/* Outside the table, so a search with no match can still be cleared. */}
            <ListTableToolbar
                search={search.value}
                onSearchChange={search.onChange}
                searchPlaceholder="Search testcases..."
                actions={
                    <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        {actions?.(queueItemIds)}
                        {/* With no rows the table has no header, so Add column shows here. */}
                        {noRows && canEdit ? (
                            <AddColumnButton
                                blockedReason={editor.columnEditBlocked}
                                onClick={() => setStep({kind: "add"})}
                            />
                        ) : null}
                    </div>
                }
            />
            <TestcaseTable
                config={gridConfig}
                selectable={canEdit}
                selectedIds={selected}
                onSelectionChange={setSelected}
                selectionDisabled={readOnly}
                onRowClick={(row) => {
                    if (!row.__isSkeleton) onOpenRow(row.id)
                }}
                appendColumns={appendColumns}
                renderColumnHeader={canEdit ? renderColumnHeader : undefined}
                settingsDelete={settingsDelete}
                // Export is in the page header, as in the old app.
                canExportData={false}
                columnSettings
                cellPopover
                markEditedRows={canEdit}
            />
            <ColumnDialog
                step={step}
                onClose={() => setStep(null)}
                onSubmit={submitStep}
                onDone={() => setStep(null)}
            />
        </>
    )
}
