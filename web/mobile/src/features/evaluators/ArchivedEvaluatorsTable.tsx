import type {ReactNode} from "react"

import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"

import {ArchivedEvaluatorRowCells} from "./ArchivedEvaluatorRowCells"
import type {EvaluatorArchivedRow} from "./evaluatorsView"

const col = (key: string, label: string, width: string): ListTableColumn => ({key, label, width})

const NAME = col("name", "Name", "minmax(180px,2fr)")
const ARCHIVED_BY = col("archivedBy", "Archived by", "minmax(120px,1fr)")
const ACTIONS: ListTableColumn = {key: "actions", label: "Actions", srOnly: true, width: "24px"}

const AUTOMATIC_COLUMNS = [
    NAME,
    col("type", "Type", "minmax(120px,1fr)"),
    col("tags", "Tags", "minmax(140px,1.5fr)"),
    col("archivedAt", "Archived at", "minmax(110px,1fr)"),
    ARCHIVED_BY,
    ACTIONS,
]
const HUMAN_COLUMNS = [
    NAME,
    col("feedback", "Feedback", "minmax(160px,2fr)"),
    col("archivedAt", "Archived at", "minmax(110px,1fr)"),
    ARCHIVED_BY,
    ACTIONS,
]
const NARROW_COLUMNS = [NAME, col("archivedAt", "Archived at", "96px"), ACTIONS]

/** Tailwind's `sm`. Below it the table shows the name and the archive date only. */
const WIDE_QUERY = "(min-width: 640px)"

/** The archived evaluators in the shared list frame: a flat list, newest archive first. */
export const ArchivedEvaluatorsTable = ({
    rows,
    category,
    isLoading,
    empty,
    restoring,
    onOpen,
    onRestore,
}: {
    rows: EvaluatorArchivedRow[]
    category: EvaluatorCategory
    isLoading: boolean
    empty: ReactNode
    restoring: boolean
    onOpen: (row: EvaluatorArchivedRow) => void
    /** Absent without `edit_evaluators`: the rows then have no Restore. */
    onRestore?: (workflowId: string) => void
}) => {
    // Asked as "wide?" because the shared hook starts false before it reads the viewport.
    const narrow = !useMediaQuery(WIDE_QUERY)
    const columns = narrow
        ? NARROW_COLUMNS
        : category === "human"
          ? HUMAN_COLUMNS
          : AUTOMATIC_COLUMNS

    return (
        <ListTable
            columns={columns}
            minWidth={narrow ? 300 : 800}
            stickyHeader
            loading={isLoading}
            groups={[{key: "all", label: null, rows}]}
            rowKey={(row) => row.workflowId}
            empty={empty}
            onOpenRow={onOpen}
            renderRow={(row) => (
                <ArchivedEvaluatorRowCells
                    row={row}
                    category={category}
                    narrow={narrow}
                    onOpen={() => onOpen(row)}
                    onRestore={onRestore ? () => onRestore(row.workflowId) : undefined}
                    restoring={restoring}
                />
            )}
        />
    )
}
