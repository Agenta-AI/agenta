/**
 * @agenta/entities/evaluationRun/etl
 *
 * Eval-specific ETL adapters. See docs/designs/eval-etl-engine.md for
 * the design.
 *
 * Currently exposed:
 *   - makeRealScenarioSource: minimal real Source that hits
 *     /evaluations/scenarios/query directly. Used by the PoC; will
 *     eventually be replaced by makeSource(scenariosPaginatedStore)
 *     once Phase 1-2 of the architecture RFC lands.
 *
 * @packageDocumentation
 */

export type {RealEvaluationScenario, RealScenarioSourceParams} from "./realScenarioSource"
export {makeRealScenarioSource} from "./realScenarioSource"
