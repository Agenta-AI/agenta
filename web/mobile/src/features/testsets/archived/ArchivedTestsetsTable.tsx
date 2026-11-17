import {useMemo} from "react"
import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"

import {ArchivedTestsetRowCells, type ArchivedTestsetRow} from "./ArchivedTestsetRowCells"

const NAME_COLUMN: ListTableColumn = {key: "name", label: "Name", width: "minmax(140px,2fr)"}
const CREATED_COLUMN: ListTableColumn = {
    key: "created",
    label: "Date Created",
    width: "minmax(100px,1fr)",
}
const AUTHOR_COLUMN: ListTableColumn = {
    key: "author",
    label: "Created by",
    width: "minmax(110px,1fr)",
}
const archivedAtColumn = (width: string): ListTableColumn => ({
    key: "archivedAt",
    label: "Archived at",
    width,
})
const ARCHIVED_BY_COLUMN: ListTableColumn = {
    key: "archivedBy",
    label: "Archived by",
    width: "minmax(110px,1fr)",
}
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
}

const WIDE_COLUMNS = [
    NAME_COLUMN,
    CREATED_COLUMN,
    AUTHOR_COLUMN,
    archivedAtColumn("minmax(100px,1fr)"),
    ARCHIVED_BY_COLUMN,
    ACTIONS_COLUMN,
]
// A phone keeps the name and the archive date.
const NARROW_COLUMNS = [NAME_COLUMN, archivedAtColumn("100px"), ACTIONS_COLUMN]

/** Tailwind's `sm`. Below it a phone keeps Name and Archived at only. */
const WIDE_QUERY = "(min-width: 640px)"

/** What the table needs from the screen. */
export interface ArchivedTestsetsTableProps {
    rows: readonly ArchivedTestsetRow[]
    projectId: string
    isLoading: boolean
    /** Drawn in place of the rows when there are none. */
    empty: ReactNode
    canRestore: boolean
    isBusy: (id: string) => boolean
    onOpen: (row: ArchivedTestsetRow) => void
    /** Absent hides Copy ID (developer mode only). */
    onCopyId?: (row: ArchivedTestsetRow) => void
}

/** The archived test sets in the shared list frame. A row opens the latest revision. */
export const ArchivedTestsetsTable = ({
    rows,
    projectId,
    isLoading,
    empty,
    canRestore,
    isBusy,
    onOpen,
    onCopyId,
}: ArchivedTestsetsTableProps) => {
    // Asked as "wide?" because the shared hook starts false before it reads the viewport.
    const narrow = !useMediaQuery(WIDE_QUERY)
    const groups = useMemo(() => [{key: "all", label: null, rows: [...rows]}], [rows])

    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? 300 : 720}
            stickyHeader
            loading={isLoading}
            groups={groups}
            rowKey={(row) => row.id}
            onOpenRow={onOpen}
            empty={empty}
            renderRow={(row) => (
                <ArchivedTestsetRowCells
                    row={row}
                    projectId={projectId}
                    narrow={narrow}
                    busy={isBusy(row.id)}
                    canRestore={canRestore}
                    onOpen={() => onOpen(row)}
                    onCopyId={onCopyId ? () => onCopyId(row) : undefined}
                />
            )}
        />
    )
}
