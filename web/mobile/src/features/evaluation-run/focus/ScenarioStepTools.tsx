import type {MetricStats} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import valueViewCatalog from "@agenta/i18n/catalogs/chat.valueView"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {openTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {
    ExecutionMetricsDisplay,
    type ExecutionMetricsData,
} from "@agenta/ui/components/presentational"
import {Button} from "@agenta/ui/ui"
import {TreeView} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import type {ScenarioStep} from "../scenarios/scenarioColumns"

const DURATION = "attributes.ag.metrics.duration.cumulative"
const TOKENS = "attributes.ag.metrics.tokens.cumulative.total"
const COST = "attributes.ag.metrics.costs.cumulative.total"

const meanOf = (stats: MetricStats | null | undefined) =>
    stats?.mean ?? (stats?.sum !== undefined && stats.count ? stats.sum / stats.count : undefined)

/** The duration, tokens and cost of a call, from its metric stats by metric key. */
export const executionMetricsOf = (
    metrics: Record<string, MetricStats | null>,
): ExecutionMetricsData => ({
    durationMs: meanOf(metrics[DURATION]),
    totalTokens: meanOf(metrics[TOKENS]),
    totalCost: meanOf(metrics[COST]),
})

/** True when the call reported any of its duration, tokens or cost. */
export const hasExecutionMetrics = (metrics: ExecutionMetricsData) =>
    metrics.durationMs !== undefined ||
    metrics.totalTokens !== undefined ||
    metrics.totalCost !== undefined

/**
 * What one step left behind, beside its section title: a button that opens the step's trace in
 * the trace drawer, then the time, tokens and cost of the step's own call.
 */
export const ScenarioStepTools = ({title, step}: {title: string; step: ScenarioStep}) => {
    const t = useT(focusCatalog, valueViewCatalog)
    const openTrace = useSetAtom(openTraceDrawerAtom)
    const {traceId} = step
    const metrics = executionMetricsOf(step.metrics)

    return (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {traceId ? (
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("evaluations.scenarioFocus.openEvaluatorTrace", {name: title})}
                    title={t("chat.valueView.openTrace")}
                    onClick={() => openTrace({traceId})}
                >
                    <TreeView />
                </Button>
            ) : null}
            {hasExecutionMetrics(metrics) ? (
                <ExecutionMetricsDisplay metrics={metrics} size="small" />
            ) : null}
        </div>
    )
}
