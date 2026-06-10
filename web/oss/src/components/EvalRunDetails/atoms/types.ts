import type {IStepResponse} from "@agenta/evaluations/core"

/**
 * A scenario step as surfaced through the batch result.
 *
 * The batch fetcher stores camel-cased step responses (`IStepResponse`), but the eval-run
 * consumers also read backend snake_case / extended fields off each step at runtime
 * (e.g. `trace`, `trace_id`, `data`, `inputs`, `testcase_id`, including nested access like
 * `trace.nodes`). The index signature keeps those pass-through reads working without
 * asserting a precise shape for fields the batch fetcher forwards verbatim.
 */
export type ScenarioStepEntry = IStepResponse & Record<string, any>

/**
 * Per-scenario batch result produced by the scenario-steps batch fetcher.
 *
 * This describes the object shape that {@link scenarioStepsBatcherFamily} builds at
 * runtime (see `scenarioSteps.ts`): one entry per scenario id, holding the camel-cased
 * step responses for that scenario along with a count and an optional pagination cursor.
 *
 * `invocationSteps` / `annotationSteps` are optional sibling arrays some consumers read
 * defensively (`?.`); the batch fetcher does not currently populate them, so they are
 * `undefined` at runtime.
 */
export interface ScenarioStepsBatchResult {
    scenarioId: string
    steps: ScenarioStepEntry[]
    count: number
    next?: unknown
    invocationSteps?: ScenarioStepEntry[]
    annotationSteps?: ScenarioStepEntry[]
}
