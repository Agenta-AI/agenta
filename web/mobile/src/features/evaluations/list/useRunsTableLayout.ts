import {useMemo} from "react"

import {
    visibleRunListColumns,
    type EvaluationRun,
    type RunListColumns,
    type RunListReferenceColumn,
} from "@agenta/entities/evaluationRun"
import {useMediaQuery} from "@agenta/ui/hooks"
import {useListTableColumnVisibility, type ListTableColumn} from "@agenta/ui/list-table"

import type {EvaluationKindTab} from "./useEvaluationRunsFilters"
import {useEvaluatorColumns} from "./useEvaluatorColumns"
import {useRunListColumns} from "./useRunListColumns"

/** A column and the narrowest it gets, in px: the sum is where the table starts to scroll. */
interface SizedColumn extends ListTableColumn {
    min: number
}

const GAP = 12

// Status, name, kind and the two creation columns are always drawn, as in the old list.
const STATUS: SizedColumn = {
    key: "status",
    label: "Status",
    width: "64px",
    min: 64,
    hideable: false,
}
const NAME: SizedColumn = {
    key: "name",
    label: "Name",
    width: "minmax(180px,2fr)",
    min: 180,
    hideable: false,
}
const KIND: SizedColumn = {key: "kind", label: "Kind", width: "72px", min: 72, hideable: false}
const CREATED_ON: SizedColumn = {
    key: "createdOn",
    label: "Created on",
    width: "160px",
    min: 160,
    hideable: false,
}
const CREATED_BY: SizedColumn = {
    key: "createdBy",
    label: "Created by",
    width: "minmax(100px,1fr)",
    min: 100,
    hideable: false,
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

const NOTHING_HIDDEN: ReadonlySet<string> = new Set()

/** Tailwind's `sm`. Below it only Status, Name and the menu stay. */
const WIDE_QUERY = "(min-width: 640px)"

const wideColumns = (
    plan: RunListColumns,
    evaluatorNames: Record<string, string>,
    showApplication: boolean,
): SizedColumn[] => [
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

/**
 * The columns of a runs table: the old list's columns for the tab and the runs on screen, less
 * the ones the reader hid in the column menu (kept per browser under `columnsKey`). Without a
 * `columnsKey` (the app overview) every column shows and there is no menu.
 */
export const useRunsTableLayout = ({
    runs,
    kind,
    scope,
    columnsKey,
}: {
    runs: readonly EvaluationRun[]
    /** The list's tab. Absent (the app overview): the basic columns, with no metrics. */
    kind?: EvaluationKindTab
    /** `app` hides the Application column: every row is the same app. */
    scope: "project" | "app"
    columnsKey: string | null
}) => {
    const narrow = !useMediaQuery(WIDE_QUERY)
    const showApplication = scope === "project"
    const {plan: fullPlan, names: evaluatorNames} = useEvaluatorColumns(
        useRunListColumns(runs, kind ?? null),
    )
    const allColumns = useMemo(
        () => wideColumns(fullPlan, evaluatorNames, showApplication),
        [fullPlan, evaluatorNames, showApplication],
    )
    const visibility = useListTableColumnVisibility({
        storageKey: columnsKey ?? "evaluation-runs",
        columns: allColumns,
    })
    const hiddenKeys = columnsKey ? visibility.hiddenKeys : NOTHING_HIDDEN
    const plan = useMemo(() => visibleRunListColumns(fullPlan, hiddenKeys), [fullPlan, hiddenKeys])
    const wide = useMemo(
        () => wideColumns(plan, evaluatorNames, showApplication),
        [plan, evaluatorNames, showApplication],
    )

    return {
        narrow,
        showApplication,
        /** The columns on screen: what the rows draw and the export writes. */
        plan,
        evaluatorNames,
        columns: narrow ? NARROW_COLUMNS : wide,
        minWidth: narrow
            ? 300
            : wide.reduce((sum, column) => sum + column.min, 0) + GAP * (wide.length - 1),
        /** Every column of the tab, for the column menu. */
        allColumns,
        hiddenKeys,
        setColumnVisible: visibility.setColumnVisible,
    }
}

export type RunsTableLayout = ReturnType<typeof useRunsTableLayout>
