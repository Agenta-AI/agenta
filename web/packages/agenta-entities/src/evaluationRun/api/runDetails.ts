/**
 * Run details API: the scenario pages of one run and the run-level metrics of a set of runs.
 *
 * Each function throws when the request fails or the response does not match its schema, so a
 * caller never mistakes a failed request for an empty result.
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import {z} from "zod"

import {evaluationMetricsResponseSchema, type EvaluationMetric} from "../core"

export const evaluationRunScenarioSchema = z.object({
    id: z.string(),
    run_id: z.string(),
    status: z.string().nullable().optional(),
    testcase_id: z.string().nullable().optional(),
    timestamp: z.string().nullable().optional(),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    created_by_id: z.string().nullable().optional(),
})
export type EvaluationRunScenario = z.infer<typeof evaluationRunScenarioSchema>

const scenariosPageResponseSchema = z.object({
    scenarios: z.array(evaluationRunScenarioSchema).default([]),
    windowing: z.object({next: z.string().nullable().optional()}).nullable().optional(),
})

export interface EvaluationScenariosPageParams {
    projectId: string
    runId: string
    limit: number
    cursor?: string | null
    /** "descending" for online runs (newest first), "ascending" for the others. */
    order: "ascending" | "descending"
}

export interface EvaluationScenariosPage {
    scenarios: EvaluationRunScenario[]
    nextCursor: string | null
}

function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
    const parsed = schema.safeParse(data)
    if (!parsed.success) throw new Error(`The ${what} response did not match the expected shape.`)
    return parsed.data
}

/** `POST /evaluations/scenarios/query`: one window of a run's scenarios. */
export async function queryEvaluationScenariosPage({
    projectId,
    runId,
    limit,
    cursor,
    order,
}: EvaluationScenariosPageParams): Promise<EvaluationScenariosPage> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluations/scenarios/query`,
        {
            scenario: {run_ids: [runId]},
            windowing: {limit, order, ...(cursor ? {next: cursor} : {})},
        },
        {params: {project_id: projectId}},
    )
    const page = parseOrThrow(scenariosPageResponseSchema, response?.data, "scenarios")
    return {scenarios: page.scenarios, nextCursor: page.windowing?.next ?? null}
}

/**
 * `POST /evaluations/metrics/query` for the run-level rows of a set of runs (no scenario rows).
 *
 * One request returns both the static row of each run and, for online runs, the rows with a
 * `timestamp`: the body sends no `timestamps` filter, so the API does not narrow by it.
 */
export async function queryRunLevelMetrics({
    projectId,
    runIds,
}: {
    projectId: string
    runIds: string[]
}): Promise<EvaluationMetric[]> {
    if (runIds.length === 0) return []
    const response = await axios.post(
        `${getAgentaApiUrl()}/evaluations/metrics/query`,
        {metrics: {run_ids: runIds, scenario_ids: false}},
        {params: {project_id: projectId}},
    )
    return parseOrThrow(evaluationMetricsResponseSchema, response?.data, "metrics").metrics
}
