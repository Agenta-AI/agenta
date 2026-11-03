/**
 * Evaluation run creation.
 *
 * Auto evaluations go through `POST /simple/evaluations/`, one run per app
 * revision. Human evaluations are built on the client: a run, one scenario per
 * test case, and the empty step results the annotation form fills in.
 *
 * Every function throws when its request fails.
 *
 * @packageDocumentation
 */

import {getAgentaApiUrl, axios} from "@agenta/shared/api"

import {testcasesResponseSchema} from "../../testcase/core/schema"
import type {HumanRunSpec} from "../core/humanRunConfig"
import {
    buildQuerySlug,
    toFilteringPayload,
    toWindowingPayload,
    type LiveFilterRow,
    type LiveQueryData,
} from "../core/liveQuery"

import {deleteEvaluationRuns} from "./runActions"

// ============================================================================
// AUTO EVALUATION
// ============================================================================

export interface EvaluationConcurrency {
    batch_size: number
    max_retries: number
    retry_delay: number
}

export const DEFAULT_EVALUATION_CONCURRENCY: EvaluationConcurrency = {
    batch_size: 10,
    max_retries: 3,
    retry_delay: 3,
}

export interface CreateAutoEvaluationRunsParams {
    projectId: string
    name: string
    testsetRevisionId: string
    /** One run is created per app revision. */
    applicationRevisionIds: string[]
    evaluatorRevisionIds: string[]
    concurrency?: EvaluationConcurrency
}

export interface CreateAutoEvaluationRunsResult {
    /** Ids of the created runs, in the order of `applicationRevisionIds`, without the failed ones. */
    runIds: string[]
    /** App revisions whose run could not be created. */
    failedRevisionIds: string[]
}

/**
 * Create one auto evaluation run per app revision with the same name.
 * A run holds exactly one app, so comparing revisions means separate runs.
 *
 * Does not throw when only some requests fail: read `failedRevisionIds`.
 * Throws when every request fails.
 */
export async function createAutoEvaluationRuns({
    projectId,
    name,
    testsetRevisionId,
    applicationRevisionIds,
    evaluatorRevisionIds,
    concurrency = DEFAULT_EVALUATION_CONCURRENCY,
}: CreateAutoEvaluationRunsParams): Promise<CreateAutoEvaluationRunsResult> {
    if (applicationRevisionIds.length === 0) {
        throw new Error("Select at least one app revision to evaluate.")
    }

    const evaluatorSteps = Object.fromEntries(evaluatorRevisionIds.map((id) => [id, "auto"]))

    const settled = await Promise.allSettled(
        applicationRevisionIds.map((revisionId) =>
            axios
                .post(
                    `${getAgentaApiUrl()}/simple/evaluations/`,
                    {
                        evaluation: {
                            name,
                            data: {
                                testset_steps: {[testsetRevisionId]: "auto"},
                                application_steps: {[revisionId]: "auto"},
                                evaluator_steps: evaluatorSteps,
                                concurrency,
                            },
                            flags: {is_live: false, is_active: true, is_closed: false},
                        },
                    },
                    {params: {project_id: projectId}},
                )
                .then((response): string => {
                    const runId = response.data?.evaluation?.id
                    if (typeof runId !== "string") {
                        throw new Error("The evaluation response has no run id.")
                    }
                    return runId
                }),
        ),
    )

    const runIds: string[] = []
    const failedRevisionIds: string[] = []
    let firstError: unknown
    settled.forEach((result, index) => {
        if (result.status === "fulfilled") {
            runIds.push(result.value)
        } else {
            failedRevisionIds.push(applicationRevisionIds[index])
            firstError ??= result.reason
        }
    })

    if (runIds.length === 0) throw firstError
    return {runIds, failedRevisionIds}
}

// ============================================================================
// HUMAN EVALUATION
// ============================================================================

const TESTCASE_PAGE_SIZE = 500

/**
 * Ids of every test case in a test set revision.
 *
 * Does not use `fetchTestcasesPage`: that function turns a failed request into an
 * empty page, and a short list here would create a run with missing scenarios.
 */
export async function fetchAllTestcaseIds({
    projectId,
    testsetRevisionId,
}: {
    projectId: string
    testsetRevisionId: string
}): Promise<string[]> {
    const ids: string[] = []
    let cursor: string | null = null

    do {
        const response = await axios.post(
            `${getAgentaApiUrl()}/testcases/query`,
            {
                testset_revision_ref: {id: testsetRevisionId},
                windowing: {limit: TESTCASE_PAGE_SIZE, ...(cursor ? {next: cursor} : {})},
            },
            {params: {project_id: projectId}},
        )
        const page = testcasesResponseSchema.parse(response.data)
        ids.push(...page.testcases.map((testcase) => testcase.id))
        cursor = page.windowing?.next || null
    } while (cursor)

    return ids
}

/**
 * Create a human evaluation: the run, one scenario per test case, and one empty
 * result per scenario and step.
 *
 * When a later request fails, the new run is deleted (best effort) and the
 * error is thrown, so no half-made run stays in the list.
 */
export async function createHumanEvaluationRun({
    projectId,
    spec,
    testcaseIds,
}: {
    projectId: string
    spec: HumanRunSpec
    testcaseIds: string[]
}): Promise<{runId: string}> {
    if (testcaseIds.length === 0) throw new Error("The test set has no test cases.")

    const params = {project_id: projectId}
    const baseUrl = getAgentaApiUrl()

    const runResponse = await axios.post(`${baseUrl}/evaluations/runs/`, {runs: [spec]}, {params})
    const runId = runResponse.data?.runs?.[0]?.id
    if (typeof runId !== "string") throw new Error("The evaluation response has no run id.")

    try {
        const scenarioResponse = await axios.post(
            `${baseUrl}/evaluations/scenarios/`,
            {scenarios: testcaseIds.map(() => ({run_id: runId}))},
            {params},
        )
        const scenarioIds: string[] = (scenarioResponse.data?.scenarios ?? []).map(
            (scenario: {id: string}) => scenario.id,
        )
        if (scenarioIds.length !== testcaseIds.length) {
            throw new Error("The scenarios do not match the test cases.")
        }

        // Only the input step is done. The other steps wait for the app output and the annotation.
        const [inputStep, ...otherSteps] = spec.data.steps
        const results = scenarioIds.flatMap((scenarioId, index) => {
            const base = {testcase_id: testcaseIds[index], scenario_id: scenarioId, run_id: runId}
            return [
                {...base, status: "success", step_key: inputStep.key},
                ...otherSteps.map((step) => ({...base, step_key: step.key})),
            ]
        })
        const resultsResponse = await axios.post(
            `${baseUrl}/evaluations/results/`,
            {results},
            {params},
        )
        // The API can answer 200 with an empty list when the insert failed on its side.
        if ((resultsResponse.data?.results ?? []).length !== results.length) {
            throw new Error("The step results were not saved.")
        }
    } catch (error) {
        await deleteEvaluationRuns({projectId, runIds: [runId]}).catch(() => undefined)
        throw error
    }

    return {runId}
}

// ============================================================================
// LIVE EVALUATION
// ============================================================================

export interface CreateLiveEvaluationParams {
    projectId: string
    name: string
    description: string
    /** Every filter row, the locked invocation row included. */
    filters: LiveFilterRow[]
    /** Percent between 0 and 100, or null for no sampling. */
    samplingRate: number | null
    evaluatorRevisionId: string
    /** Makes the query slug unique; passed in so tests are stable. */
    slugSuffix: string
}

/**
 * Create a live evaluation: the trace query, then a live run that reads the
 * query revision and runs one evaluator on each matching trace.
 *
 * The API starts the run on create, whatever `is_active` says. When a request
 * after the query fails, the query is archived (best effort) and the error is
 * thrown, so no orphan query stays behind.
 */
export async function createLiveEvaluation({
    projectId,
    name,
    description,
    filters,
    samplingRate,
    evaluatorRevisionId,
    slugSuffix,
}: CreateLiveEvaluationParams): Promise<{runId: string}> {
    const params = {project_id: projectId}
    const baseUrl = getAgentaApiUrl()

    const data: LiveQueryData = {}
    const filtering = toFilteringPayload(filters)
    const windowing = toWindowingPayload(samplingRate)
    if (filtering) data.filtering = filtering
    if (windowing) data.windowing = windowing

    const queryResponse = await axios.post(
        `${baseUrl}/simple/queries/`,
        {
            query: {
                slug: buildQuerySlug(name, slugSuffix),
                name,
                description,
                ...(filtering || windowing ? {data} : {}),
            },
        },
        {params},
    )
    const queryId = queryResponse.data?.query?.id
    if (typeof queryId !== "string") throw new Error("The query response has no query id.")

    try {
        const revisionResponse = await axios.post(
            `${baseUrl}/queries/revisions/retrieve`,
            {query_ref: {id: queryId}},
            {params},
        )
        const queryRevisionId = revisionResponse.data?.query_revision?.id
        if (typeof queryRevisionId !== "string") {
            throw new Error("The query has no query revision.")
        }

        const evaluationResponse = await axios.post(
            `${baseUrl}/simple/evaluations/`,
            {
                evaluation: {
                    name,
                    description,
                    flags: {is_live: true, is_closed: false, is_active: false},
                    data: {
                        status: "pending",
                        query_steps: {[queryRevisionId]: "auto"},
                        evaluator_steps: {[evaluatorRevisionId]: "auto"},
                        repeats: 1,
                    },
                },
            },
            {params},
        )
        const runId = evaluationResponse.data?.evaluation?.id
        if (typeof runId !== "string") throw new Error("The evaluation response has no run id.")
        return {runId}
    } catch (error) {
        await axios
            .post(`${baseUrl}/simple/queries/${queryId}/archive`, undefined, {params})
            .catch((archiveError: unknown) =>
                console.error("Could not archive the live evaluation query", archiveError),
            )
        throw error
    }
}
