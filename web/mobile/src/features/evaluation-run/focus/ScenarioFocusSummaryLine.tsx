import {AssertionSummary} from "@agenta/chat/value-view"
import {assertionSummary, splitByOrigin, TILE_MISSING} from "@agenta/entities/evaluationRun"
import {useT} from "@agenta/i18n"
import focusCatalog from "@agenta/i18n/catalogs/evaluations.scenarioFocus"
import {formatCurrency, formatLatency, formatTokens} from "@agenta/shared/utils"

import type {ScenarioRow} from "../scenarios/scenarioColumns"

import type {ScenarioEvaluatorResult} from "./ScenarioFocusResultsTab"
import {executionMetricsOf} from "./ScenarioStepTools"

/** One header tile, drawn as `AssertionSummary` draws its own. */
const Tile = ({label, value}: {label: string; value: string}) => (
    <div className="flex min-w-0 flex-col">
        <span className="truncate text-meta text-muted-foreground">{label}</span>
        <span className="whitespace-nowrap text-metric tabular-nums">{value}</span>
    </div>
)

/** A test case metric as tile text, or the run tiles' missing mark. */
const tileText = (value: number | undefined, format: (value: number) => string) =>
    value === undefined ? TILE_MISSING : format(value)

/**
 * The line under the drawer's title: "Passed X of Y" over the true or false metrics of the
 * evaluators that are not human, else their main numbers, never "Passed" without such a metric;
 * then the test case's duration, tokens and cost. A missing value shows a dash.
 */
export const ScenarioFocusSummaryLine = ({
    row,
    results,
}: {
    row: ScenarioRow
    results: ScenarioEvaluatorResult[]
}) => {
    const t = useT(focusCatalog)
    // Human values never count: only the evaluators that are not human make "Passed X of Y".
    const {notHuman} = splitByOrigin(results)
    const metrics = executionMetricsOf(row.metrics)
    return (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 pt-3 sm:grid-cols-4">
            <AssertionSummary
                summary={assertionSummary(notHuman.map((result) => result.summary))}
            />
            <Tile
                label={t("evaluations.scenarioFocus.duration")}
                value={tileText(metrics.durationMs, (ms) => formatLatency(ms / 1000))}
            />
            <Tile
                label={t("evaluations.scenarioFocus.tokens")}
                value={tileText(metrics.totalTokens, formatTokens)}
            />
            <Tile
                label={t("evaluations.scenarioFocus.cost")}
                value={tileText(metrics.totalCost, formatCurrency)}
            />
        </div>
    )
}
