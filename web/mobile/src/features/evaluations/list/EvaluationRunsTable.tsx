import type {ReactNode} from "react"

import type {EvaluationRun, RunListReferenceColumn} from "@agenta/entities/evaluationRun"
import {useMediaQuery} from "@agenta/ui/hooks"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"

import {RunRowCells} from "./RunRowCells"
import type {EvaluationKindTab} from "./useEvaluationRunsFilters"
import {useEvaluatorColumns} from "./useEvaluatorColumns"
import {useRunListColumns} from "./useRunListColumns"
import type {RunRowActions} from "./useRunRowActions"

/** A column and the narrowest it gets, in px: the sum is where the table starts to scroll. */
interface SizedColumn extends ListTableColumn {
    min: number
}

const GAP = 12

const STATUS: SizedColumn = {key: "status", label: "Status", width: "64px", min: 64}
const NAME: SizedColumn = {key: "name", label: "Name", width: "minmax(180px,2fr)", min: 180}
const KIND: SizedColumn = {key: "kind", label: "Kind", width: "72px", min: 72}
const CREATED_ON: SizedColumn = {key: "createdOn", label: "Created on", width: "160px", min: 160}
const CREATED_BY: SizedColumn = {
    key: "createdBy",
    label: "Created by",
    width: "minmax(100px,1fr)",
    min: 100,
}
const ACTIONS: SizedColumn = {
    key: "actions",
    label: "Actions",
    srOnly: true,
    width: "24px",
    min: 24,
}

const REFERENCE: Record<RunListReferenceColumn, SizedColumn> = {
    testset: {key: "testset", label: "Test set", width: "minmax(120px,1fr)", min: 120},
    query: {key: "query", label: "Query", width: "minmax(220px,1.5fr)", min: 220},
    application: {key: "application", label: "Application", width: "minmax(140px,1fr)", min: 140},
}

const INVOCATION_METRIC_WIDTH = 96

/** Wide enough for "Answer correctness · Score" at 13 px, within 150 to 260 px. */
const metricWidth = (label: string) =>
    Math.min(260, Math.max(150, Math.ceil(label.length * 7) + 16))

const NARROW_COLUMNS: ListTableColumn[] = [
    {...STATUS, width: "48px"},
    {key: "name", label: "Name", width: "minmax(140px,1fr)"},
    ACTIONS,
]

/** Tailwind's `sm`. Below it only Status, Name and the menu stay. */
const WIDE_QUERY = "(min-width: 640px)"

/**
 * The runs of the list, in the shared list frame. The columns follow the tab and the runs on
 * screen, as in the old list; the table scrolls sideways when they do not fit.
 */
export const EvaluationRunsTable = ({
    runs,
    kind,
    isLoading,
    scope,
    actions,
    empty,
}: {
    runs: readonly EvaluationRun[]
    /** The list's tab. Absent (the app overview): the basic columns, with no metrics. */
    kind?: EvaluationKindTab
    isLoading: boolean
    /** `app` hides the Application column: every row is the same app. */
    scope: "project" | "app"
    actions: RunRowActions
    empty: ReactNode
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const showApplication = scope === "project"
    const {plan, names: evaluatorNames} = useEvaluatorColumns(useRunListColumns(runs, kind ?? null))

    const wide: SizedColumn[] = [
        STATUS,
        NAME,
        ...(plan.showKind ? [KIND] : []),
        ...plan.references
            .filter((reference) => showApplication || reference !== "application")
            .map((reference) => REFERENCE[reference]),
        ...plan.evaluators.flatMap((group) =>
            group.columns.map((column) => {
                // The old list puts the evaluator over its metrics; one header row says both.
                const label = `${evaluatorNames[group.id] ?? group.id} · ${column.label}`
                const width = metricWidth(label)
                return {
                    key: column.id,
                    label,
                    width: `${width}px`,
                    min: width,
                    headerClassName: "truncate",
                }
            }),
        ),
        ...plan.invocation.map((column) => ({
            key: column.id,
            label: column.label,
            width: `${INVOCATION_METRIC_WIDTH}px`,
            min: INVOCATION_METRIC_WIDTH,
        })),
        CREATED_ON,
        CREATED_BY,
        ACTIONS,
    ]
    const wideMinWidth = wide.reduce((sum, column) => sum + column.min, 0) + GAP * (wide.length - 1)

    return (
        <ListTable
            columns={narrow ? NARROW_COLUMNS : wide}
            minWidth={narrow ? 300 : wideMinWidth}
            stickyHeader
            // An empty list has no column to read, so its header row would only be noise.
            hideHeader={!isLoading && runs.length === 0}
            loading={isLoading}
            groups={[{key: "runs", label: null, rows: [...runs]}]}
            rowKey={(run) => run.id}
            onOpenRow={actions.open}
            empty={empty}
            renderRow={(run) => (
                <RunRowCells
                    run={run}
                    narrow={narrow}
                    columns={plan}
                    showApplication={showApplication}
                    actions={actions}
                />
            )}
        />
    )
}
