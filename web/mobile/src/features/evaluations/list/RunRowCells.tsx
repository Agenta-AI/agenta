import {
    deriveEvaluationKind,
    EVALUATION_KIND_LABELS,
    humanizeRunStatus,
    runDisplayStatus,
    runStatusTone,
    type EvaluationRun,
    type EvaluationRunKind,
    type RunStatusTone,
} from "@agenta/entities/evaluationRun"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {testsetMolecule} from "@agenta/entities/testset"
import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {FormattedDate} from "@agenta/ui/components/presentational"
import {Badge, type BadgeProps} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import {readRunReferences, runDisplayName} from "./runReferences"
import {RunRowMenu} from "./RunRowMenu"
import type {RunRowActions} from "./useRunRowActions"

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

const AppName = ({appId}: {appId: string | null}) => {
    const apps = useAtomValue(appWorkflowsListQueryStateAtom)
    const app = appId ? apps.data.find((entry) => entry.id === appId) : undefined
    return <>{app ? app.name || app.slug || "—" : "—"}</>
}

const TestsetName = ({testsetId}: {testsetId: string | null}) => {
    // The empty id keeps the hook count steady for a run with no test set.
    const testset = useAtomValue(testsetMolecule.selectors.data(testsetId ?? ""))
    return <>{testsetId ? testset?.name || "—" : "—"}</>
}

const muted = "block truncate text-[13px] text-muted-foreground"

/**
 * One run's cells, in column order. A phone shows Status, Name (with the kind and the date
 * under it) and the menu. The project page adds the Application column.
 */
export const RunRowCells = ({
    run,
    narrow,
    showApplication,
    actions,
}: {
    run: EvaluationRun
    narrow: boolean
    showApplication: boolean
    actions: RunRowActions
}) => {
    const refs = readRunReferences(run)
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
            <span className="block truncate text-[14px] font-medium text-foreground">
                {runDisplayName(run)}
            </span>
            <span className="flex">
                <RunKindBadge run={run} />
            </span>
            {showApplication ? (
                <span className={muted}>
                    <AppName appId={refs.applicationId} />
                </span>
            ) : null}
            <span className={muted}>
                <TestsetName testsetId={refs.testsetId} />
            </span>
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
