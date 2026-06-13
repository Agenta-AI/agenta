/**
 * evaluationResultMolecule — minimal entity layer for evaluation results.
 *
 * Results are *read-only* from the UI's perspective (the user doesn't edit a
 * result; the eval engine produces them). The molecule's surface is therefore
 * tiny:
 *
 *   .get.byScenario(args)                   imperative cache read
 *   .actions.prefetchByScenarioIds(args)    cache-aware bulk fetch
 *   .actions.invalidate(args)               drop a scenario's cache entry
 *   .actions.evictByRunId / evictByScenarioIds   bulk memory release
 *
 * Cache key: `["evaluation-results", projectId, runId, scenarioId]`; value is
 * `EvaluationResult[]` (the steps for that scenario). All the cache machinery
 * lives in the shared {@link createScenarioCacheMolecule} factory — this file
 * just binds it to the result type, fetcher, and cache-key prefix.
 *
 * @packageDocumentation
 */

import {queryEvaluationResults} from "../api"
import type {EvaluationResult} from "../core"

import {
    createScenarioCacheMolecule,
    type PrefetchScenarioArgs,
    type ScenarioCacheOutcome,
} from "./scenarioCacheMolecule"

export type PrefetchResultsArgs = PrefetchScenarioArgs
export type PrefetchResultsOutcome = ScenarioCacheOutcome<EvaluationResult, "results">

export const evaluationResultMolecule = createScenarioCacheMolecule<EvaluationResult, "results">({
    keyPrefix: "evaluation-results",
    listKey: "results",
    fetch: (args) => queryEvaluationResults(args),
    getScenarioId: (r) => r.scenario_id,
})

export type EvaluationResultMolecule = typeof evaluationResultMolecule
