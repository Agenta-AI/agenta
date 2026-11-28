import {EvaluatorResultList, type EvaluatorResultListItem} from "@agenta/chat/value-view"
import {
    splitByOrigin,
    summarizeEvaluatorResult,
    type EvaluatorResultState,
    type EvaluatorResultSummary,
} from "@agenta/entities/evaluationRun"
import {
    computeColumnGroup,
    unwrapStatsForCompare,
    type RunColumnGroup,
    type RunStep,
} from "@agenta/entities/evaluationRun/etl"
import {UserAuthorLabel} from "@agenta/entities/shared"
import {useT} from "@agenta/i18n"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import traceSpanCatalog from "@agenta/i18n/catalogs/observabilityUi.traceSpan"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {Badge, Button} from "@agenta/ui/ui"
import {TreeView} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {metricDisplayLabel} from "../metricLabel"
import {
    isFailedStatus,
    isTerminalScenarioStatus,
    scoreText,
    type ScenarioRow,
    type ScenarioStep,
} from "../scenarios/scenarioColumns"

import {executionMetricsOf, hasExecutionMetrics} from "./ScenarioStepTools"

/** One evaluator's result on one test case, with the step it ran as. */
export interface ScenarioEvaluatorResult {
    id: string
    name: string
    summary: EvaluatorResultSummary
    error: string | null
    step: ScenarioStep | null
    /** The origin of the evaluator's annotation step: `human`, `auto`, `custom`, or none. */
    origin: string | null
}

/** The origin of each evaluator step, by the key of the group that shows it. */
export const evaluatorOriginsOf = (steps: readonly RunStep[]): ReadonlyMap<string, string | null> =>
    new Map(
        steps
            .filter((step) => step.type === "annotation")
            .map((step) => [computeColumnGroup(step, "").key, step.origin ?? null]),
    )

/** A metric value as one test case holds it: a one-row stats summary reads as its value. */
const metricValue = (value: unknown): unknown => {
    const unwrapped = unwrapStatsForCompare(value)
    if (unwrapped === null || typeof unwrapped !== "object" || Array.isArray(unwrapped)) {
        return unwrapped
    }
    const stats = unwrapped as {freq?: unknown; frequency?: unknown; unique?: unknown}
    return Array.isArray(stats.freq) ||
        Array.isArray(stats.frequency) ||
        Array.isArray(stats.unique)
        ? (scoreText(unwrapped) ?? undefined)
        : unwrapped
}

/**
 * Each evaluator of the run on one test case: its metrics with their kinds, and its state. An
 * evaluator with an error is `error`; one with values is `done`; one with none yet is `pending`
 * while the test case runs or while its values did not load, and `notRun` when the app call
 * failed. An evaluator with no result on a finished test case whose app call did not fail is left
 * out: it gave nothing for this test case, and it would read as a failed app call.
 */
export function scenarioEvaluatorResults(
    row: ScenarioRow,
    groups: RunColumnGroup[],
    labels: Record<string, string>,
    origins: ReadonlyMap<string, string | null>,
): ScenarioEvaluatorResult[] {
    const open = !isTerminalScenarioStatus(row.scenario.status)
    const appFailed = isFailedStatus(row.invocation?.status)
    return groups
        .filter(({group}) => group.kind === "evaluator")
        .map(({group}) => {
            const name = labels[group.key] ?? group.label
            const error = row.errors[group.key] ?? null
            const metrics = (row.cells[group.key] ?? [])
                .map((cell) => ({
                    name: metricDisplayLabel(cell.name, name),
                    value: metricValue(cell.value),
                    kind: cell.metricKind ?? null,
                }))
                .filter((metric) => metric.value !== undefined)
            const state: EvaluatorResultState = error
                ? "error"
                : metrics.length > 0
                  ? "done"
                  : (open && !appFailed) || row.valuesFailed
                    ? "pending"
                    : "notRun"
            return {
                id: group.key,
                name,
                summary: summarizeEvaluatorResult(metrics, state),
                error,
                step: row.steps[group.key] ?? null,
                origin: origins.get(group.key) ?? null,
            }
        })
        .filter((result) => result.summary.state !== "notRun" || appFailed)
}

/**
 * The Results tab: one row per evaluator that is not human, failed first, then the human
 * evaluators in their own group with True / False. Each row has its trace button and, on expand,
 * the evaluator call's duration, tokens and cost.
 */
export const ScenarioFocusResultsTab = ({
    results,
    hasEvaluators,
}: {
    results: ScenarioEvaluatorResult[]
    /** The run has evaluators, though none may have a result on this test case. */
    hasEvaluators: boolean
}) => {
    const t = useT(focusCatalog, traceSpanCatalog)
    const openTrace = useSetAtom(openTraceDrawerAtom)
    const {human, notHuman} = splitByOrigin(results)

    if (results.length === 0) {
        return (
            <p className="m-0 text-body text-muted-foreground">
                {t(
                    hasEvaluators
                        ? "evaluations.scenarioFocus.noResults"
                        : "evaluations.scenarioFocus.noEvaluators",
                )}
            </p>
        )
    }
    const itemOf = ({id, name, summary, error, step}: ScenarioEvaluatorResult) => {
        const traceId = step?.traceId ?? null
        const metrics = step ? executionMetricsOf(step.metrics) : null
        return {
            id,
            name,
            summary,
            error,
            onOpenTrace: traceId ? () => openTrace({traceId}) : undefined,
            actions: traceId ? (
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("evaluations.scenarioFocus.openStepTrace", {name})}
                    onClick={() => openTrace({traceId})}
                >
                    <TreeView />
                </Button>
            ) : null,
            details:
                metrics && hasExecutionMetrics(metrics) ? (
                    <ExecutionMetricsDisplay metrics={metrics} variant="plain" className="pt-1" />
                ) : null,
        } satisfies EvaluatorResultListItem
    }
    return (
        <div className="flex flex-col gap-6">
            {notHuman.length > 0 ? (
                <section
                    aria-label={t("evaluations.scenarioFocus.evaluators")}
                    className="flex flex-col"
                >
                    <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-border-muted pb-2.5">
                        <h3 className="m-0 flex items-baseline gap-2 text-label">
                            {t("evaluations.scenarioFocus.evaluators")}
                            <span className="text-meta font-normal text-muted-foreground">
                                {t("evaluations.scenarioFocus.evaluatorCount", {
                                    count: notHuman.length,
                                })}
                            </span>
                        </h3>
                        <span className="text-meta text-muted-foreground">
                            {t("evaluations.scenarioFocus.failedFirst")}
                        </span>
                    </div>
                    <EvaluatorResultList items={notHuman.map(itemOf)} />
                </section>
            ) : null}
            {human.length > 0 ? (
                <section
                    aria-label={t("evaluations.scenarioFocus.humanAnnotations")}
                    className="flex flex-col"
                >
                    <h3 className="m-0 border-0 border-b border-solid border-border-muted pb-2.5 text-label">
                        {t("evaluations.scenarioFocus.humanAnnotations")}
                    </h3>
                    <EvaluatorResultList
                        items={human.map((result) => ({
                            ...itemOf(result),
                            badge: <Badge>{t("observabilityUi.traceSpan.evaluatorHuman")}</Badge>,
                            byline: result.step?.author ? (
                                <UserAuthorLabel
                                    userId={result.step.author.userId}
                                    at={result.step.author.at}
                                />
                            ) : undefined,
                            binaryWords: "trueFalse" as const,
                        }))}
                    />
                </section>
            ) : null}
        </div>
    )
}
