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

import {STEP_METRICS, type ScenarioStep} from "../scenarios/scenarioColumns"

const metricKeyOf = (id: string) => STEP_METRICS.find((metric) => metric.id === id)?.metricKey ?? id
const DURATION = metricKeyOf("duration")
const TOKENS = metricKeyOf("tokens")
const COST = metricKeyOf("cost")

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
                    aria-label={t("evaluations.scenarioFocus.openStepTrace", {name: title})}
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
