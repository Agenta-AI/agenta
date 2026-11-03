/**
 * Evaluation run actions: delete, and stop or resume a live run.
 *
 * Each function throws when the request fails.
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

export interface EvaluationRunActionParams {
    projectId: string
    runId: string
}

/** `DELETE /evaluations/runs/` */
export async function deleteEvaluationRuns({
    projectId,
    runIds,
}: {
    projectId: string
    runIds: string[]
}): Promise<void> {
    if (runIds.length === 0) return
    await axios.delete(`${getAgentaApiUrl()}/evaluations/runs/`, {
        params: {project_id: projectId},
        data: {run_ids: runIds},
    })
}

/** `POST /simple/evaluations/{runId}/start` */
export async function startOnlineEvaluation({
    projectId,
    runId,
}: EvaluationRunActionParams): Promise<void> {
    await axios.post(`${getAgentaApiUrl()}/simple/evaluations/${runId}/start`, undefined, {
        params: {project_id: projectId},
    })
}

/** `POST /simple/evaluations/{runId}/stop` */
export async function stopOnlineEvaluation({
    projectId,
    runId,
}: EvaluationRunActionParams): Promise<void> {
    await axios.post(`${getAgentaApiUrl()}/simple/evaluations/${runId}/stop`, undefined, {
        params: {project_id: projectId},
    })
}
