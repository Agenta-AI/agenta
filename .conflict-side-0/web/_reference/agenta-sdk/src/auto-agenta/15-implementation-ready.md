# Implementation Ready — Final Spec

> From the my-agent agent. All unknowns are closed. This is the build doc.

---

## Status: All questions resolved across docs 10–14

| Doc | Purpose | Status |
|-----|---------|--------|
| 10 | API shape confirmations | ✅ Confirmed |
| 11 | SDK implementation plan | ✅ Corrected by 12 |
| 12 | Execution flow corrections | ✅ Applied |
| 13 | Corrected SDK spec | ✅ Confirmed by 14 |
| 14 | Final answers | ✅ All unknowns closed |
| **15** | **This doc — build against this** | **🔨 Active** |

---

## Key Facts (no ambiguity)

- **Evaluation ID == Run ID** — same UUID, no extra query
- **All step references are revision IDs** — use `testset.revision_id` from simple API
- **`status: "running"` skips worker dispatch** — SDK owns execution
- **Scenarios created by `start`** — query after start, match to testcases by index
- **Results go in `meta`** — `{ meta: { score, reasoning } }`
- **Results are batched** — `{ results: [...] }` not singular
- **Partial failures** — post `status: "failure"` per result, close run with `"errors"`
- **Scenarios don't include testcase data** — always fetch testset separately

---

## Build Order

### Phase 1: SDK Classes (agenta agent owns, we review)

#### TestSets class
```
POST   /preview/simple/testsets/              → create({ slug, name, description?, testcases })
GET    /preview/simple/testsets/{id}           → get(id) → TestSet with inline testcases
PUT    /preview/simple/testsets/{id}           → update(id, { name?, testcases? }) — full replace
DELETE /preview/simple/testsets/{id}           → delete(id)
POST   /preview/simple/testsets/query          → query() → TestSet[]
POST   /preview/simple/testsets/{id}/archive   → archive(id)
POST   /preview/simple/testsets/{id}/unarchive → unarchive(id)
```

#### Evaluations class
```
POST   /preview/simple/evaluations/                        → createSimple(options)
POST   /preview/simple/evaluations/{id}/start              → startSimple(id)
POST   /preview/evaluations/scenarios/query                → queryScenarios(runIds)
POST   /preview/evaluations/results/                       → postResults(results[])
POST   /preview/evaluations/runs/{id}/close/{status}       → closeRun(id, status)
POST   /preview/evaluations/runs/close                     → bulkCloseRuns(runIds)
```

#### Evaluator Templates (extend existing Evaluators class)
```
GET    /preview/evaluators/catalog/templates/               → listTemplates()
GET    /preview/evaluators/catalog/templates/{key}          → getTemplate(key)
GET    /preview/evaluators/catalog/templates/{key}/presets/  → listPresets(key)
```

### Phase 2: Local Execution Orchestrator (we own)

The `runLocalEvaluation()` function from doc 13 with error handling from doc 14:

```typescript
async function runLocalEvaluation(ag: Agenta, options: {
  name: string;
  testsetRevisionId: string;       // from testset.revision_id
  appRevisionId: string;           // from app revision
  evaluatorRevisionIds: string[];  // from evaluator revisions
  invoke: (testcaseData: Record<string, unknown>) => Promise<{
    output: Record<string, unknown>;
    traceId?: string;
  }>;
  evaluate: (stepKey: string, input: Record<string, unknown>, output: Record<string, unknown>) => Promise<{
    score: number;
    reasoning?: string;
  }>;
  onProgress?: (completed: number, total: number) => void;
  resultBatchSize?: number;
}): Promise<{
  evaluationId: string;
  scenarioCount: number;
  resultCount: number;
  hasErrors: boolean;
}> {
  // 1. Create with status=running
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
  });
  const evaluationId = evalRes.evaluation.id; // == runId

  // 2. Start (creates scenarios, skips dispatch)
  await ag.evaluations.startSimple(evaluationId);

  // 3. Query scenarios + fetch testset
  const [{ scenarios }, testset] = await Promise.all([
    ag.evaluations.queryScenarios([evaluationId]),
    ag.testsets.get(options.testsetRevisionId),
  ]);
  const testcases = testset.data.testcases;

  // 4. Execute locally
  let resultCount = 0;
  let hasErrors = false;
  let batch: EvaluationResult[] = [];
  const batchSize = options.resultBatchSize ?? 10;

  const flush = async () => {
    if (batch.length > 0) {
      await ag.evaluations.postResults(batch);
      batch = [];
    }
  };

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    const testcase = testcases[i];

    try {
      const { output, traceId } = await options.invoke(testcase.data);

      for (const evalRevId of options.evaluatorRevisionIds) {
        try {
          const result = await options.evaluate(evalRevId, testcase.data, output);
          batch.push({
            run_id: evaluationId,
            scenario_id: scenario.id,
            step_key: evalRevId,
            status: "success",
            testcase_id: testcase.id,
            trace_id: traceId,
            meta: { score: result.score, reasoning: result.reasoning },
          });
        } catch (evalErr) {
          hasErrors = true;
          batch.push({
            run_id: evaluationId,
            scenario_id: scenario.id,
            step_key: evalRevId,
            status: "failure",
            testcase_id: testcase.id,
            error: String(evalErr),
          });
        }
        resultCount++;
        if (batch.length >= batchSize) await flush();
      }
    } catch (invokeErr) {
      hasErrors = true;
      batch.push({
        run_id: evaluationId,
        scenario_id: scenario.id,
        step_key: "invocation",
        status: "failure",
        testcase_id: testcase.id,
        error: String(invokeErr),
      });
      resultCount++;
    }

    options.onProgress?.(i + 1, scenarios.length);
  }

  await flush();

  // 5. Close
  await ag.evaluations.closeRun(evaluationId, hasErrors ? "errors" : "success");

  return { evaluationId, scenarioCount: scenarios.length, resultCount, hasErrors };
}
```

### Phase 3: Dogfood on rh-onboarding (we own)

1. **Prompt analysis** — LLM extracts rules/constraints from rh-onboarding prompt
2. **Test case generation** — LLM generates test cases per extracted rule
3. **Evaluator setup** — Map rules → LLM-as-a-Judge evaluators using `auto_ai_critique` template
4. **Multi-turn invoke** — Conversation simulator plays out turns against our agent
5. **Baseline run** — Execute, capture scores, record findings

### Phase 4: Optimization loop (both agents)

1. **Variant generation** — LLM rewrites prompt targeting weak scores
2. **Comparison** — Run same testset against variant, compare scores
3. **Deploy winner** — Promote best revision to production environment

---

## Status Update — Phases 1 & 2 Complete

### Phase 1: SDK Primitives ✅ (agenta agent)
All classes implemented in `lib/agenta-sdk/`:
- `testsets.ts` — Full CRUD + query + archive + commitRevision + createFromTraces
- `evaluations.ts` — createSimple, startSimple, queryScenarios, postResults, closeRun + bulk ops
- `evaluators.ts` — listTemplates, getTemplate, listPresets added

### Phase 2: Orchestration ✅ (my-agent agent)
Two files in `lib/agenta-sdk/auto-agenta/`:

**`run-local-evaluation.ts`** — Generic local execution orchestrator
- Creates evaluation with `status: "running"` → start → query scenarios → invoke → evaluate → batch-post → close
- Error handling: per-result failure posting, run closes with "errors" status
- Batched result posting (configurable batch size)
- Progress callback

**`onboarding-eval-harness.ts`** — rh-onboarding dogfood harness
- 6 test cases covering happy paths + edge cases + anti-pattern checks
- 4 LLM-as-a-Judge evaluators (tone, structure, tool usage, conversation flow)
- Multi-turn conversation simulator
- `runOnboardingEvaluation()` — full one-call harness that sets up test sets, evaluators, and runs evaluation

### Next: Phase 3 — Wire Up & Run
Need to:
1. Wire `callAgent` to our actual agent (from `lib/agent.ts`)
2. Wire `callJudge` to an LLM call (via AI SDK / AI Gateway)
3. Get the `appRevisionId` for rh-onboarding from Agenta
4. Run the baseline evaluation
5. Capture findings in `16-dogfood-findings.md`
