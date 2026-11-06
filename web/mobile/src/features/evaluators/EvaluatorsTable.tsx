import type {ReactNode} from "react"

import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"

import {EvaluatorRowCells} from "./EvaluatorRowCells"
import type {EvaluatorListRow} from "./evaluatorsView"

const col = (key: string, label: string, width: string): ListTableColumn => ({key, label, width})

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
// The narrow layout has no room for the wide Name minimum; at 390 px it overflowed by about 12 px.
const NARROW_NAME = col("name", "Name", "minmax(120px,2fr)")
const NARROW_COLUMNS = [NARROW_NAME, col("updated", "Last modified", "96px")]

/** Tailwind's `sm`. Below it the table shows the name and the last change only. */
const WIDE_QUERY = "(min-width: 640px)"

/**
 * The live evaluators in the shared list frame: one row per evaluator on its latest revision,
 * with its older revisions under an expand. An evaluator row can be selected for Archive.
 */
export const EvaluatorsTable = ({
    rows,
    category,
    selectable,
    selectedWorkflowIds,
    isLoading,
    empty,
    expanded,
    loadingOlder,
    onSelectionChange,
    onToggleExpand,
    onOpen,
    onArchive,
}: {
    rows: EvaluatorListRow[]
    category: EvaluatorCategory
    /** Selecting and archiving need `edit_evaluators`. */
    selectable: boolean
    selectedWorkflowIds: ReadonlySet<string>
    isLoading: boolean
    empty: ReactNode
    expanded: ReadonlySet<string>
    /** Expanded evaluators whose older revisions are still loading. */
    loadingOlder: ReadonlySet<string>
    onSelectionChange: (next: Set<string>) => void
    onToggleExpand: (workflowId: string) => void
    onOpen: (row: EvaluatorListRow) => void
    onArchive: (workflowIds: readonly string[]) => void
}) => {
    // Asked as "wide?" because the shared hook starts false before it reads the viewport.
    const narrow = !useMediaQuery(WIDE_QUERY)
    const body = narrow ? NARROW_COLUMNS : category === "human" ? HUMAN_COLUMNS : AUTOMATIC_COLUMNS
    const columns = [...body, ACTIONS_COLUMN]

    return (
        <ListTable<EvaluatorListRow>
            columns={columns}
            minWidth={narrow ? 300 : category === "human" ? 760 : 1080}
            stickyHeader
            loading={isLoading}
            groups={[{key: "all", label: null, rows}]}
            rowKey={(row) => row.key}
            empty={empty}
            onOpenRow={onOpen}
            selection={
                selectable
                    ? {
                          selectedKeys: selectedWorkflowIds,
                          onChange: onSelectionChange,
                          canSelect: (row) => row.depth === 0,
                          rowLabel: (row) => `Select ${row.name ?? "evaluator"}`,
                          bulkActions: (keys) => (
                              <Button
                                  size="sm"
                                  variant="destructive"
                                  onClick={() => onArchive([...keys])}
                              >
                                  Archive
                              </Button>
                          ),
                      }
                    : undefined
            }
            renderRow={(row) => (
                <EvaluatorRowCells
                    row={row}
                    category={category}
                    narrow={narrow}
                    expanded={expanded.has(row.workflowId)}
                    loadingOlder={loadingOlder.has(row.workflowId)}
                    onToggleExpand={() => onToggleExpand(row.workflowId)}
                    onOpen={() => onOpen(row)}
                    onArchive={
                        selectable && row.depth === 0
                            ? () => onArchive([row.workflowId])
                            : undefined
                    }
                />
            )}
        />
    )
}
