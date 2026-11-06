import {lazy, Suspense} from "react"

import {
    deriveEvaluationKind,
    EVALUATION_KIND_LABELS,
    humanizeRunStatus,
    runDisplayStatus,
    runStatusTone,
    type EvaluationRun,
    type EvaluationRunKind,
    type RunListColumns,
    type RunStatusTone,
} from "@agenta/entities/evaluationRun"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {FormattedDate} from "@agenta/ui/components/presentational"
import {Badge, type BadgeProps} from "@agenta/ui/ui"

import {useInView} from "../../annotations/useInView"

import {RunApplicationCell} from "./RunApplicationCell"
import {readRunReferences, runDisplayName} from "./runReferences"
import {RunRowMenu} from "./RunRowMenu"
import {RunTestsetCell} from "./RunTestsetCell"
import type {RunRowActions} from "./useRunRowActions"

// The metric and query cells (the metric bar, the stats and the trace filter labels) load in their
// own chunk the first time a wide row draws them. Phones never draw them, so they never load it.
const RunMetricCells = lazy(() =>
    import("./RunMetricCells").then((module) => ({default: module.RunMetricCells})),
)
const RunQueryCell = lazy(() =>
    import("./RunQueryCell").then((module) => ({default: module.RunQueryCell})),
)

const KIND_BADGE: Record<EvaluationRunKind, NonNullable<BadgeProps["variant"]>> = {
    auto: "geekblue",
    human: "purple",
    online: "green",
    custom: "magenta",
}

const DOT_COLOR: Record<RunStatusTone, string> = {
    success: "bg-[var(--ag-run-status-success)]",
    processing: "bg-[var(--ag-run-status-processing)]",
    default: "bg-[var(--ag-run-status-default)]",
    error: "bg-[var(--ag-run-status-error)]",
    warning: "bg-[var(--ag-run-status-warning)]",
}

const DATE_FORMAT = "MMM D, YYYY h:mm A"

/** A 12 px dot in the status colour. The word is the tooltip and the accessible name. */
export const RunStatusDot = ({status}: {status: string | null | undefined}) => {
    if (!status) return <span className="text-[13px] text-muted-foreground">—</span>
    const label = humanizeRunStatus(status)
    return (
        <span
            role="img"
            aria-label={label}
            title={label}
            className={`inline-block size-3 rounded-full ${DOT_COLOR[runStatusTone(status)]}`}
        />
    )
}

export const RunKindBadge = ({run}: {run: EvaluationRun}) => {
    const kind = deriveEvaluationKind(run)
    return <Badge variant={KIND_BADGE[kind]}>{EVALUATION_KIND_LABELS[kind]}</Badge>
}

const MetricCellsPlaceholder = ({columns}: {columns: RunListColumns}) => (
    <>
        {[
            ...columns.evaluators.flatMap((group) => group.columns.map((column) => column.id)),
            ...columns.invocation.map((column) => column.id),
        ].map((id) => (
            <span key={id} />
        ))}
    </>
)

const muted = "block truncate text-[13px] text-muted-foreground"

/**
 * One run's cells, in column order. A phone shows Status, Name (with the kind and the date
 * under it) and the menu. A wider screen shows the columns of the tab: the kind on All, the test
 * set, query and app the runs use (the project page only for the app), one cell per evaluator
 * metric, cost, duration, tokens and errors, then the date and the author. The query and the
 * metrics load once the row is near the screen.
 */
export const RunRowCells = ({
    run,
    narrow,
    columns,
    showApplication,
    actions,
}: {
    run: EvaluationRun
    narrow: boolean
    columns: RunListColumns
    showApplication: boolean
    actions: RunRowActions
}) => {
    const refs = readRunReferences(run)
    const {ref, inView} = useInView<HTMLSpanElement>()
    const menu = (
        // The menu's own clicks are not the row's: without this each press also opens the run.
        <span
            className="flex justify-end"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <RunRowMenu run={run} actions={actions} />
        </span>
    )

    if (narrow) {
        return (
            <>
                <span className="flex">
                    <RunStatusDot status={runDisplayStatus(run)} />
                </span>
                <span className="block min-w-0">
                    <span className="block truncate text-[14px] font-medium text-foreground">
                        {runDisplayName(run)}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[12px] text-muted-foreground">
                        <RunKindBadge run={run} />
                        <FormattedDate date={run.created_at} format={DATE_FORMAT} fallback="—" />
                    </span>
                </span>
                {menu}
            </>
        )
    }

    return (
        <>
            <span className="flex">
                <RunStatusDot status={runDisplayStatus(run)} />
            </span>
            <span ref={ref} className="block truncate text-[14px] font-medium text-foreground">
                {runDisplayName(run)}
            </span>
            {columns.showKind ? (
                <span className="flex">
                    <RunKindBadge run={run} />
                </span>
            ) : null}
            {columns.references.map((reference) =>
                reference === "testset" ? (
                    <RunTestsetCell key={reference} refs={refs} />
                ) : reference === "query" ? (
                    <Suspense key={reference} fallback={<span />}>
                        <RunQueryCell queryRevisionId={refs.queryRevisionId} inView={inView} />
                    </Suspense>
                ) : showApplication ? (
                    <RunApplicationCell key={reference} refs={refs} />
                ) : null,
            )}
            {/* One empty cell per metric column while the chunk loads, so the later cells stay
                in their columns. */}
            <Suspense fallback={<MetricCellsPlaceholder columns={columns} />}>
                <RunMetricCells run={run} columns={columns} inView={inView} />
            </Suspense>
            <span className={muted}>
                <FormattedDate date={run.created_at} format={DATE_FORMAT} fallback="—" />
            </span>
            <span className={muted}>
                <UserAuthorLabel userId={run.created_by_id} showYouLabel fallback="—" />
            </span>
            {menu}
        </>
    )
}
