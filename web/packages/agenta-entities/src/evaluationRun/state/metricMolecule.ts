/**
 * evaluationMetricMolecule — minimal entity layer for per-scenario metrics.
 *
 * Same shape and cache machinery as {@link evaluationResultMolecule} (both bind
 * the shared {@link createScenarioCacheMolecule} factory). Metrics are read-only
 * from the UI's perspective. Cache key: `["evaluation-metrics", projectId,
 * runId, scenarioId]`; value: `EvaluationMetric[]` (typically one per scenario,
 * but the API doesn't constrain it — could be multiple).
 *
 * Unlike results, a metric's `scenario_id` may be null/absent — those are
 * run-level aggregates, which this molecule drops (`skipItemsWithoutScenarioId`)
 * so they never land under a bogus scenario key.
 *
 * @packageDocumentation
 */

import {queryEvaluationMetrics} from "../api"
import type {EvaluationMetric} from "../core"

import {createScenarioCacheMolecule} from "./scenarioCacheMolecule"

export const evaluationMetricMolecule = createScenarioCacheMolecule<EvaluationMetric, "metrics">({
    keyPrefix: "evaluation-metrics",
    listKey: "metrics",
    fetch: (args) => queryEvaluationMetrics(args),
    getScenarioId: (m) => m.scenario_id,
    skipItemsWithoutScenarioId: true, // run-level aggregates have no scenario_id
})
