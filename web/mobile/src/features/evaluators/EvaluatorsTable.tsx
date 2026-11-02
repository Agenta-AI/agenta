import type {ReactNode} from "react"

import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn, type ListTableGroup} from "@agenta/ui/list-table"

import {EvaluatorRowCells} from "./EvaluatorRowCells"
import type {EvaluatorRevisionRow} from "./evaluatorsView"

const col = (key: string, label: string, width: string): ListTableColumn => ({key, label, width})

const SELECT_COLUMN: ListTableColumn = {key: "select", label: "Select", srOnly: true, width: "20px"}
const ACTIONS_COLUMN: ListTableColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
}
const NAME = col("name", "Name", "minmax(180px,2fr)")
const LAST_MODIFIED = col("updated", "Last modified", "minmax(110px,1fr)")

const AUTOMATIC_COLUMNS = [
    NAME,
    col("type", "Type", "minmax(120px,1fr)"),
    col("tags", "Tags", "minmax(140px,1.5fr)"),
    col("created", "Date Created", "minmax(110px,1fr)"),
    LAST_MODIFIED,
    col("modifiedBy", "Modified by", "minmax(120px,1fr)"),
    col("message", "Commit message", "minmax(140px,1.5fr)"),
]
const HUMAN_COLUMNS = [
    NAME,
    col("feedback", "Feedback", "minmax(160px,2fr)"),
    col("created", "Date Created", "minmax(110px,1fr)"),
    LAST_MODIFIED,
    col("modifiedBy", "Modified by", "minmax(120px,1fr)"),
]
const NARROW_COLUMNS = [NAME, col("updated", "Last modified", "96px")]

/** Tailwind's `sm`. Below it the table shows the name and the last change only. */
const WIDE_QUERY = "(min-width: 640px)"

/**
 * The live evaluators in the shared list frame: one group per evaluator, its revisions as rows.
 * A row opens the evaluator in the read-only drawer.
 */
export const EvaluatorsTable = ({
    groups,
    category,
    selectable,
    selectedWorkflowIds,
    isLoading,
    empty,
    onToggle,
    onOpen,
    onArchive,
}: {
    groups: ListTableGroup<EvaluatorRevisionRow>[]
    category: EvaluatorCategory
    /** Selecting and archiving need `edit_evaluators`. */
    selectable: boolean
    selectedWorkflowIds: ReadonlySet<string>
    isLoading: boolean
    empty: ReactNode
    onToggle: (workflowId: string) => void
    onOpen: (row: EvaluatorRevisionRow) => void
    onArchive: (workflowId: string) => void
}) => {
    // Asked as "wide?" because the shared hook starts false before it reads the viewport.
    const narrow = !useMediaQuery(WIDE_QUERY)
    const body = narrow ? NARROW_COLUMNS : category === "human" ? HUMAN_COLUMNS : AUTOMATIC_COLUMNS
    const columns = [...(selectable ? [SELECT_COLUMN] : []), ...body, ACTIONS_COLUMN]

    return (
        <ListTable
            columns={columns}
            minWidth={narrow ? 300 : category === "human" ? 760 : 1080}
            stickyHeader
            loading={isLoading}
            groups={groups}
            rowKey={(row) => row.id}
            empty={empty}
            onOpenRow={onOpen}
            renderRow={(row) => (
                <EvaluatorRowCells
                    row={row}
                    category={category}
                    narrow={narrow}
                    selectable={selectable}
                    selected={selectedWorkflowIds.has(row.workflowId)}
                    onToggle={() => onToggle(row.workflowId)}
                    onOpen={() => onOpen(row)}
                    onArchive={selectable ? () => onArchive(row.workflowId) : undefined}
                />
            )}
        />
    )
}
