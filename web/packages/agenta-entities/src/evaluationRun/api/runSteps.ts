/**
 * Changes to a run that exists: add steps (a human evaluator picked in the Annotate panel) and
 * open a closed run again.
 *
 * @packageDocumentation
 */

import {getEvaluationsClient} from "@agenta/sdk/resources"

import type {HumanRunStep} from "../core/humanRunConfig"

import type {EvaluationRunActionParams} from "./runActions"

/** `POST /simple/evaluations/{runId}/steps/add`. Adding a step key the run has is a no-op. */
export async function addRunSteps({
    projectId,
    runId,
    steps,
}: EvaluationRunActionParams & {steps: readonly HumanRunStep[]}): Promise<void> {
    if (steps.length === 0) return
    const response = await getEvaluationsClient().addSteps(
        {evaluation_id: runId, steps: [...steps]},
        {queryParams: {project_id: projectId}},
    )
    if (!response?.run) throw new Error("The evaluators were not added to the run.")
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
