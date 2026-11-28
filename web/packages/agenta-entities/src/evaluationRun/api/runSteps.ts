/**
 * Changes to a run that exists: add steps (a human evaluator picked in the Annotate panel) and
 * open a closed run again.
 *
 * @packageDocumentation
 */

import {getEvaluationsClient} from "@agenta/sdk/resources"

import type {HumanRunMapping, HumanRunStep} from "../core/humanRunConfig"

import type {EvaluationRunActionParams} from "./runActions"

/**
 * `POST /simple/evaluations/{runId}/steps/add`, then the steps' columns: the route adds steps
 * only, and a run's tables show only the values a mapping names, so `PATCH
 * /evaluations/runs/{runId}` appends the mappings the run does not have yet. A step key the run
 * has already is skipped.
 */
export async function addRunSteps({
    projectId,
    runId,
    steps,
    mappings = [],
}: EvaluationRunActionParams & {
    steps: readonly HumanRunStep[]
    mappings?: readonly HumanRunMapping[]
}): Promise<void> {
    if (steps.length === 0) return
    const client = getEvaluationsClient()
    const options = {queryParams: {project_id: projectId}}
    const {run} = await client.addSteps({evaluation_id: runId, steps: [...steps]}, options)
    if (!run?.data) throw new Error("The evaluators were not added to the run.")
    const existing = run.data.mappings ?? []
    const known = new Set(existing.map((mapping) => `${mapping.step?.key}|${mapping.step?.path}`))
    const fresh = mappings.filter(
        (mapping) => !known.has(`${mapping.step.key}|${mapping.step.path}`),
    )
    if (fresh.length === 0) return
    const edited = await client.editRun(
        {
            run_id: runId,
            run: {
                id: run.id,
                name: run.name,
                description: run.description,
                flags: run.flags,
                tags: run.tags,
                meta: run.meta,
                status: run.status,
                data: {...run.data, mappings: [...existing, ...fresh]},
            },
        },
        options,
    )
    if (!edited?.run) throw new Error("The evaluators' columns were not added to the run.")
}

/** `POST /evaluations/runs/{runId}/open`: a closed run takes annotations again. */
export async function openEvaluationRun({
    projectId,
    runId,
}: EvaluationRunActionParams): Promise<void> {
    const response = await getEvaluationsClient().openRun(
        {run_id: runId},
        {queryParams: {project_id: projectId}},
    )
    if (!response?.run) throw new Error("The run was not opened.")
}
