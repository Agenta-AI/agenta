import type {ReactNode} from "react"

import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"

import {RunRowCells} from "./RunRowCells"
import type {RunRowActions} from "./useRunRowActions"

const STATUS: ListTableColumn = {key: "status", label: "Status", width: "64px"}
const ACTIONS: ListTableColumn = {key: "actions", label: "Actions", srOnly: true, width: "24px"}

const WIDE_COLUMNS: ListTableColumn[] = [
    STATUS,
    {key: "name", label: "Name", width: "minmax(160px,2fr)"},
    {key: "kind", label: "Kind", width: "72px"},
    {key: "application", label: "Application", width: "minmax(100px,1fr)"},
    {key: "testset", label: "Test set", width: "minmax(100px,1fr)"},
    {key: "createdOn", label: "Created on", width: "160px"},
    {key: "createdBy", label: "Created by", width: "minmax(100px,1fr)"},
    ACTIONS,
]
const NARROW_COLUMNS: ListTableColumn[] = [
    {...STATUS, width: "48px"},
    {key: "name", label: "Name", width: "minmax(140px,1fr)"},
    ACTIONS,
]

/** Tailwind's `sm`. Below it only Status, Name and the menu stay. */
const WIDE_QUERY = "(min-width: 640px)"

const NOT_APPLICATION = (column: ListTableColumn) => column.key !== "application"

/** The runs of the list, in the shared list frame. */
export const EvaluationRunsTable = ({
    runs,
    isLoading,
    scope,
    actions,
    empty,
}: {
    runs: readonly EvaluationRun[]
    isLoading: boolean
    /** `app` hides the Application column: every row is the same app. */
    scope: "project" | "app"
    actions: RunRowActions
    empty: ReactNode
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const showApplication = scope === "project"
    const columns = narrow
        ? NARROW_COLUMNS
        : showApplication
          ? WIDE_COLUMNS
          : WIDE_COLUMNS.filter(NOT_APPLICATION)

    return (
        <ListTable
            columns={columns}
            minWidth={narrow ? 300 : showApplication ? 980 : 860}
            stickyHeader
            loading={isLoading}
            groups={[{key: "runs", label: null, rows: [...runs]}]}
            rowKey={(run) => run.id}
            onOpenRow={actions.open}
            empty={empty}
            renderRow={(run) => (
                <RunRowCells
                    run={run}
                    narrow={narrow}
                    showApplication={showApplication}
                    actions={actions}
                />
            )}
        />
    )
}
