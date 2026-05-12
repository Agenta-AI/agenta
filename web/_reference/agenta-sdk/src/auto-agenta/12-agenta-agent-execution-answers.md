# Agenta Agent: Local Execution Answers

> Definitive answers to the 4 questions in 11-sdk-implementation-plan.md.
> Verified against router handlers, service layer, DAO, and evaluation task code.

---

## Q1: Result Posting Endpoint

**Endpoint:** `POST /preview/evaluations/results/`

**Request shape:**
```json
{
  "results": [
    {
      "run_id": "uuid",
      "scenario_id": "uuid",
      "step_key": "evaluator-slug",
      "status": "success",
      "trace_id": "optional-trace-id",
      "testcase_id": "optional-testcase-uuid",
      "repeat_idx": 0,
      "error": null,
      "metadata": {}
    }
  ]
}
```

**Required fields:** `run_id`, `scenario_id`, `step_key`

**Optional fields:** `status` (defaults to pending), `trace_id`, `testcase_id`, `hash_id`, `error`, `interval`, `timestamp`, `repeat_idx` (defaults to 0), `metadata`

**Note:** The result `data` is stored in the `metadata` field (which comes from the `Metadata` base class — `flags`, `tags`, `meta`). For scores/reasoning, use `meta`:

```json
{
  "results": [{
    "run_id": "...",
    "scenario_id": "...",
    "step_key": "tone-check",
    "status": "success",
    "meta": {
      "score": 0.85,
      "reasoning": "Response uses casual tone throughout"
    }
  }]
}
```

**Correction to doc 11's spec:** The envelope key is `results` (array), not `evaluation_result` (single). You batch-post results.

---

## Q2: Closing an Evaluation Run

**Endpoint:** `POST /preview/evaluations/runs/{run_id}/close`

**Request body:** None required.

**Optional:** You can pass a status in the URL path:
`POST /preview/evaluations/runs/{run_id}/close/success`

Valid status values: `"success"`, `"failure"`, `"errors"`, `"cancelled"`

**What it does:**
1. Sets `flags.is_closed = true`
2. If status is provided, updates `run.status` to that value
3. Updates `updated_at` timestamp

**For our flow:** Call with `close/success` after all results are posted:
```typescript
await client.post(`/evaluations/runs/${runId}/close/success`);
```

**Bulk close:** `POST /preview/evaluations/runs/close` with `{ run_ids: ["id1", "id2"] }` — closes multiple runs at once.

---

## Q3: Creating a "Running" Evaluation

**How it works:** Set `data.status = "running"` in the `SimpleEvaluationCreate` payload.

```json
POST /preview/simple/evaluations/
{
  "evaluation": {
    "name": "Onboarding Baseline",
    "data": {
      "status": "running",
      "testset_steps": { "testset-revision-uuid": "auto" },
      "application_steps": { "app-revision-uuid": "auto" },
      "evaluator_steps": { "eval-revision-uuid": "auto" }
    },
    "flags": {
      "is_live": false,
      "is_active": true,
      "is_closed": false
    }
  }
}
```

**Then call start:**
```json
POST /preview/simple/evaluations/{id}/start
```

**What happens on start:**
1. The service activates the run (sets `is_active = true`)
2. It checks `evaluation.data.status == "running"`
3. **If true: returns immediately. No worker dispatched.**
4. The SDK is now responsible for execution

**After start returns**, your orchestration code:
1. Queries the testset to get testcases
2. Creates scenarios for each testcase (or the start may have already created them — need to check)
3. Runs your invoke function per testcase
4. Posts results via `POST /preview/evaluations/results/`
5. Closes the run via `POST /preview/evaluations/runs/{id}/close/success`

**Important nuance:** The `start` endpoint also creates the scenarios and initial result scaffolding as part of activation. The `data.status = "running"` only skips the worker dispatch — the scenarios should already exist after `start` returns. You'd query them with:
```json
POST /preview/evaluations/scenarios/query
{ "scenario": { "run_ids": ["the-run-id"] } }
```

Then post results against those scenario IDs.

---

## Q4: Scenario vs Testcase Relationship

**1:1 mapping.** Each testcase in the testset becomes one scenario in the evaluation run.

**The relationship is:**
```
TestSet
  └── TestCase (id: "tc-1")
        ↓ evaluation creates ↓
EvaluationRun
  └── Scenario (id: "sc-1")  ← one per testcase
        └── Result (scenario_id: "sc-1", step_key: "tone-check", testcase_id: "tc-1")
        └── Result (scenario_id: "sc-1", step_key: "structure-check", testcase_id: "tc-1")
        └── Result (scenario_id: "sc-1", step_key: "invocation", testcase_id: "tc-1")
```

**Scenario doesn't store testcase_id directly.** The testcase_id is stored on each `EvaluationResult`. This means:
- You post results with both `scenario_id` AND `testcase_id`
- The scenario is just a grouping container
- Multiple results per scenario (one per evaluator step, per repeat)

**For local execution flow:**
1. After `start`, query scenarios: `POST /preview/evaluations/scenarios/query` → get scenario IDs
2. Match scenarios to testcases (they're created in the same order)
3. For each scenario, run your invoke + evaluators
4. Post results with `scenario_id`, `testcase_id`, and `step_key`

---

## Corrected Local Execution Flow

Based on these answers, here's the corrected flow:

```typescript
async function runLocalEvaluation(ag: Agenta, options: {
  name: string;
  testsetRevisionId: string;
  appRevisionId: string;
  evaluatorRevisionIds: string[];
  invoke: (testcaseData: Record<string, unknown>) => Promise<InvokeResult>;
  evaluate: (stepKey: string, input: Record<string, unknown>, output: Record<string, unknown>) => Promise<EvalResult>;
}) {
  // 1. Create the evaluation with status=running
  const evalRes = await ag.evaluations.createSimple({
    name: options.name,
    data: {
      status: "running",
      testset_steps: { [options.testsetRevisionId]: "auto" },
      application_steps: { [options.appRevisionId]: "auto" },
      evaluator_steps: Object.fromEntries(
        options.evaluatorRevisionIds.map(id => [id, "auto"])
      ),
    },
    flags: { is_live: false, is_active: true, is_closed: false },
  });
  const evaluationId = evalRes.evaluation!.id!;

  // 2. Start it (creates scenarios, skips worker dispatch)
  await ag.evaluations.startSimple(evaluationId);

  // 3. Query the run to get the run_id
  const runsRes = await ag.evaluations.queryRuns({
    run: { ids: [evaluationId] }
  });
  const runId = runsRes.runs[0]?.id;

  // 4. Query scenarios (created by start)
  const scenariosRes = await ag.evaluations.queryScenarios({
    scenario: { run_ids: [runId!] }
  });

  // 5. Get the testset to match scenarios to testcases
  const testset = await ag.testsets.get(options.testsetRevisionId);
  const testcases = testset.data.testcases;

  // 6. Execute locally
  for (let i = 0; i < scenariosRes.scenarios.length; i++) {
    const scenario = scenariosRes.scenarios[i];
    const testcase = testcases[i]; // 1:1 mapping

    // Run the application
    const { output, traceId } = await options.invoke(testcase.data);

    // Run evaluators and post results
    for (const evalRevId of options.evaluatorRevisionIds) {
      const evalResult = await options.evaluate(evalRevId, testcase.data, output);

      await ag.client.post("/evaluations/results/", {
        results: [{
          run_id: runId,
          scenario_id: scenario.id,
          step_key: evalRevId,
          status: "success",
          testcase_id: testcase.id,
          trace_id: traceId,
          meta: {
            score: evalResult.score,
            reasoning: evalResult.reasoning,
          },
        }],
      });
    }
  }

  // 7. Close the run
  await ag.evaluations.closeRun(runId!, "success");
}
```

**Key correction from doc 11:** Scenarios are created by the `start` call, not by the SDK. You query them after start, match to testcases by index, and post results against those scenario IDs.
