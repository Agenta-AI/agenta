/**
 * Auto-Agenta: Local Evaluation Orchestrator
 *
 * Runs evaluations locally using the SDK-managed execution path.
 * Creates the evaluation in Agenta (visible in UI), but executes
 * invocation + evaluation locally via user-provided callbacks.
 *
 * Flow:
 *   1. Create evaluation with data.status = "running"
 *   2. Start (creates scenarios, skips Agenta worker dispatch)
 *   3. Query scenarios (1:1 with testcases, matched by index)
 *   4. For each scenario: invoke → evaluate → batch-post results
 *   5. Close run with success/errors status
 *
 * See: docs 12-15 in auto-agenta/ for the full design rationale.
 */

import type {Agenta} from "../index"
import type {EvaluationStatus} from "../types"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single result to post back to Agenta */
interface EvaluationResultEntry {
    run_id: string
    scenario_id: string
    step_key: string
    status?: EvaluationStatus
    trace_id?: string
    testcase_id?: string
    repeat_idx?: number
    error?: Record<string, unknown>
    meta?: Record<string, unknown>
}

export interface InvokeResult {
    /** The application output — freeform, passed to evaluators */
    output: Record<string, unknown>
    /** Optional trace ID for linking results to Agenta tracing */
    traceId?: string
}

export interface EvalResult {
    /** Numeric score (0–1 recommended, but evaluator-defined) */
    score: number
    /** Human-readable reasoning for the score */
    reasoning?: string
    /** Any additional metadata to store with the result */
    [key: string]: unknown
}

export interface LocalEvaluationOptions {
    /** Display name for this evaluation run (shown in Agenta UI) */
    name: string

    /**
     * Testset revision ID — from testset.revision_id (not testset.id).
     * All step references in Agenta are revision IDs.
     */
    testsetRevisionId: string

    /** Application revision ID being evaluated */
    appRevisionId: string

    /** Evaluator revision IDs to run against each scenario */
    evaluatorRevisionIds: string[]

    /**
     * User-provided invocation function.
     * Called once per testcase. For multi-turn conversations,
     * this is where the conversation simulator lives.
     */
    invoke: (testcaseData: Record<string, unknown>) => Promise<InvokeResult>

    /**
     * User-provided evaluation function.
     * Called once per (testcase, evaluator) pair.
     * stepKey is the evaluator revision ID.
     */
    evaluate: (
        stepKey: string,
        input: Record<string, unknown>,
        output: Record<string, unknown>,
    ) => Promise<EvalResult>

    /** Progress callback — (completed scenarios, total scenarios) */
    onProgress?: (completed: number, total: number) => void

    /** How many results to batch before posting. Default: 10 */
    resultBatchSize?: number
}

export interface LocalEvaluationResult {
    /** The evaluation/run ID (same UUID in Agenta) */
    evaluationId: string
    /** Number of scenarios (== number of testcases) */
    scenarioCount: number
    /** Total results posted (scenarios × evaluators, roughly) */
    resultCount: number
    /** Whether any scenario had failures */
    hasErrors: boolean
    /** Per-scenario error details, if any */
    errors: {scenarioIndex: number; step: string; error: string}[]
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function runLocalEvaluation(
    ag: Agenta,
    options: LocalEvaluationOptions,
): Promise<LocalEvaluationResult> {
    const {
        name,
        testsetRevisionId,
        appRevisionId,
        evaluatorRevisionIds,
        invoke,
        evaluate,
        onProgress,
        resultBatchSize = 10,
    } = options

    // 1. Create evaluation with status=running (SDK-managed execution)
    const evalRes = await ag.evaluations.createSimple({
        name,
        data: {
            status: "running",
            testset_steps: {[testsetRevisionId]: "auto"},
            application_steps: {[appRevisionId]: "auto"},
            evaluator_steps: Object.fromEntries(evaluatorRevisionIds.map((id) => [id, "auto"])),
        },
        flags: {is_live: false, is_active: true, is_closed: false},
    })

    // Evaluation ID == Run ID (confirmed in doc 14)
    const evaluationId = evalRes.evaluation?.id
    if (!evaluationId) {
        throw new Error(`Could not extract evaluation ID from createSimple response`)
    }

    // 2. Start — creates scenarios, skips worker dispatch because status=running
    await ag.evaluations.startSimple(evaluationId)

    // 3. Query scenarios (created by start, 1:1 with testcases) + fetch testset
    const [scenariosRes, testset] = await Promise.all([
        ag.evaluations.queryScenarios({scenario: {run_ids: [evaluationId]}}),
        ag.testsets.get(testsetRevisionId),
    ])

    const scenarios = scenariosRes.scenarios ?? []
    const testcases = testset.data?.testcases ?? []

    if (scenarios.length === 0) {
        // Fallback: if start didn't create scenarios, we still close cleanly
        await ag.evaluations.closeRun(evaluationId, "success")
        return {
            evaluationId,
            scenarioCount: 0,
            resultCount: 0,
            hasErrors: false,
            errors: [],
        }
    }

    // 4. Execute locally with batched result posting
    let resultCount = 0
    let hasErrors = false
    const errors: LocalEvaluationResult["errors"] = []
    let batch: EvaluationResultEntry[] = []

    const flush = async () => {
        if (batch.length > 0) {
            await ag.evaluations.postResults(batch)
            batch = []
        }
    }

    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i]
        const testcase = testcases[i]

        if (!testcase) {
            // Scenario/testcase count mismatch — skip gracefully
            hasErrors = true
            errors.push({
                scenarioIndex: i,
                step: "mapping",
                error: `No testcase at index ${i} (${scenarios.length} scenarios, ${testcases.length} testcases)`,
            })
            continue
        }

        try {
            // Invoke the application
            const {output, traceId} = await invoke(testcase.data)

            // Run each evaluator
            for (const evalRevId of evaluatorRevisionIds) {
                try {
                    const evalResult = await evaluate(evalRevId, testcase.data, output)

                    batch.push({
                        run_id: evaluationId,
                        scenario_id: scenario.id!,
                        step_key: evalRevId,
                        status: "success",
                        testcase_id: testcase.id,
                        trace_id: traceId,
                        meta: {
                            score: evalResult.score,
                            reasoning: evalResult.reasoning,
                            // Spread any extra metadata (but exclude score/reasoning dupes)
                            ...Object.fromEntries(
                                Object.entries(evalResult).filter(
                                    ([k]) => k !== "score" && k !== "reasoning",
                                ),
                            ),
                        },
                    })
                } catch (evalErr) {
                    hasErrors = true
                    const errMsg = evalErr instanceof Error ? evalErr.message : String(evalErr)
                    errors.push({scenarioIndex: i, step: evalRevId, error: errMsg})

                    batch.push({
                        run_id: evaluationId,
                        scenario_id: scenario.id!,
                        step_key: evalRevId,
                        status: "failure",
                        testcase_id: testcase.id,
                        error: {message: errMsg},
                    })
                }
                resultCount++

                if (batch.length >= resultBatchSize) {
                    await flush()
                }
            }
        } catch (invokeErr) {
            // Invocation failed — post failure for the invocation step
            hasErrors = true
            const errMsg = invokeErr instanceof Error ? invokeErr.message : String(invokeErr)
            errors.push({scenarioIndex: i, step: "invocation", error: errMsg})

            batch.push({
                run_id: evaluationId,
                scenario_id: scenario.id!,
                step_key: "invocation",
                status: "failure",
                testcase_id: testcase.id,
                error: {message: errMsg},
            })
            resultCount++
        }

        onProgress?.(i + 1, scenarios.length)
    }

    // Flush remaining results
    await flush()

    // 5. Close the run
    await ag.evaluations.closeRun(evaluationId, hasErrors ? "errors" : "success")

    return {evaluationId, scenarioCount: scenarios.length, resultCount, hasErrors, errors}
}
