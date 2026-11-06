import type {ReactNode} from "react"

import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableSelection} from "@agenta/ui/list-table"

import {ArchivedAppRowCells} from "./ArchivedAppRowCells"
import type {ArchivedAppRow} from "./archivedAppsView"

const NAME_COLUMN: ListTableColumn = {key: "name", label: "Name", width: "minmax(160px,2fr)"}
const CREATED_COLUMN: ListTableColumn = {
    key: "created",
    label: "Created At",
    width: "minmax(150px,1fr)",
}
const TYPE_COLUMN: ListTableColumn = {key: "type", label: "Type", width: "minmax(96px,1fr)"}
const ARCHIVED_AT_COLUMN = (width: string): ListTableColumn => ({
    key: "archivedAt",
    label: "Archived At",
    width,
})
const ARCHIVED_BY_COLUMN: ListTableColumn = {
    key: "archivedBy",
    label: "Archived By",
    width: "minmax(120px,1fr)",
}
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
}

const WIDE_COLUMNS: ListTableColumn[] = [
    NAME_COLUMN,
    CREATED_COLUMN,
    TYPE_COLUMN,
    ARCHIVED_AT_COLUMN("minmax(150px,1fr)"),
    ARCHIVED_BY_COLUMN,
    ACTIONS_COLUMN,
]
// A phone keeps the name and the archive date, as the agents roster drops Owner.
const NARROW_COLUMNS: ListTableColumn[] = [NAME_COLUMN, ARCHIVED_AT_COLUMN("96px"), ACTIONS_COLUMN]

/** Tailwind's `sm`. Below it the table shows the name and the archive date only. */
const WIDE_QUERY = "(min-width: 640px)"

/**
 * The archived apps in the shared list frame. Rows are not clickable: the app overview shows an
 * app from the active lists, so it has no page for an archived app.
 */
export const ArchivedAppsTable = ({
    rows,
    projectId,
    canRestore,
    isLoading,
    empty,
    selection,
}: {
    rows: ArchivedAppRow[]
    projectId: string
    canRestore: boolean
    isLoading: boolean
    empty: ReactNode
    selection?: ListTableSelection<ArchivedAppRow>
}) => {
    // Asked as "wide?" because the shared hook starts false before it reads the viewport.
    const narrow = !useMediaQuery(WIDE_QUERY)

    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? 300 : 840}
            stickyHeader
            loading={isLoading}
            groups={[{key: "all", label: null, rows}]}
            rowKey={(row) => row.id}
            empty={empty}
            selection={selection}
            renderRow={(row) => (
                <ArchivedAppRowCells
                    row={row}
                    projectId={projectId}
                    narrow={narrow}
                    canRestore={canRestore}
                />
            )}
        />
    )
}
