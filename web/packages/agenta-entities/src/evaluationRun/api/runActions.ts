/**
 * Evaluation run actions: delete, and stop or resume a live run.
 *
 * Each function throws when the request fails or when the response does not
 * confirm the action.
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import {z} from "zod"

/** `EvaluationRunIdsResponse`: the run ids the API deleted. */
const deletedRunsResponseSchema = z.object({run_ids: z.array(z.string())})

/** `SimpleEvaluationResponse`: `evaluation` is null when no run was found. */
const simpleEvaluationResponseSchema = z.object({evaluation: z.object({id: z.string()})})

/** `EvaluationRunResponse`: `run` is null when no run was found. */
const runResponseSchema = z.object({run: z.object({id: z.string()})})

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

/**
 * Rename a run and set its description: `PATCH /evaluations/runs/{runId}`.
 *
 * The API sets a run's references to null when the edit has no `data`. So this reads the run as
 * the API stores it and sends its `data` back unchanged with the new `name` and `description`.
 * The run comes from a fresh read, not from the cached run: the cached run is parsed, and a parse
 * drops the fields the schema does not list. `status`, `flags`, `tags` and `meta` stay out of the
 * body on purpose. The API keeps a field the edit leaves out, and a copy read a moment ago could
 * undo a status change made in between. An empty `description` clears it; a missing one would not.
 */
export async function editEvaluationRunMeta({
    projectId,
    runId,
    name,
    description,
}: EvaluationRunActionParams & {name: string; description: string}): Promise<void> {
    const params = {project_id: projectId}
    const url = `${getAgentaApiUrl()}/evaluations/runs/${runId}`
    const read = await axios.get(url, {params})
    const stored = read?.data?.run
    if (!stored || typeof stored !== "object" || stored.id !== runId) {
        throw new Error("The run was not found.")
    }

    const run = {id: runId, name, description, ...(stored.data ? {data: stored.data} : {})}
    const response = await axios.patch(url, {run}, {params})
    if (!runResponseSchema.safeParse(response?.data).success) {
        throw new Error("The run was not updated.")
    }
}
