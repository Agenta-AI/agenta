/**
 * Evaluation run actions: delete, edit the name and description, and stop or resume a live run.
 *
 * Each function throws when the request fails or when the response does not
 * confirm the action.
 *
 * @packageDocumentation
 */

import {getEvaluationsClient} from "@agenta/sdk/resources"
import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import {z} from "zod"

import {safeParseWithLogging} from "../../shared/utils/zodSchema"
import {buildRunEditBody, type RunEditInput} from "../core/runEdit"

/** `EvaluationRunIdsResponse`: the run ids the API deleted. */
const deletedRunsResponseSchema = z.object({run_ids: z.array(z.string())})

/** `SimpleEvaluationResponse`: `evaluation` is null when no run was found. */
const simpleEvaluationResponseSchema = z.object({evaluation: z.object({id: z.string()})})

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
    const response = await axios.delete(`${getAgentaApiUrl()}/evaluations/runs/`, {
        params: {project_id: projectId},
        data: {run_ids: runIds},
    })
    // The API returns only the ids it deleted in this call. A retry after the runs are gone
    // returns an empty list, which is still a confirmed response.
    if (!deletedRunsResponseSchema.safeParse(response?.data).success) {
        throw new Error("The runs were not deleted.")
    }
}

/**
 * `PATCH /simple/evaluations/{runId}`: set the run's name and description. The body repeats the
 * run's steps with their origins (see `buildRunEditBody`), so the run keeps its shape.
 */
export async function editEvaluationRun({
    projectId,
    run,
    name,
    description,
}: {
    projectId: string
    run: RunEditInput
    name: string
    description: string
}): Promise<void> {
    const {evaluation} = buildRunEditBody(run, {name, description})
    const response = await getEvaluationsClient().editSimpleEvaluation(
        {evaluation_id: run.id, evaluation},
        {queryParams: {project_id: projectId}},
    )
    if (!safeParseWithLogging(simpleEvaluationResponseSchema, response, "[editEvaluationRun]")) {
        throw new Error("The evaluation was not updated.")
    }
}

/** `POST /simple/evaluations/{runId}/start` */
export async function startOnlineEvaluation({
    projectId,
    runId,
}: EvaluationRunActionParams): Promise<void> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/evaluations/${runId}/start`,
        undefined,
        {params: {project_id: projectId}},
    )
    if (!simpleEvaluationResponseSchema.safeParse(response?.data).success) {
        throw new Error("The evaluation did not start.")
    }
}

/** `POST /simple/evaluations/{runId}/stop` */
export async function stopOnlineEvaluation({
    projectId,
    runId,
}: EvaluationRunActionParams): Promise<void> {
    const response = await axios.post(
        `${getAgentaApiUrl()}/simple/evaluations/${runId}/stop`,
        undefined,
        {params: {project_id: projectId}},
    )
    if (!simpleEvaluationResponseSchema.safeParse(response?.data).success) {
        throw new Error("The evaluation did not stop.")
    }
}
