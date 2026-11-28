import {EvaluatorResultList, type EvaluatorResultListItem} from "@agenta/chat/value-view"
import {
    isHumanOrigin,
    splitByOrigin,
    summarizeEvaluatorResult,
    type JudgeVerdict,
    type EvaluatorResultState,
    type EvaluatorResultSummary,
} from "@agenta/entities/evaluationRun"
import {
    computeColumnGroup,
    unwrapStatsForCompare,
    type RunColumnGroup,
    type RunStep,
} from "@agenta/entities/evaluationRun/etl"
import {UserAuthorLabel, useUserDisplayName} from "@agenta/entities/shared"
import {useT} from "@agenta/i18n"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import annotateCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocusAnnotate"
import traceSpanCatalog from "@agenta/i18n/catalogs/observabilityUi.traceSpan"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {timeAgo} from "@agenta/shared/utils"
import {InitialsAvatar} from "@agenta/ui"
import {ExecutionMetricsDisplay} from "@agenta/ui/components/presentational"
import {Badge, Button} from "@agenta/ui/ui"
import {Check, TreeView, X} from "@phosphor-icons/react"
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
export const scenarioMetricValue = (value: unknown): unknown => {
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
 * failed. An evaluator that ran (its step has a trace) but gave none of the run's mapped values is
 * `done` with no metrics, so its row keeps the trace button. An evaluator with no result and no
 * trace on a finished test case whose app call did not fail is left out: it gave nothing for this
 * test case, and it would read as a failed app call. A human evaluator stays: nobody filled it yet.
 */
export function scenarioEvaluatorResults(
    row: ScenarioRow,
    groups: RunColumnGroup[],
    labels: Record<string, string>,
    origins: ReadonlyMap<string, string | null>,
): ScenarioEvaluatorResult[] {
    const open = !isTerminalScenarioStatus(row.scenario.status)
    const appFailed = isFailedStatus(row.invocation?.status)
    return (
        groups
            .filter(({group}) => group.kind === "evaluator")
            .map(({group}) => {
                const name = labels[group.key] ?? group.label
                const error = row.errors[group.key] ?? null
                const metrics = (row.cells[group.key] ?? [])
                    .map((cell) => ({
                        name: metricDisplayLabel(cell.name, name),
                        value: scenarioMetricValue(cell.value),
                        kind: cell.metricKind ?? null,
                    }))
                    .filter((metric) => metric.value !== undefined)
                const ran = Boolean(row.steps[group.key]?.traceId)
                const state: EvaluatorResultState = error
                    ? "error"
                    : metrics.length > 0
                      ? "done"
                      : (open && !appFailed) || row.valuesFailed
                        ? "pending"
                        : ran
                          ? "done"
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
            // A human evaluator nobody filled in yet stays: its row reads "No value yet".
            .filter(
                (result) =>
                    result.summary.state !== "notRun" || appFailed || isHumanOrigin(result.origin),
            )
    )
}

/** The reviews of one automatic evaluator's result: the user's own answer, and every review. */
export interface ScenarioResultReviews {
    own: JudgeVerdict | null
    all: readonly {id: string; verdict: JudgeVerdict; authorId: string | null; at: string | null}[]
}

/** "Dana agreed · 2 days ago": one review under an evaluator's row. */
const ReviewLine = ({
    review,
}: {
    review: {verdict: JudgeVerdict; authorId: string | null; at: string | null}
}) => {
    const t = useT(annotateCatalog)
    const name = useUserDisplayName(review.authorId ?? undefined)
    const time = review.at ? timeAgo(Date.parse(review.at)) : null
    if (!name || name === "-") return null
    return (
        <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
            <InitialsAvatar name={name} className="h-4 w-4 text-caption" />
            {t(
                review.verdict === "agree"
                    ? "evaluations.scenarioFocusAnnotate.nameAgreed"
                    : "evaluations.scenarioFocusAnnotate.nameDisagreed",
                {name, time: time ?? ""},
            )}
        </span>
    )
}

/**
 * The Results tab: one row per evaluator that is not human, failed first, then the human
 * evaluators in their own group with True / False. Each row has its trace button and, on expand,
 * the evaluator call's duration, tokens and cost. A judge row shows the user's own review mark,
 * which opens the Annotate panel at that judge, and the count of all reviews.
 */
export const ScenarioFocusResultsTab = ({
    results,
    hasEvaluators,
    reviews,
    onOpenPanel,
}: {
    results: ScenarioEvaluatorResult[]
    /** The run has evaluators, though none may have a result on this test case. */
    hasEvaluators: boolean
    /** The saved reviews of each automatic evaluator, by result id. */
    reviews?: ReadonlyMap<string, ScenarioResultReviews>
    /** Opens the Annotate panel at one evaluator; absent without `edit_annotations`. */
    onOpenPanel?: (resultId: string) => void
}) => {
    const t = useT(focusCatalog, traceSpanCatalog, annotateCatalog)
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
        const review = reviews?.get(id)
        const others = review ? review.all.length - (review.own ? 1 : 0) : 0
        return {
            id,
            name,
            summary,
            error,
            onOpenTrace: traceId ? () => openTrace({traceId}) : undefined,
            actions: (
                <>
                    {review?.own ? (
                        <Button
                            variant="outline"
                            size="xs"
                            disabled={!onOpenPanel}
                            onClick={() => onOpenPanel?.(id)}
                        >
                            {review.own === "agree" ? <Check /> : <X />}
                            {t(
                                review.own === "agree"
                                    ? "evaluations.scenarioFocusAnnotate.agreed"
                                    : "evaluations.scenarioFocusAnnotate.disagreed",
                            )}
                        </Button>
                    ) : null}
                    {others > 0 ? (
                        <span className="text-meta text-muted-foreground">
                            {t("evaluations.scenarioFocusAnnotate.reviewCount", {
                                count: review?.all.length ?? 0,
                            })}
                        </span>
                    ) : null}
                    {traceId ? (
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={t("evaluations.scenarioFocus.openStepTrace", {name})}
                            onClick={() => openTrace({traceId})}
                        >
                            <TreeView />
                        </Button>
                    ) : null}
                </>
            ),
            details:
                (metrics && hasExecutionMetrics(metrics)) || review?.all.length ? (
                    <div className="flex flex-col gap-1.5 pt-1">
                        {metrics && hasExecutionMetrics(metrics) ? (
                            <ExecutionMetricsDisplay metrics={metrics} variant="plain" />
                        ) : null}
                        {review?.all.map((item) => (
                            <ReviewLine key={item.id} review={item} />
                        ))}
                    </div>
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
                    <h3 className="m-0 flex items-baseline gap-2 border-0 border-b border-solid border-border-muted pb-2.5 text-label">
                        {t("evaluations.scenarioFocus.humanAnnotations")}
                        <span className="text-meta font-normal text-muted-foreground">
                            {t("evaluations.scenarioFocusAnnotate.notCountedInPassed")}
                        </span>
                    </h3>
                    <EvaluatorResultList
                        items={human.map((result) => {
                            const item = itemOf(result)
                            const empty =
                                result.summary.short.length === 0 &&
                                result.summary.text.length === 0
                            return {
                                ...item,
                                // Nobody filled it yet: an empty row that opens the panel.
                                summary: empty
                                    ? summarizeEvaluatorResult([], "done")
                                    : result.summary,
                                actions: empty ? (
                                    <>
                                        {onOpenPanel ? (
                                            <Button
                                                variant="ghost"
                                                size="xs"
                                                className="text-muted-foreground"
                                                onClick={() => onOpenPanel(result.id)}
                                            >
                                                {t("evaluations.scenarioFocusAnnotate.noValueYet")}
                                            </Button>
                                        ) : (
                                            <span className="text-meta text-muted-foreground">
                                                {t("evaluations.scenarioFocusAnnotate.noValueYet")}
                                            </span>
                                        )}
                                        {item.actions}
                                    </>
                                ) : (
                                    item.actions
                                ),
                                badge: (
                                    <Badge>{t("observabilityUi.traceSpan.evaluatorHuman")}</Badge>
                                ),
                                byline: result.step?.author ? (
                                    <UserAuthorLabel
                                        userId={result.step.author.userId}
                                        at={result.step.author.at}
                                    />
                                ) : undefined,
                                binaryWords: "trueFalse" as const,
                            }
                        })}
                    />
                </section>
            ) : null}
        </div>
    )
}
