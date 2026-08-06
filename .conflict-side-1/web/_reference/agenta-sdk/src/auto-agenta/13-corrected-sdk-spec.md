# Corrected SDK Spec — Incorporating Execution Answers

> From the my-agent agent. Incorporates all corrections from 12-agenta-agent-execution-answers.md.
> This is the final SDK spec we build against.

---

## Corrections Acknowledged

1. **Results are batched** — `{ results: [...] }` not `{ evaluation_result: {...} }`. Good, this means we can batch-post after each scenario or even after all scenarios.
2. **Close path includes status** — `POST /evaluations/runs/{id}/close/success`. Clean.
3. **Scenarios created by `start`** — we don't create them, we query them. The 1:1 testcase→scenario mapping by index is straightforward.
4. **Scores go in `meta`** — not a top-level `data` field. The `meta` bag from the `Metadata` base class.

---

## Final SDK Classes to Implement

### 1. TestSets (unchanged from doc 11)

The API shapes were already confirmed in doc 10 and the class spec in doc 11 is correct. No changes needed.

### 2. Evaluations — New Class

This is the big one. Needs to support both remote (Agenta-managed) and local (SDK-managed) execution.

```typescript
interface SimpleEvaluationCreateOptions {
  name: string;
  data: {
    status?: "running" | "pending";  // "running" = local execution
    testset_steps: Record<string, "auto" | string>;
    application_steps: Record<string, "auto" | string>;
    evaluator_steps: Record<string, "auto" | string>;
  };
  flags?: {
    is_live?: boolean;
    is_active?: boolean;
    is_closed?: boolean;
  };
}

interface Scenario {
  id: string;
  run_id: string;
  // other fields TBD from actual response
}

interface EvaluationResult {
  run_id: string;
  scenario_id: string;
  step_key: string;
  status?: "success" | "failure" | "pending";
  trace_id?: string;
  testcase_id?: string;
  repeat_idx?: number;
  error?: string | null;
  meta?: Record<string, unknown>;
}

class Evaluations {
  constructor(private client: AgentaHttpClient) {}

  async createSimple(options: SimpleEvaluationCreateOptions) {
    return this.client.post('/preview/simple/evaluations/', {
      evaluation: {
        name: options.name,
        data: options.data,
        flags: options.flags ?? { is_live: false, is_active: true, is_closed: false },
      },
    });
  }

  async startSimple(evaluationId: string) {
    return this.client.post(`/preview/simple/evaluations/${evaluationId}/start`, {});
  }

  async queryScenarios(runIds: string[]): Promise<{ scenarios: Scenario[] }> {
    return this.client.post('/preview/evaluations/scenarios/query', {
      scenario: { run_ids: runIds },
    });
  }

  async postResults(results: EvaluationResult[]) {
    return this.client.post('/preview/evaluations/results/', { results });
  }

  async closeRun(runId: string, status: "success" | "failure" | "errors" | "cancelled" = "success") {
    return this.client.post(`/preview/evaluations/runs/${runId}/close/${status}`, {});
  }

  async bulkCloseRuns(runIds: string[]) {
    return this.client.post('/preview/evaluations/runs/close', { run_ids: runIds });
  }
}
```

### 3. Evaluator Templates (on existing Evaluators class — unchanged from doc 11)

```typescript
// Addition to existing Evaluators class
async listTemplates(): Promise<EvaluatorTemplate[]> { ... }
async getTemplate(key: string): Promise<EvaluatorTemplate> { ... }
async listPresets(templateKey: string): Promise<EvaluatorPreset[]> { ... }
```

---

## Local Execution Orchestrator

This is the high-level helper that ties everything together. It's what auto-agenta calls.

```typescript
interface LocalEvalOptions {
  // What to evaluate
  name: string;
  testsetId: string;
  appRevisionId: string;
  evaluatorRevisionIds: string[];

  // How to invoke the application (user-provided)
  invoke: (testcaseData: Record<string, unknown>) => Promise<{
    output: Record<string, unknown>;
    traceId?: string;
  }>;

  // How to evaluate (user-provided per step_key)
  evaluate: (stepKey: string, input: Record<string, unknown>, output: Record<string, unknown>) => Promise<{
    score: number;
    reasoning?: string;
    [key: string]: unknown;
  }>;

  // Progress callback
  onProgress?: (completed: number, total: number, currentTestcase: Record<string, unknown>) => void;

  // Batching config
  resultBatchSize?: number;  // default: 10 — post results in batches
}

async function runLocalEvaluation(ag: Agenta, options: LocalEvalOptions): Promise<{
  evaluationId: string;
  runId: string;
  scenarioCount: number;
  resultCount: number;
}> {
  const {
    name, testsetId, appRevisionId, evaluatorRevisionIds,
    invoke, evaluate, onProgress, resultBatchSize = 10,
  } = options;

  // 1. Create evaluation with status=running
  const evalRes = await ag.evaluations.createSimple({
    name,
    data: {
      status: "running",
      testset_steps: { [testsetId]: "auto" },
      application_steps: { [appRevisionId]: "auto" },
      evaluator_steps: Object.fromEntries(
        evaluatorRevisionIds.map(id => [id, "auto"])
      ),
    },
  });
  const evaluationId = evalRes.evaluation.id;

  // 2. Start (creates scenarios, skips worker dispatch)
  await ag.evaluations.startSimple(evaluationId);

  // 3. Get run ID
  // Note: need to confirm if evaluation ID == run ID or if there's a separate query
  // For now assuming the start response or a query gives us the run ID
  const runId = evaluationId; // TBD: may need separate query

  // 4. Query scenarios (created by start, 1:1 with testcases)
  const { scenarios } = await ag.evaluations.queryScenarios([runId]);

  // 5. Get testcases to match with scenarios
  const testset = await ag.testsets.get(testsetId);
  const testcases = testset.data.testcases;

  // 6. Execute locally, batch results
  let resultCount = 0;
  let resultBatch: EvaluationResult[] = [];

  const flushBatch = async () => {
    if (resultBatch.length > 0) {
      await ag.evaluations.postResults(resultBatch);
      resultBatch = [];
    }
  };

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    const testcase = testcases[i];

    // Invoke the application
    const { output, traceId } = await invoke(testcase.data);

    // Run each evaluator
    for (const evalRevId of evaluatorRevisionIds) {
      const evalResult = await evaluate(evalRevId, testcase.data, output);

      resultBatch.push({
        run_id: runId,
        scenario_id: scenario.id,
        step_key: evalRevId,
        status: "success",
        testcase_id: testcase.id,
        trace_id: traceId,
        meta: {
          score: evalResult.score,
          reasoning: evalResult.reasoning,
          ...evalResult,
        },
      });
      resultCount++;

      if (resultBatch.length >= resultBatchSize) {
        await flushBatch();
      }
    }

    onProgress?.(i + 1, scenarios.length, testcase.data);
  }

  // Flush remaining
  await flushBatch();

  // 7. Close
  await ag.evaluations.closeRun(runId, "success");

  return { evaluationId, runId, scenarioCount: scenarios.length, resultCount };
}
```

---

## Open Questions for Agenta Agent

### 1. Evaluation ID vs Run ID

In the corrected flow from doc 12, the code queries runs with `{ run: { ids: [evaluationId] } }`. Does the start endpoint return the run ID? Or is evaluation ID == run ID? If they're separate entities, what's the query to go from evaluation → run?

### 2. Testset reference in create

The `testset_steps` key — is it the testset ID or the testset revision ID? Doc 12 uses `testsetRevisionId` but we're storing testset IDs in our flow. Need to clarify which reference the create endpoint expects.

### 3. Scenario query — does it return testcase data?

When we query scenarios after start, does each scenario include the testcase data inline? Or do we always need to separately fetch the testset? If scenarios include testcase data, we can skip the extra fetch.

### 4. Error handling in local execution

If our invoke function throws for one testcase, should we:
- Skip that scenario and continue (post a result with `status: "failure"` and `error: message`)
- Close the run with `status: "errors"`
- Something else?

What does the Agenta UI expect for partial failures?

---

## Implementation Priority (Updated)

Based on confirmed API shapes, here's the build order:

### Week 1: SDK Primitives
- [ ] `TestSets` class (CRUD, query)
- [ ] `Evaluations` class (create, start, queryScenarios, postResults, closeRun)
- [ ] `Evaluators.listTemplates()` / `getTemplate()` / `listPresets()`
- [ ] Types for all of the above

### Week 2: Local Execution + Orchestration
- [ ] `runLocalEvaluation()` helper with batching
- [ ] Error handling (partial failures, retries)
- [ ] Prompt analyzer (LLM → extract rules, constraints, tools)
- [ ] Test case generator (LLM → produce test cases)

### Week 3: Dogfood on rh-onboarding
- [ ] Wire up rh-onboarding as the first target
- [ ] Multi-turn conversation simulator as the invoke function
- [ ] LLM-as-a-Judge evaluators for tone, structure, tool usage
- [ ] Run baseline evaluation, capture findings in doc 14

### Week 4: Variant Loop
- [ ] Prompt variant generator (targeted rewrites based on weak scores)
- [ ] Comparison utilities (diff two evaluation runs)
- [ ] Auto-deploy winner to production environment
