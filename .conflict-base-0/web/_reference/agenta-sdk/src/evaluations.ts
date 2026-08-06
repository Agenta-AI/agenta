/**
 * Agenta TypeScript SDK — Evaluations manager.
 *
 * Covers evaluation runs, scenarios, results, metrics, and simple evaluations.
 *
 * Endpoints (all under /preview/evaluations/):
 *   Runs:
 *     POST /runs/                  → createRuns
 *     PATCH /runs/                 → editRuns
 *     DELETE /runs/                → deleteRuns
 *     POST /runs/query             → queryRuns
 *     GET /runs/:id                → getRun
 *     POST /runs/close             → closeRuns
 *     POST /runs/open              → openRuns
 *     POST /runs/:id/close         → closeRun
 *     POST /runs/:id/open          → openRun
 *
 *   Scenarios:
 *     POST /scenarios/             → createScenarios
 *     PATCH /scenarios/            → editScenarios
 *     DELETE /scenarios/           → deleteScenarios
 *     POST /scenarios/query        → queryScenarios
 *     GET /scenarios/:id           → getScenario
 *
 *   Results:
 *     POST /results/query          → queryResults
 *     GET /results/:id             → getResult
 *
 *   Metrics:
 *     POST /metrics/query          → queryMetrics
 *
 *   Simple Evaluations:
 *     POST /simple/evaluations/           → createSimple
 *     POST /simple/evaluations/query      → querySimple
 *     GET /simple/evaluations/:id         → getSimple
 *     POST /simple/evaluations/:id/start  → startSimple
 *     POST /simple/evaluations/:id/stop   → stopSimple
 *     POST /simple/evaluations/:id/close  → closeSimple
 *     POST /simple/evaluations/:id/open   → openSimple
 */

import {schemas, validateBoundary, type SchemaOf} from "./.generated/index"
import type {AgentaClient} from "./client"
import type {
    Windowing,
    EvaluationStatus,
    EvaluationComparisonResult,
    // Runs
    EvaluationRun,
    EvaluationRunCreate,
    EvaluationRunEdit,
    EvaluationRunQuery,
    EvaluationRunsCreateRequest,
    EvaluationRunsEditRequest,
    EvaluationRunQueryRequest,
    EvaluationRunIdsRequest,
    EvaluationRunResponse,
    EvaluationRunsResponse,
    EvaluationRunIdsResponse,
    // Scenarios
    EvaluationScenario,
    EvaluationScenarioCreate,
    EvaluationScenarioEdit,
    EvaluationScenarioQuery,
    EvaluationScenariosCreateRequest,
    EvaluationScenariosEditRequest,
    EvaluationScenarioQueryRequest,
    EvaluationScenarioResponse,
    EvaluationScenariosResponse,
    // Results
    EvaluationResultQuery,
    EvaluationResultQueryRequest,
    EvaluationResultsResponse,
    // Metrics
    EvaluationMetricsQuery,
    EvaluationMetricsQueryRequest,
    EvaluationMetricsResponse,
    // Simple Evaluations
    SimpleEvaluationCreate,
    SimpleEvaluationQuery,
    SimpleEvaluationCreateRequest,
    SimpleEvaluationQueryRequest,
    SimpleEvaluationResponse,
    SimpleEvaluationsResponse,
} from "./types"

export class Evaluations {
    constructor(private readonly client: AgentaClient) {}

    // ─── Runs ──────────────────────────────────────────────────────────────────

    /**
     * Create one or more evaluation runs.
     */
    async createRuns(runs: EvaluationRunCreate[]): Promise<EvaluationRunsResponse> {
        const body: EvaluationRunsCreateRequest = {runs}
        return this.client.post<EvaluationRunsResponse>("/evaluations/runs/", body)
    }

    /**
     * Edit multiple runs.
     */
    async editRuns(runs: EvaluationRunEdit[]): Promise<EvaluationRunsResponse> {
        const body: EvaluationRunsEditRequest = {runs}
        return this.client.request<EvaluationRunsResponse>("PATCH", "/evaluations/runs/", {body})
    }

    /**
     * Delete multiple runs by ID.
     */
    async deleteRuns(runIds: string[]): Promise<EvaluationRunIdsResponse> {
        const body: EvaluationRunIdsRequest = {run_ids: runIds}
        return this.client.request<EvaluationRunIdsResponse>("DELETE", "/evaluations/runs/", {body})
    }

    /**
     * Query runs with optional filtering and pagination.
     *
     * Matches the frontend pattern:
     *   POST /preview/evaluations/runs/query
     *   body: { run: { ids: [...] } }
     *   body: { run: { references: [{ application_variant: { id } }] } }
     */
    async queryRuns(options?: {
        run?: EvaluationRunQuery
        windowing?: Windowing
    }): Promise<EvaluationRunsResponse> {
        const body: EvaluationRunQueryRequest = {
            run: options?.run,
            windowing: options?.windowing,
        }
        return this.client.post<EvaluationRunsResponse>("/evaluations/runs/query", body)
    }

    /**
     * Get a single run by ID.
     */
    async getRun(runId: string): Promise<EvaluationRun | null> {
        const res = await this.client.get<EvaluationRunResponse>(`/evaluations/runs/${runId}`)
        return res.run ?? null
    }

    /**
     * Query runs by IDs.
     * Convenience wrapper matching the frontend fetchEvaluation pattern.
     */
    async getRunsByIds(ids: string[]): Promise<EvaluationRun[]> {
        const res = await this.queryRuns({run: {ids}})
        return res.runs
    }

    /**
     * Query runs by entity reference.
     * Convenience wrapper matching fetchEvaluatonIdsByResource.
     */
    async getRunsByReference(
        resourceType: "testset" | "evaluator" | "application_variant",
        resourceIds: string[],
    ): Promise<EvaluationRun[]> {
        const references = resourceIds.map((id) => ({[resourceType]: {id}}))
        const res = await this.queryRuns({run: {references}})
        return res.runs
    }

    /**
     * Close multiple runs.
     */
    async closeRuns(runIds: string[]): Promise<EvaluationRunsResponse> {
        const body: EvaluationRunIdsRequest = {run_ids: runIds}
        return this.client.post<EvaluationRunsResponse>("/evaluations/runs/close", body)
    }

    /**
     * Open (re-open) multiple runs.
     */
    async openRuns(runIds: string[]): Promise<EvaluationRunsResponse> {
        const body: EvaluationRunIdsRequest = {run_ids: runIds}
        return this.client.post<EvaluationRunsResponse>("/evaluations/runs/open", body)
    }

    /**
     * Close a single run.
     */
    async closeRun(runId: string, status?: string): Promise<EvaluationRunResponse> {
        const endpoint = status
            ? `/evaluations/runs/${runId}/close/${status}`
            : `/evaluations/runs/${runId}/close`
        return this.client.post<EvaluationRunResponse>(endpoint)
    }

    /**
     * Open (re-open) a single run.
     */
    async openRun(runId: string): Promise<EvaluationRunResponse> {
        return this.client.post<EvaluationRunResponse>(`/evaluations/runs/${runId}/open`)
    }

    // ─── Scenarios ─────────────────────────────────────────────────────────────

    /**
     * Create scenarios.
     */
    async createScenarios(
        scenarios: EvaluationScenarioCreate[],
    ): Promise<EvaluationScenariosResponse> {
        const body: EvaluationScenariosCreateRequest = {scenarios}
        return this.client.post<EvaluationScenariosResponse>("/evaluations/scenarios/", body)
    }

    /**
     * Edit scenarios.
     */
    async editScenarios(scenarios: EvaluationScenarioEdit[]): Promise<EvaluationScenariosResponse> {
        const body: EvaluationScenariosEditRequest = {scenarios}
        return this.client.request<EvaluationScenariosResponse>(
            "PATCH",
            "/evaluations/scenarios/",
            {body},
        )
    }

    /**
     * Delete scenarios by ID.
     */
    async deleteScenarios(
        scenarioIds: string[],
    ): Promise<SchemaOf<"EvaluationScenarioIdsResponse">> {
        const raw = await this.client.request("DELETE", "/evaluations/scenarios/", {
            body: {scenario_ids: scenarioIds},
        })
        return validateBoundary(
            raw,
            schemas.EvaluationScenarioIdsResponse,
            "Evaluations.deleteScenarios",
        )
    }

    /**
     * Query scenarios with filtering and pagination.
     *
     * Matches the frontend pattern:
     *   POST /preview/evaluations/scenarios/query
     *   body: { scenario: { references: [{ evaluation_run: { id } }] } }
     */
    async queryScenarios(options?: {
        scenario?: EvaluationScenarioQuery
        windowing?: Windowing
    }): Promise<EvaluationScenariosResponse> {
        const body: EvaluationScenarioQueryRequest = {
            scenario: options?.scenario,
            windowing: options?.windowing,
        }
        return this.client.post<EvaluationScenariosResponse>("/evaluations/scenarios/query", body)
    }

    /**
     * Get a single scenario by ID.
     */
    async getScenario(scenarioId: string): Promise<EvaluationScenario | null> {
        const res = await this.client.get<EvaluationScenarioResponse>(
            `/evaluations/scenarios/${scenarioId}`,
        )
        return res.scenario ?? null
    }

    // ─── Results ───────────────────────────────────────────────────────────────

    /**
     * Query results with filtering and pagination.
     *
     * Matches the frontend queryEvaluationResults pattern:
     *   POST /preview/evaluations/results/query
     *   body: { result: { run_id, scenario_ids, step_keys } }
     */
    async queryResults(options?: {
        result?: EvaluationResultQuery
        windowing?: Windowing
    }): Promise<EvaluationResultsResponse> {
        const body: EvaluationResultQueryRequest = {
            result: options?.result,
            windowing: options?.windowing,
        }
        return this.client.post<EvaluationResultsResponse>("/evaluations/results/query", body)
    }

    /**
     * Post evaluation results (batch).
     *
     * Used in local execution flow: after invoking the application and running
     * evaluators locally, post the results back to Agenta.
     *
     * Required fields per result: run_id, scenario_id, step_key.
     * Scores/reasoning go in the `meta` field.
     *
     *   POST /preview/evaluations/results/
     *   body: { results: [...] }
     */
    async postResults(
        results: {
            run_id: string
            scenario_id: string
            step_key: string
            status?: EvaluationStatus
            trace_id?: string
            testcase_id?: string
            repeat_idx?: number
            error?: Record<string, unknown> | string
            meta?: Record<string, unknown>
        }[],
    ): Promise<EvaluationResultsResponse> {
        return this.client.post<EvaluationResultsResponse>("/evaluations/results/", {results})
    }

    // ─── Metrics ───────────────────────────────────────────────────────────────

    /**
     * Query metrics with filtering and pagination.
     */
    async queryMetrics(options?: {
        metrics?: EvaluationMetricsQuery
        windowing?: Windowing
    }): Promise<EvaluationMetricsResponse> {
        const body: EvaluationMetricsQueryRequest = {
            metrics: options?.metrics,
            windowing: options?.windowing,
        }
        return this.client.post<EvaluationMetricsResponse>("/evaluations/metrics/query", body)
    }

    /**
     * Recompute evaluation metrics for a set of runs / scenarios.
     * Body shape is loose pending DTO drift audit; typical payload includes
     * the run IDs whose metrics need recomputation after upstream changes.
     */
    async refreshMetrics(
        request: Record<string, unknown>,
    ): Promise<SchemaOf<"EvaluationMetricsResponse">> {
        const raw = await this.client.post("/evaluations/metrics/refresh", request)
        return validateBoundary(
            raw,
            schemas.EvaluationMetricsResponse,
            "Evaluations.refreshMetrics",
        )
    }

    /**
     * Refresh evaluation runs (force re-evaluation of pending scenarios).
     * Used to retry failed scenarios within a run.
     */
    async refreshRuns(
        request: Record<string, unknown>,
    ): Promise<SchemaOf<"EvaluationRunsResponse">> {
        const raw = await this.client.post("/evaluations/runs/refresh", request)
        return validateBoundary(raw, schemas.EvaluationRunsResponse, "Evaluations.refreshRuns")
    }

    /**
     * Edit (PATCH) evaluation results.
     */
    async editResults(
        results: {
            id: string
            status?: string
            trace_id?: string
            span_id?: string
            meta?: Record<string, unknown>
        }[],
    ): Promise<SchemaOf<"EvaluationResultsResponse">> {
        const raw = await this.client.request("PATCH", "/evaluations/results/", {body: {results}})
        return validateBoundary(raw, schemas.EvaluationResultsResponse, "Evaluations.editResults")
    }

    /**
     * Create evaluation metrics.
     */
    async postMetrics(
        metrics: {
            run_id: string
            scenario_id: string
            data?: Record<string, unknown>
            status?: string
        }[],
    ): Promise<SchemaOf<"EvaluationMetricsResponse">> {
        const raw = await this.client.post("/evaluations/metrics/", {metrics})
        return validateBoundary(raw, schemas.EvaluationMetricsResponse, "Evaluations.postMetrics")
    }

    /**
     * Edit (PATCH) evaluation metrics.
     */
    async editMetrics(
        metrics: {
            id: string
            data?: Record<string, unknown>
            status?: string
        }[],
    ): Promise<SchemaOf<"EvaluationMetricsResponse">> {
        const raw = await this.client.request("PATCH", "/evaluations/metrics/", {body: {metrics}})
        return validateBoundary(raw, schemas.EvaluationMetricsResponse, "Evaluations.editMetrics")
    }

    /**
     * Edit a single evaluation run by ID.
     */
    async editRun(
        runId: string,
        run: Record<string, unknown>,
    ): Promise<SchemaOf<"EvaluationRunResponse">> {
        const raw = await this.client.request("PATCH", `/evaluations/runs/${runId}`, {body: {run}})
        return validateBoundary(raw, schemas.EvaluationRunResponse, "Evaluations.editRun")
    }

    // ─── Simple Evaluations ────────────────────────────────────────────────────

    /**
     * Create a simple evaluation.
     *
     * Matches the frontend createEvaluation pattern:
     *   POST /preview/simple/evaluations/
     *   body: { evaluation: { name, data: { testset_steps, application_steps, evaluator_steps }, flags } }
     */
    async createSimple(evaluation: SimpleEvaluationCreate): Promise<SimpleEvaluationResponse> {
        const body: SimpleEvaluationCreateRequest = {evaluation}
        return this.client.post<SimpleEvaluationResponse>("/simple/evaluations/", body)
    }

    /**
     * Query simple evaluations.
     */
    async querySimple(options?: {
        evaluation?: SimpleEvaluationQuery
        windowing?: Windowing
    }): Promise<SimpleEvaluationsResponse> {
        const body: SimpleEvaluationQueryRequest = {
            evaluation: options?.evaluation,
            windowing: options?.windowing,
        }
        return this.client.post<SimpleEvaluationsResponse>("/simple/evaluations/query", body)
    }

    /**
     * Get a simple evaluation by ID.
     */
    async getSimple(evaluationId: string): Promise<SimpleEvaluationResponse> {
        return this.client.get<SimpleEvaluationResponse>(`/simple/evaluations/${evaluationId}`)
    }

    /**
     * Start a simple evaluation.
     */
    async startSimple(evaluationId: string): Promise<SimpleEvaluationResponse> {
        return this.client.post<SimpleEvaluationResponse>(
            `/simple/evaluations/${evaluationId}/start`,
        )
    }

    /**
     * Stop a simple evaluation.
     */
    async stopSimple(evaluationId: string): Promise<SimpleEvaluationResponse> {
        return this.client.post<SimpleEvaluationResponse>(
            `/simple/evaluations/${evaluationId}/stop`,
        )
    }

    /**
     * Close a simple evaluation.
     */
    async closeSimple(evaluationId: string): Promise<SimpleEvaluationResponse> {
        return this.client.post<SimpleEvaluationResponse>(
            `/simple/evaluations/${evaluationId}/close`,
        )
    }

    /**
     * Open (re-open) a simple evaluation.
     */
    async openSimple(evaluationId: string): Promise<SimpleEvaluationResponse> {
        return this.client.post<SimpleEvaluationResponse>(
            `/simple/evaluations/${evaluationId}/open`,
        )
    }

    // ─── Queues ────────────────────────────────────────────────────────────────

    /**
     * Query evaluation queues with optional filtering and pagination.
     */
    async queryQueues(options?: {
        runId?: string
        userId?: string
        windowing?: Windowing
    }): Promise<SchemaOf<"EvaluationQueuesResponse">> {
        const body = {
            run_id: options?.runId,
            user_id: options?.userId,
            windowing: options?.windowing,
        }
        const raw = await this.client.post("/evaluations/queues/query", body, {legacy: true})
        return validateBoundary(raw, schemas.EvaluationQueuesResponse, "Evaluations.queryQueues")
    }

    /**
     * Get a single evaluation queue by ID.
     */
    async getQueue(queueId: string): Promise<SchemaOf<"EvaluationQueueResponse">> {
        const raw = await this.client.get(`/evaluations/queues/${queueId}`, {legacy: true})
        return validateBoundary(raw, schemas.EvaluationQueueResponse, "Evaluations.getQueue")
    }

    /**
     * Delete a single evaluation queue by ID.
     */
    async deleteQueue(queueId: string): Promise<SchemaOf<"EvaluationQueueIdResponse">> {
        const raw = await this.client.delete(`/evaluations/queues/${queueId}`, {legacy: true})
        return validateBoundary(raw, schemas.EvaluationQueueIdResponse, "Evaluations.deleteQueue")
    }

    /**
     * Delete multiple evaluation queues by IDs.
     */
    async deleteQueues(queueIds: string[]): Promise<SchemaOf<"EvaluationQueueIdsResponse">> {
        const raw = await this.client.request("DELETE", "/evaluations/queues/", {
            body: {queue_ids: queueIds},
            legacy: true,
        })
        return validateBoundary(raw, schemas.EvaluationQueueIdsResponse, "Evaluations.deleteQueues")
    }

    /**
     * Query scenarios for an evaluation queue.
     *
     * NOTE: response is left as `unknown` — the legacy
     * `/evaluations/queues/{id}/scenarios/query` endpoint is not in the public
     * OpenAPI spec, so there is no generated schema. Tighten when the spec
     * gains coverage.
     */
    async queryQueueScenarios(
        queueId: string,
        options?: {
            userId?: string
            windowing?: Windowing
        },
    ): Promise<unknown> {
        const body = {
            user_id: options?.userId,
            windowing: options?.windowing,
        }
        return this.client.post(`/evaluations/queues/${queueId}/scenarios/query`, body, {
            legacy: true,
        })
    }

    // ─── Convenience Methods ──────────────────────────────────────────────────

    /**
     * Get all results for a run, keyed by step_key.
     * Aggregates scores from `meta.score` across all scenarios.
     *
     * Returns a map: stepKey → { scores, avgScore, count }.
     */
    async getResultsByRun(
        runId: string,
    ): Promise<Record<string, {scores: number[]; avgScore: number; count: number}>> {
        const res = await this.queryResults({
            result: {run_ids: [runId]},
        })

        const byStep: Record<string, {scores: number[]; avgScore: number; count: number}> = {}

        for (const result of res.results) {
            const key = result.step_key
            if (!byStep[key]) {
                byStep[key] = {scores: [], avgScore: 0, count: 0}
            }
            // Scores can be in metadata.score or in the meta bag (API inconsistency)
            const meta = result.metadata ?? result.meta
            let score: number | undefined
            if (typeof meta?.score === "number") {
                score = meta.score
            } else if (typeof meta?.score === "boolean") {
                score = meta.score ? 1 : 0
            }
            if (typeof score === "number") {
                byStep[key].scores.push(score)
            }
            byStep[key].count++
        }

        for (const entry of Object.values(byStep)) {
            entry.avgScore =
                entry.scores.length > 0
                    ? entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length
                    : 0
        }

        return byStep
    }

    /**
     * Compare two evaluation runs (baseline vs variant).
     *
     * Fetches aggregated results for both runs and computes per-evaluator
     * score deltas. Used by the optimization loop to decide whether a
     * variant is better than the baseline.
     */
    async compareRuns(
        baselineRunId: string,
        variantRunId: string,
    ): Promise<EvaluationComparisonResult[]> {
        const [baseline, variant] = await Promise.all([
            this.getResultsByRun(baselineRunId),
            this.getResultsByRun(variantRunId),
        ])

        const allKeys = Array.from(new Set(Object.keys(baseline).concat(Object.keys(variant))))

        const results: EvaluationComparisonResult[] = []

        for (const stepKey of allKeys) {
            const baselineScore = baseline[stepKey]?.avgScore ?? 0
            const variantScore = variant[stepKey]?.avgScore ?? 0
            const delta = variantScore - baselineScore
            const relativeChange =
                baselineScore > 0 ? delta / baselineScore : delta > 0 ? Infinity : 0

            results.push({
                stepKey,
                baselineScore,
                variantScore,
                delta,
                relativeChange,
                improved: delta > 0,
            })
        }

        return results
    }
}
