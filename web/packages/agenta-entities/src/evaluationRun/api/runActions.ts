/**
 * Evaluation run actions: delete, edit the name and description, and stop or resume a live run.
 *
 * Each function throws when the request fails or when the response does not
 * confirm the action.
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"
import {z} from "zod"

import {buildRunEditBody, type RunEditInput} from "../core/runEdit"

import {queryEvaluationScenariosPage} from "./runDetails"

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
 * `PATCH /simple/evaluations/{runId}`: set the run's name and description, and add evaluators.
 * The body repeats the run's steps with their origins (see `buildRunEditBody`), so the run keeps
 * its shape.
 */
export async function editEvaluationRun({
    projectId,
    run,
    name,
    description,
    addedEvaluatorRevisionIds,
}: {
    projectId: string
    run: RunEditInput
    name: string
    description: string
    addedEvaluatorRevisionIds?: readonly string[]
}): Promise<void> {
    const response = await axios.patch(
        `${getAgentaApiUrl()}/simple/evaluations/${run.id}`,
        buildRunEditBody(run, {name, description, addedEvaluatorRevisionIds}),
        {params: {project_id: projectId}},
    )
    if (!simpleEvaluationResponseSchema.safeParse(response?.data).success) {
        throw new Error("The evaluation was not updated.")
    }
}

const SCENARIO_PAGE_SIZE = 500

/** Every scenario id of a run, page by page. */
async function runScenarioIds(projectId: string, runId: string): Promise<string[]> {
    const ids: string[] = []
    let cursor: string | null = null
    do {
        const page = await queryEvaluationScenariosPage({
            projectId,
            runId,
            limit: SCENARIO_PAGE_SIZE,
            cursor,
            order: "ascending",
        })
        for (const scenario of page.scenarios) ids.push(scenario.id)
        cursor = page.scenarios.length > 0 ? page.nextCursor : null
    } while (cursor)
    return ids
}

/**
 * `POST /simple/evaluations/{runId}/process` over every scenario of the run, without overwriting:
 * the run's new evaluators fill their empty cells, the old results stay. The API answers before
 * the work is done and sets the run to running. Returns the number of scenarios sent.
 */
export async function processNewEvaluatorSteps({
    projectId,
    runId,
}: EvaluationRunActionParams): Promise<number> {
    const scenarioIds = await runScenarioIds(projectId, runId)
    if (scenarioIds.length === 0) return 0
    await axios.post(
        `${getAgentaApiUrl()}/simple/evaluations/${runId}/process`,
        {scenario_ids: scenarioIds, overwrite: false},
        {params: {project_id: projectId}},
    )
    return scenarioIds.length
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
