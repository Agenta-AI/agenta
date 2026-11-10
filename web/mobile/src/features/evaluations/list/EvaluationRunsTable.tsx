import type {ReactNode} from "react"

import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import {ListTable, type ListTableSelection} from "@agenta/ui/list-table"

import {RunRowCells} from "./RunRowCells"
import type {EvaluationKindTab} from "./useEvaluationRunsFilters"
import type {RunRowActions} from "./useRunRowActions"
import {useRunsTableLayout, type RunsTableLayout} from "./useRunsTableLayout"

interface RunsTableProps {
    runs: readonly EvaluationRun[]
    isLoading: boolean
    actions: RunRowActions
    empty: ReactNode
}

/**
 * The runs in the shared list frame, with the columns the caller worked out. The table scrolls
 * sideways when they do not fit. `selection` adds the checkboxes and the bulk bar.
 */
export const RunsTable = ({
    runs,
    isLoading,
    actions,
    empty,
    layout,
    selection,
}: RunsTableProps & {
    layout: RunsTableLayout
    selection?: ListTableSelection<EvaluationRun>
}) => (
    <ListTable
        columns={layout.columns}
        minWidth={layout.minWidth}
        stickyHeader
        // An empty list has no column to read, so its header row would only be noise.
        hideHeader={!isLoading && runs.length === 0}
        loading={isLoading}
        groups={[{key: "runs", label: null, rows: [...runs]}]}
        rowKey={(run) => run.id}
        onOpenRow={actions.open}
        empty={empty}
        selection={selection}
        renderRow={(run) => (
            <RunRowCells
                run={run}
                narrow={layout.narrow}
                columns={layout.plan}
                showApplication={layout.showApplication}
                actions={actions}
            />
        )}
    />
)

/**
 * The runs of the list with the old list's columns for the tab and the runs on screen, and no
 * column menu. The app overview uses it.
 */
export const EvaluationRunsTable = ({
    kind,
    scope,
    ...props
}: RunsTableProps & {
    /** The list's tab. Absent (the app overview): the basic columns, with no metrics. */
    kind?: EvaluationKindTab
    /** `app` hides the Application column: every row is the same app. */
    scope: "project" | "app"
}) => {
    const layout = useRunsTableLayout({runs: props.runs, kind, scope, columnsKey: null})
    return <RunsTable {...props} layout={layout} />
}
