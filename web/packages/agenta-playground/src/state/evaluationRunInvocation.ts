/**
 * Run the app of a human evaluation for one scenario: call the run's app revision with the
 * scenario's test case, then store the output on the scenario's invocation step. A human run
 * starts with no output, and its scenarios cannot be annotated until this has run.
 *
 * It lives here, not in `@agenta/entities`, because it calls `executeWorkflowRevision`.
 */

import {
    evaluationMetricMolecule,
    evaluationResultMolecule,
    evaluationRunQueryKey,
    fetchEvaluationRun,
    queryEvaluationResults,
    runLevelMetricsQueryKey,
    type EvaluationRun,
} from "@agenta/entities/evaluationRun"
import {fetchTestcase} from "@agenta/entities/testcase"
import {fetchWorkflowRevisionById, workflowMolecule} from "@agenta/entities/workflow"
import {axios, getAgentaApiUrl, getHostQueryClient} from "@agenta/shared/api"

import {executeWorkflowRevision} from "../executeWorkflowRevision"

export interface RunScenarioInvocationParams {
    projectId: string
    runId: string
    scenarioId: string
    /** The key of the run's invocation step to run. */
    stepKey: string
}

export type RunScenarioInvocationResult =
    | {ok: true}
    | {
          ok: false
          /**
           * `missing-reference`: the run or scenario lacks the app revision or the test case.
           * `invocation-failed`: the app answered with an error (stored on the step).
           * `request-failed`: a request to the API failed.
           * `run-closed`: the run is closed; the API would refuse the result, so the app is not called.
           */
          reason: "missing-reference" | "invocation-failed" | "request-failed" | "run-closed"
          /** Technical detail for the logs, not for the user. */
          detail: string
      }

/** Calls in progress by `scenarioId:stepKey`, so a second click joins the first call. */
const inFlight = new Map<string, Promise<RunScenarioInvocationResult>>()

export function runScenarioInvocation(
    params: RunScenarioInvocationParams,
): Promise<RunScenarioInvocationResult> {
    const key = `${params.scenarioId}:${params.stepKey}`
    const running = inFlight.get(key)
    if (running) return running
    const call = invoke(params).finally(() => inFlight.delete(key))
    inFlight.set(key, call)
    return call
}

const missing = (detail: string): RunScenarioInvocationResult => ({
    ok: false,
    reason: "missing-reference",
    detail,
})

async function invoke({
    projectId,
    runId,
    scenarioId,
    stepKey,
}: RunScenarioInvocationParams): Promise<RunScenarioInvocationResult> {
    try {
        const run =
            getHostQueryClient().getQueryData<EvaluationRun | null>(evaluationRunQueryKey(runId)) ??
            (await fetchEvaluationRun({id: runId, projectId}))
        if (run?.flags?.is_closed) {
            return {ok: false, reason: "run-closed", detail: `Run ${runId} is closed.`}
        }
        const steps = run?.data?.steps ?? []
        const step = steps.find((entry) => entry.key === stepKey && entry.type === "invocation")
        const refs = step?.references ?? {}
        const applicationId = refs.application?.id
        const revisionId = refs.application_revision?.id
        if (!applicationId || !revisionId) {
            return missing(`The invocation step ${stepKey} has no application or revision.`)
        }
        const references = {
            application: {id: applicationId},
            ...(refs.application_variant?.id
                ? {application_variant: {id: refs.application_variant.id}}
                : {}),
            application_revision: {id: revisionId},
        }

        const revision = await fetchWorkflowRevisionById(revisionId, projectId)
        // The runner reads the revision from the workflow molecule.
        workflowMolecule.set.seedEntity(revisionId, revision)

        const inputKeys = new Set(
            steps.filter((entry) => entry.type === "input").map((entry) => entry.key),
        )
        const results = await queryEvaluationResults({projectId, runId, scenarioIds: [scenarioId]})
        const testcaseId = results.find((result) => inputKeys.has(result.step_key))?.testcase_id
        const failedBefore = FAILED_STATUSES.has(
            results.find((result) => result.step_key === stepKey)?.status?.toLowerCase() ?? "",
        )
        if (!testcaseId) return missing(`Scenario ${scenarioId} has no test case.`)
        const testcase = await fetchTestcase({projectId, testcaseId})
        if (!testcase) throw new Error(`Test case ${testcaseId} did not load.`)

        const execution = await executeWorkflowRevision({
            revisionId,
            inputData: (testcase.data ?? {}) as Record<string, unknown>,
            projectId,
        })
        const succeeded = execution.status === "success"
        const errorMessage = execution.error?.message ?? "Invocation failed"

        // A success after a failure sets the scenario back to waiting before the success is
        // stored: if this request fails, the result stays failed and Run is offered again.
        if (succeeded && failedBefore) await setScenarioStatus(projectId, scenarioId, "pending")
        await upsertInvocationResult(projectId, {
            run_id: runId,
            scenario_id: scenarioId,
            step_key: stepKey,
            status: succeeded ? "success" : "failure",
            ...(execution.traceId ? {trace_id: traceIdToUuid(execution.traceId)} : {}),
            ...(succeeded && execution.spanId ? {span_id: spanIdToUuid(execution.spanId)} : {}),
            references,
            ...(succeeded ? {outputs: execution.output} : {error: {message: errorMessage}}),
        })
        if (succeeded) await refreshMetrics(projectId, runId, scenarioId)
        else await setScenarioStatus(projectId, scenarioId, "failure")
        invalidateScenario(projectId, runId, scenarioId)

        return succeeded
            ? {ok: true}
            : {ok: false, reason: "invocation-failed", detail: errorMessage}
    } catch (error) {
        return {
            ok: false,
            reason: "request-failed",
            detail: error instanceof Error ? error.message : String(error),
        }
    }
}

const FAILED_STATUSES = new Set(["failure", "failed", "error", "errors"])

async function setScenarioStatus(projectId: string, scenarioId: string, status: string) {
    await axios.patch(
        `${getAgentaApiUrl()}/evaluations/scenarios/`,
        {scenarios: [{id: scenarioId, status}]},
        {params: {project_id: projectId}},
    )
}

/** The API upserts on (run, scenario, step key), so one POST creates or replaces the result. */
async function upsertInvocationResult(projectId: string, result: Record<string, unknown>) {
    await axios.post(
        `${getAgentaApiUrl()}/evaluations/results/`,
        {results: [result]},
        {params: {project_id: projectId}},
    )
}

/** The scenario's metrics, then the run's aggregate. A failure is logged only: the output is stored. */
async function refreshMetrics(projectId: string, runId: string, scenarioId: string) {
    try {
        for (const metrics of [{run_id: runId, scenario_id: scenarioId}, {run_id: runId}]) {
            await axios.post(
                `${getAgentaApiUrl()}/evaluations/metrics/refresh`,
                {metrics},
                {params: {project_id: projectId}},
            )
        }
    } catch (error) {
        console.warn("[runScenarioInvocation] Metrics refresh failed:", error)
    }
}

function invalidateScenario(projectId: string, runId: string, scenarioId: string) {
    const client = getHostQueryClient()
    evaluationResultMolecule.actions.evictByScenarioIds({
        projectId,
        runId,
        scenarioIds: [scenarioId],
    })
    evaluationMetricMolecule.actions.evictByScenarioIds({
        projectId,
        runId,
        scenarioIds: [scenarioId],
    })
    void client.invalidateQueries({queryKey: ["scenarioSteps", runId, scenarioId]})
    void client.invalidateQueries({queryKey: runLevelMetricsQueryKey(projectId, runId)})
}

const dashed = (hex: string) =>
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`

/** The runner returns OpenTelemetry hex ids; the API stores them as UUIDs. */
function traceIdToUuid(id: string): string {
    return !id.includes("-") && id.length === 32 ? dashed(id) : id
}

/** A 16-character span id is doubled to fill a UUID, as the API does. */
function spanIdToUuid(id: string): string {
    if (id.includes("-")) return id
    if (id.length === 16) return dashed(id + id)
    return id.length === 32 ? dashed(id) : id
}
