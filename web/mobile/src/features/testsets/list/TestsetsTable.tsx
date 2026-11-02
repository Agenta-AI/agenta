import {useMemo} from "react"
import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button, Spinner} from "@agenta/ui/ui"

import {useConfirmModal} from "../../settings/useConfirmModal"

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
}: TestsetsTableProps) => {
    // Asked as "wide?" because the shared hook starts false before it reads the viewport.
    const narrow = !useMediaQuery(WIDE_QUERY)
    const {confirm, modal} = useConfirmModal()

    const groups = useMemo(() => [{key: "all", label: null, rows: [...rows]}], [rows])

    const actionsFor = (row: TestsetRow): TestsetRowActions => ({
        onOpen: () => onOpen(row),
        onExport: (format) => onExport(row, format),
        onArchive: () =>
            confirm({
                title: "Archive this testset?",
                message: `“${row.name}” and all its revisions will be archived.`,
                okText: "Archive",
                danger: true,
                onOk: () => onArchive(row),
            }),
        onClone: onClone ? () => onClone(row) : undefined,
        onRename: onRename ? () => onRename(row) : undefined,
    })

    return (
        <>
            <ListTable
                columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
                minWidth={narrow ? 300 : 560}
                stickyHeader
                loading={isLoading}
                groups={groups}
                rowKey={(row) => row.id}
                onOpenRow={onOpen}
                empty={empty}
                renderRow={(row) => (
                    <TestsetRowCells
                        row={row}
                        commitMessage={commitMessages.get(row.id) ?? null}
                        narrow={narrow}
                        busy={isBusy(row.id)}
                        canEdit={canEdit}
                        canExport={canExport}
                        exportDisabled={isAnyBusy}
                        actions={actionsFor(row)}
                    />
                )}
            />
            {hasMore ? (
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
