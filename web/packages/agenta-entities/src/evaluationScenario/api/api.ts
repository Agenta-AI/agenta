/**
 * EvaluationScenario API functions — Fern-backed via the shared evaluations client.
 *
 * Endpoints: `POST /evaluations/scenarios/query`, `PATCH /evaluations/scenarios/`.
 */

// Reuse the shared evaluations Fern client (same /evaluations/* resource as runs).
import {getEvaluationsClient, projectScopedRequest} from "../../evaluationRun/api/client"
import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {
    evaluationScenariosResponseSchema,
    type EvaluationScenario,
    type EvaluationScenarioListParams,
    type SetEvaluationScenarioStatusesParams,
} from "../core"

/**
 * Query a run's scenarios. Endpoint: `POST /evaluations/scenarios/query`.
 */
export async function queryEvaluationScenarios({
    projectId,
    runId,
    limit = 1000,
}: EvaluationScenarioListParams): Promise<EvaluationScenario[]> {
    if (!projectId || !runId) return []

    const client = await getEvaluationsClient()
    const data = await client.queryScenarios(
        {scenario: {run_ids: [runId]}, windowing: {limit}},
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationScenariosResponseSchema,
        data,
        "[queryEvaluationScenarios]",
    )
    return validated?.scenarios ?? []
}

/**
 * Upsert scenario statuses. Endpoint: `PATCH /evaluations/scenarios/`.
 *
 * `EvaluationScenarioEdit` only carries id + status (+ flags/tags/meta), so this cannot
 * clobber scenario data.
 */
export async function setEvaluationScenarioStatuses({
    projectId,
    scenarios,
}: SetEvaluationScenarioStatusesParams): Promise<EvaluationScenario[]> {
    if (!projectId || !scenarios.length) return []

    const client = await getEvaluationsClient()
    const data = await client.editScenarios(
        {scenarios: scenarios as never},
        projectScopedRequest(projectId),
    )

    const validated = safeParseWithLogging(
        evaluationScenariosResponseSchema,
        data,
        "[setEvaluationScenarioStatuses]",
    )
    return validated?.scenarios ?? []
}
