import {useCallback, useMemo, useState} from "react"

import {testcaseDataController, type TestcaseTableRow} from "@agenta/entities/testcase"
import {TestcaseTable, type EntityColumnHeader} from "@agenta/entity-ui/testcase"
import {useDebouncedAtomSearch} from "@agenta/shared/hooks"
import {message} from "@agenta/ui/app-message"
import {ListTableToolbar} from "@agenta/ui/list-table"
import type {ColumnDefs} from "@agenta/ui/table"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {copyToClipboard} from "@agenta/ui/utils"
import {Trash} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {AddColumnButton, ColumnDialog, type ColumnDialogStep} from "./ColumnDialogs"
import {ColumnHeaderActions} from "./ColumnHeaderActions"
import {columnHeaderTarget} from "./columnHeaderTarget"
import {TestcaseRowMenu} from "./TestcaseRowMenu"
import type {TestsetEditor} from "./useTestsetEditor"

type GridEditor = Pick<
    TestsetEditor,
    | "isNew"
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
 * The testcase grid of a test set page: rows, the row menu, the column menus and the column
 * steps, and the bulk delete. Every change goes through the editor: rows stay unsaved until
 * the commit, and a column change on a saved test set saves a new version at once.
 *
 * A reader who may not edit gets the rows and "Copy ID" only. While a save runs
 * (`editor.readOnly`) every change is off.
 */
export const TestsetGrid = ({
    editor,
    canEdit,
    onOpenRow,
    onColumnSaved,
}: {
    editor: GridEditor
    canEdit: boolean
    onOpenRow: (rowId: string) => void
    /** Opens the version a column change saved. */
    onColumnSaved: (revisionId: string) => void
}) => {
    const {tableConfig, readOnly, deleteRows} = editor
    const [selected, setSelected] = useState<string[]>([])
    const [step, setStep] = useState<ColumnDialogStep | null>(null)
    const columns = useAtomValue(testcaseDataController.selectors.columns(tableConfig))
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
                title: "",
                width: 48,
                fixed: "right",
                render: (_value, row) => (
                    <TestcaseRowMenu
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
        [canEdit, deleteRows, onOpenRow, readOnly],
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

    const toolbar = canEdit ? (
        <div className="flex items-center gap-2">
            <SimpleTooltip
                title={
                    visibleSelected.length === 0 ? "Select testcases to delete" : "Delete selected"
                }
            >
                <span className="inline-flex">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={readOnly || visibleSelected.length === 0}
                        onClick={deleteSelected}
                    >
                        <Trash aria-hidden size={14} />
                        Delete
                    </Button>
                </span>
            </SimpleTooltip>
            <AddColumnButton
                blockedReason={editor.columnEditBlocked}
                onClick={() => setStep({kind: "add"})}
            />
        </div>
    ) : null

    return (
        <>
            {/* Outside the table, so a search with no match can still be cleared. */}
            <ListTableToolbar
                search={search.value}
                onSearchChange={search.onChange}
                searchPlaceholder="Search testcases..."
            />
            {noRows && toolbar ? <div className="flex justify-end">{toolbar}</div> : null}
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
                headerExtra={noRows ? null : toolbar}
            />
            <ColumnDialog
                step={step}
                savesVersion={!editor.isNew}
                onClose={() => setStep(null)}
                onSubmit={submitStep}
                onDone={(revisionId) => {
                    setStep(null)
                    if (revisionId) onColumnSaved(revisionId)
                }}
            />
        </>
    )
}
