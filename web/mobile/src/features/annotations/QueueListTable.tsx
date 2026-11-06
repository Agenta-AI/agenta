import type {ReactNode} from "react"

import type {SimpleQueueTableRow} from "@agenta/entities/simpleQueue"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {useRouter} from "next/router"

import {useDeveloperViewEnabled} from "@/features/developer/developerViewAccess"

import {QueueRowCells} from "./QueueRowCells"
import type {QueueToDelete} from "./useQueueDelete"

const NAME_COLUMN: ListTableColumn = {key: "name", label: "Name", width: "minmax(160px,2fr)"}
/** On a phone the name takes what the fixed columns leave. `minmax(0,1fr)` lets it shrink and truncate. */
const NARROW_NAME_COLUMN: ListTableColumn = {key: "name", label: "Name", width: "minmax(0,1fr)"}
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
}

/** Name, Reviewed, Status and the menu are the four a phone keeps. */
const NARROW_COLUMNS: ListTableColumn[] = [
    NARROW_NAME_COLUMN,
    {key: "reviewed", label: "Reviewed", width: "72px"},
    {key: "status", label: "Status", width: "80px"},
    ACTIONS_COLUMN,
]
const WIDE_COLUMNS: ListTableColumn[] = [
    NAME_COLUMN,
    {key: "type", label: "Type", width: "100px"},
    {key: "reviewed", label: "Reviewed", width: "110px"},
    {key: "status", label: "Status", width: "100px"},
    {key: "description", label: "Description", width: "minmax(140px,2fr)"},
    {key: "modified", label: "Modified on", width: "96px"},
    {key: "created", label: "Created on", width: "96px"},
    {key: "createdBy", label: "Created by", width: "minmax(110px,1fr)"},
    ACTIONS_COLUMN,
]

const WIDE_QUERY = "(min-width: 640px)"
const WIDE_MIN_WIDTH = 1100
const NARROW_MIN_WIDTH = 0

/**
 * The queues in the shared list frame. A row opens the queue; the menu offers Open, View Results,
 * Copy ID and, for a reader who may delete queues, Delete.
 */
export const QueueListTable = ({
    rows,
    base,
    canDelete,
    onDelete,
    empty,
}: {
    rows: SimpleQueueTableRow[]
    /** `/w/:workspace/p/:project` */
    base: string
    canDelete: boolean
    onDelete: (queue: QueueToDelete) => void
    empty?: ReactNode
}) => {
    const router = useRouter()
    // Asked as "wide?" because the hook starts false before it reads the viewport.
    const narrow = !useMediaQuery(WIDE_QUERY)
    const open = (row: SimpleQueueTableRow) =>
        void router.push(`${base}/annotations/${row.id}`).catch(() => undefined)
    // The results page is the evaluations view; without it the item would open a page not found.
    const resultsEnabled = useDeveloperViewEnabled("evaluations") === true
    const viewResults = (row: SimpleQueueTableRow) =>
        void router.push(`${base}/evaluations/results/${row.run_id}`).catch(() => undefined)

    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : WIDE_COLUMNS}
            minWidth={narrow ? NARROW_MIN_WIDTH : WIDE_MIN_WIDTH}
            stickyHeader
            groups={[{key: "all", label: null, rows}]}
            rowKey={(row) => row.id}
            onOpenRow={open}
            empty={empty}
            renderRow={(row) => (
                <QueueRowCells
                    row={row}
                    narrow={narrow}
                    canDelete={canDelete}
                    onOpen={open}
                    onViewResults={resultsEnabled ? viewResults : undefined}
                    onDelete={onDelete}
                />
            )}
        />
    )
}
