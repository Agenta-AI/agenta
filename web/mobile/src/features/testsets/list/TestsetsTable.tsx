import {useMemo, useState} from "react"
import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {
    ListTable,
    ListTableLoadMore,
    type ListTableColumn,
    type ListTableSelection,
} from "@agenta/ui/list-table"
import {Button, Spinner} from "@agenta/ui/ui"

import {useConfirmModal} from "../../settings/useConfirmModal"

import {TestsetRevisionRows} from "./TestsetRevisionRows"
import {TestsetRowCells} from "./TestsetRowCells"
import type {TestsetExportFormat, TestsetRow, TestsetRowActions} from "./testsetRowTypes"

const NAME_COLUMN: ListTableColumn = {key: "name", label: "Name", width: "minmax(140px,2fr)"}
const COMMIT_COLUMN: ListTableColumn = {
    key: "commit",
    label: "Commit Message",
    width: "minmax(120px,2fr)",
}
const AUTHOR_COLUMN: ListTableColumn = {
    key: "author",
    label: "Created by",
    width: "minmax(110px,1fr)",
}
const dateColumn = (width: string): ListTableColumn => ({
    key: "created",
    label: "Date Created",
    width,
})
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
}

const WIDE_COLUMNS = [
    NAME_COLUMN,
    COMMIT_COLUMN,
    AUTHOR_COLUMN,
    dateColumn("110px"),
    ACTIONS_COLUMN,
]
const NARROW_COLUMNS = [NAME_COLUMN, dateColumn("100px"), ACTIONS_COLUMN]

// Developer mode follows the classic app: Date Created, with the time, before Created by.
const DEVELOPER_WIDE_COLUMNS = [
    NAME_COLUMN,
    COMMIT_COLUMN,
    dateColumn("minmax(150px,1fr)"),
    AUTHOR_COLUMN,
    ACTIONS_COLUMN,
]
const DEVELOPER_NARROW_COLUMNS = [NAME_COLUMN, dateColumn("132px"), ACTIONS_COLUMN]

const columnsFor = (developerMode: boolean, narrow: boolean) => {
    if (developerMode) return narrow ? DEVELOPER_NARROW_COLUMNS : DEVELOPER_WIDE_COLUMNS
    return narrow ? NARROW_COLUMNS : WIDE_COLUMNS
}

/** Tailwind's `sm`. Below it a phone keeps Name and Date Created only. */
const WIDE_QUERY = "(min-width: 640px)"

/** What the table needs from the screen. Every verb is a callback, so the table holds no data layer. */
export interface TestsetsTableProps {
    rows: readonly TestsetRow[]
    commitMessages: ReadonlyMap<string, string | null>
    isLoading: boolean
    /** Drawn in place of the rows when there are none. */
    empty: ReactNode
    hasMore: boolean
    isLoadingMore: boolean
    onLoadMore: () => void
    canEdit: boolean
    canExport: boolean
    isBusy: (id: string) => boolean
    isAnyBusy: boolean
    onOpen: (row: TestsetRow) => void
    onExport: (row: TestsetRow, format: TestsetExportFormat) => void
    /** Runs after the reader confirms. Throw an `Error` with a plain message to keep the dialog open. */
    onArchive: (row: TestsetRow) => Promise<void>
    onClone?: (row: TestsetRow) => void
    onRename?: (row: TestsetRow) => void
    /**
     * Beta developer mode: the classic column order and date, Copy ID, the archive dialog that
     * names every test set, and the next page loading on scroll. Off keeps the list as it was.
     */
    developerMode?: boolean
    /** Row checkboxes and the bulk bar. Absent = no checkboxes. */
    selection?: ListTableSelection<TestsetRow>
    onCopyId?: (row: TestsetRow) => void
    /** Developer mode: opens the screen's archive dialog instead of the generic confirm. */
    onRequestArchive?: (rows: TestsetRow[]) => void
    /**
     * Developer mode: each row expands to list its revisions, and a click on one opens it.
     * Absent = no expand toggle.
     */
    revisions?: {projectId: string; onOpen: (revisionId: string) => void}
}

/** The testsets list in the shared list frame, with Load more under it. */
export const TestsetsTable = ({
    rows,
    commitMessages,
    isLoading,
    empty,
    hasMore,
    isLoadingMore,
    onLoadMore,
    canEdit,
    canExport,
    isBusy,
    isAnyBusy,
    onOpen,
    onExport,
    onArchive,
    onClone,
    onRename,
    developerMode = false,
    selection,
    onCopyId,
    onRequestArchive,
    revisions,
}: TestsetsTableProps) => {
    // Asked as "wide?" because the shared hook starts false before it reads the viewport.
    const narrow = !useMediaQuery(WIDE_QUERY)
    const {confirm, modal} = useConfirmModal()

    const groups = useMemo(() => [{key: "all", label: null, rows: [...rows]}], [rows])
    const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set())
    const toggleExpanded = (id: string) =>
        setExpandedIds((current) => {
            const next = new Set(current)
            if (!next.delete(id)) next.add(id)
            return next
        })

    const actionsFor = (row: TestsetRow): TestsetRowActions => ({
        onOpen: () => onOpen(row),
        onExport: (format) => onExport(row, format),
        onArchive: onRequestArchive
            ? () => onRequestArchive([row])
            : () =>
                  confirm({
                      title: "Archive this test set?",
                      message: `“${row.name}” and all its revisions will be archived.`,
                      okText: "Archive",
                      danger: true,
                      onOk: () => onArchive(row),
                  }),
        onClone: onClone ? () => onClone(row) : undefined,
        onRename: onRename ? () => onRename(row) : undefined,
        onCopyId: onCopyId ? () => onCopyId(row) : undefined,
    })

    return (
        <>
            <ListTable
                columns={columnsFor(developerMode, narrow)}
                minWidth={narrow ? 300 : 560}
                selection={selection}
                stickyHeader
                loading={isLoading}
                groups={groups}
                rowKey={(row) => row.id}
                onOpenRow={onOpen}
                empty={empty}
                wrapRow={
                    revisions
                        ? (row, rowNode) => (
                              <>
                                  {rowNode}
                                  {expandedIds.has(row.id) ? (
                                      <TestsetRevisionRows
                                          projectId={revisions.projectId}
                                          testsetId={row.id}
                                          testsetName={row.name}
                                          onOpenRevision={revisions.onOpen}
                                      />
                                  ) : null}
                              </>
                          )
                        : undefined
                }
                renderRow={(row) => (
                    <TestsetRowCells
                        row={row}
                        commitMessage={commitMessages.get(row.id) ?? null}
                        narrow={narrow}
                        developerMode={developerMode}
                        busy={isBusy(row.id)}
                        canEdit={canEdit}
                        canExport={canExport}
                        exportDisabled={isAnyBusy}
                        actions={actionsFor(row)}
                        expanded={expandedIds.has(row.id)}
                        onToggleExpand={revisions ? () => toggleExpanded(row.id) : undefined}
                    />
                )}
            />
            {hasMore && developerMode ? (
                <ListTableLoadMore autoLoad onLoadMore={onLoadMore} loading={isLoadingMore} />
            ) : null}
            {hasMore && !developerMode ? (
                <div className="flex justify-center py-4">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={isLoadingMore}
                        onClick={onLoadMore}
                    >
                        {isLoadingMore ? <Spinner aria-label="Loading more" /> : null}
                        Load more
                    </Button>
                </div>
            ) : null}
            {modal}
        </>
    )
}
