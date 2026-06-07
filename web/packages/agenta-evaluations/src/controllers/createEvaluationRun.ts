import type {AgentaApi} from "@agentaai/api-client"

import type {RunConfig} from "../core/types"

/**
 * createEvaluationRun — headless orchestration of evaluation-run creation with rollback.
 *
 * There is no atomic server-side "create run + scenarios + results" endpoint, so creation
 * is a sequence of Fern calls: createRuns -> createScenarios -> setResults. If any step
 * after the run is created fails, we attempt to roll back by deleting the run (the backend
 * cascade-deletes its scenarios/results/metrics via FK ondelete=CASCADE), so a partial
 * failure does not leave an orphaned run.
 *
 * The client is injectable (see `EvaluationsCreateClient`) so the orchestration branches —
 * success, scenario-fail -> rollback, results-fail -> rollback, rollback-fail — are unit
 * testable with a fake, no backend and no `@agenta/sdk` load required. The real Fern client
 * is loaded lazily (dynamic import) only when no client is injected.
 */

/**
 * Minimal client surface the orchestration needs. The real Fern evaluations client is
 * adapted to this shape in `defaultCreateClient`; tests provide a fake. `projectId` is a
 * parameter (the adapter turns it into Fern's `{queryParams: {project_id}}`).
 */
export interface EvaluationsCreateClient {
    createRuns(
        runs: AgentaApi.EvaluationRunCreate[],
        projectId: string,
    ): Promise<AgentaApi.EvaluationRunsResponse>
    createScenarios(
        scenarios: AgentaApi.EvaluationScenarioCreate[],
        projectId: string,
    ): Promise<AgentaApi.EvaluationScenariosResponse>
    setResults(
        results: AgentaApi.EvaluationResultCreate[],
        projectId: string,
    ): Promise<AgentaApi.EvaluationResultsResponse>
    deleteRuns(runIds: string[], projectId: string): Promise<AgentaApi.EvaluationRunIdsResponse>
}

export interface CreateEvaluationRunArgs {
    projectId: string
    /** Run configs straight from `buildRunConfig` — mapped to Fern's create shape here. */
    runs: RunConfig[]
    /** One scenario is created per testcase id; ids also tag each scenario's result rows. */
    testcaseIds: string[]
}

/**
 * Map the package's `RunConfig` to Fern's `EvaluationRunCreate`. Drops the vestigial
 * run-level `key` (not in the backend spec) and casts `data` — `buildRunConfig` produces
 * exactly the steps/mappings shape the backend expects (same payload the legacy axios path
 * sent), but Fern's generated `EvaluationRunData` under-declares some `extra=allow` fields.
 */
const toRunCreate = (run: RunConfig): AgentaApi.EvaluationRunCreate => ({
    name: run.name,
    meta: run.meta as AgentaApi.EvaluationRunCreate["meta"],
    data: run.data as unknown as AgentaApi.EvaluationRunData,
})

export interface CreateEvaluationRunResult {
    runId: string
    runIds: string[]
    scenarioIds: string[]
    status: "created"
}

export type CreateEvaluationRunStage = "createRuns" | "createScenarios" | "setResults"

/**
 * Thrown when creation fails. `rolledBack` reports whether the orphan-run cleanup
 * succeeded, so callers can surface an explicit incomplete state instead of silent loss.
 */
export class EvaluationRunCreationError extends Error {
    constructor(
        message: string,
        readonly stage: CreateEvaluationRunStage,
        readonly runId: string | undefined,
        readonly rolledBack: boolean,
        readonly cause?: unknown,
    ) {
        super(message)
        this.name = "EvaluationRunCreationError"
    }
}

const filterIds = (values: (string | null | undefined)[]): string[] =>
    values.filter((v): v is string => typeof v === "string" && v.length > 0)

/**
 * Build the per-scenario step-result rows. Reuses the run config's own step keys
 * (`runs[0].data.steps[].key`) so result rows stay consistent with the run shape. Input
 * steps are marked SUCCESS (they hold the testcase data and need no execution); invocation
 * and annotation steps are created without a status, awaiting execution.
 */
export function buildScenarioStepResults({
    runId,
    scenarioIds,
    testcaseIds,
    steps,
}: {
    runId: string
    scenarioIds: string[]
    testcaseIds: string[]
    /** Minimal step shape — accepts both RunConfig's `RunStep` and Fern's step type. */
    steps: readonly {key: string; type: string}[]
}): AgentaApi.EvaluationResultCreate[] {
    const results: AgentaApi.EvaluationResultCreate[] = []
    scenarioIds.forEach((scenarioId, index) => {
        const testcaseId = testcaseIds[index]
        steps.forEach((step) => {
            results.push({
                run_id: runId,
                scenario_id: scenarioId,
                step_key: step.key,
                ...(testcaseId ? {testcase_id: testcaseId} : {}),
                ...(step.type === "input" ? {status: "success"} : {}),
            })
        })
    })
    return results
}

async function rollbackRun(
    client: EvaluationsCreateClient,
    runId: string,
    projectId: string,
): Promise<boolean> {
    try {
        await client.deleteRuns([runId], projectId)
        return true
    } catch {
        // Rollback itself failed (e.g. the same network condition). The run is orphaned;
        // the caller surfaces this via `rolledBack: false` rather than losing it silently.
        return false
    }
}

let cachedDefaultClient: EvaluationsCreateClient | undefined

/**
 * Lazily adapt the real Fern evaluations client to `EvaluationsCreateClient`. The dynamic
 * import keeps the ESM-only `@agentaai/api-client` out of the static graph (so importing
 * this module in a node:test does not eagerly link it), and is never reached when a client
 * is injected.
 */
async function defaultCreateClient(): Promise<EvaluationsCreateClient> {
    if (cachedDefaultClient) return cachedDefaultClient
    const {getAgentaSdkClient} = await import("@agenta/sdk")
    const ev = getAgentaSdkClient().evaluations
    const scoped = (projectId: string) => ({queryParams: {project_id: projectId}})
    cachedDefaultClient = {
        createRuns: async (runs, projectId) => ev.createRuns({runs}, scoped(projectId)),
        createScenarios: async (scenarios, projectId) =>
            ev.createScenarios({scenarios}, scoped(projectId)),
        setResults: async (results, projectId) => ev.setResults({results}, scoped(projectId)),
        deleteRuns: async (runIds, projectId) =>
            ev.deleteRuns({run_ids: runIds}, scoped(projectId)),
    }
    return cachedDefaultClient
}

export async function createEvaluationRun(
    {projectId, runs, testcaseIds}: CreateEvaluationRunArgs,
    client?: EvaluationsCreateClient,
): Promise<CreateEvaluationRunResult> {
    const c = client ?? (await defaultCreateClient())

    // 1. Create the run(s). Until this succeeds there is nothing to roll back.
    let runsResponse: AgentaApi.EvaluationRunsResponse
    try {
        runsResponse = await c.createRuns(runs.map(toRunCreate), projectId)
    } catch (err) {
        throw new EvaluationRunCreationError(
            "Failed to create evaluation run",
            "createRuns",
            undefined,
            false,
            err,
        )
    }

    const runIds = filterIds((runsResponse.runs ?? []).map((r) => r.id))
    const runId = runIds[0]
    if (!runId) {
        throw new EvaluationRunCreationError(
            "createRuns returned no run id",
            "createRuns",
            undefined,
            false,
        )
    }

    // 2+3. Scenarios and result rows. A failure here orphans the created run → roll back.
    // `stage` tracks which call is in flight so the thrown error reports it accurately.
    let stage: CreateEvaluationRunStage = "createScenarios"
    try {
        const scenariosResponse = await c.createScenarios(
            testcaseIds.map(() => ({run_id: runId})),
            projectId,
        )
        const scenarioIds = filterIds((scenariosResponse.scenarios ?? []).map((s) => s.id))

        const steps = runs[0]?.data?.steps ?? []
        const results = buildScenarioStepResults({runId, scenarioIds, testcaseIds, steps})
        if (results.length > 0) {
            stage = "setResults"
            await c.setResults(results, projectId)
        }

        return {runId, runIds, scenarioIds, status: "created"}
    } catch (err) {
        const rolledBack = await rollbackRun(c, runId, projectId)
        throw new EvaluationRunCreationError(
            `Evaluation run ${runId} partially created and ${
                rolledBack ? "rolled back" : "could NOT be rolled back"
            }`,
            stage,
            runId,
            rolledBack,
            err,
        )
    }
}
