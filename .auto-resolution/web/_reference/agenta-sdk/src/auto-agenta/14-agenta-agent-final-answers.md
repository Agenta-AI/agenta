# Agenta Agent: Final Answers for SDK Spec

> Definitive answers to the 4 questions in 13-corrected-sdk-spec.md.
> These close the last unknowns before implementation.

---

## Q1: Evaluation ID vs Run ID

**They are the same UUID.**

When `SimpleEvaluationsService.create()` runs, it calls `self.evaluations_service.create_run()` which returns a run. The `run.id` is immediately passed to `start()` as `evaluation_id`. There is no separate "evaluation" entity — the simple evaluation IS the run.

This simplifies the flow. In doc 13's orchestrator:
```typescript
// This is correct:
const runId = evaluationId;  // ✅ Same thing
```

No separate query needed.

---

## Q2: Testset Reference — It's the Revision ID

**`testset_steps` expects testset REVISION IDs, not testset IDs.**

The backend resolution chain:
1. Takes UUID from `testset_steps` key
2. Calls `fetch_testset_revision(testset_revision_ref=Reference(id=uuid))`
3. From the revision, walks up to variant → testset
4. Extracts `testset_revision.data.testcases`

So in your create call:
```typescript
data: {
  testset_steps: { [testsetRevisionId]: "auto" },  // ✅ revision ID
  application_steps: { [appRevisionId]: "auto" },   // revision ID
  evaluator_steps: { [evalRevisionId]: "auto" },    // revision ID
}
```

**All step references are revision IDs.** The frontend's `createEvaluation` function also passes `testset_revision_id`.

When using the Simple TestSets API, the `GET /preview/simple/testsets/{id}` response includes `revision_id` — use that value.

---

## Q3: Scenario Query — No Testcase Data Inline

**Scenarios do NOT include testcase data.** The `EvaluationScenario` model contains only:
- `id`, `run_id`, `status`, `interval`, `timestamp`, lifecycle fields, metadata

You must separately fetch the testset to get testcase data. The corrected flow:

```typescript
// 1. Query scenarios (just IDs + status)
const { scenarios } = await ag.evaluations.queryScenarios([runId]);

// 2. Fetch testset separately (has testcases inline)
const testset = await ag.testsets.get(testsetId);
const testcases = testset.data.testcases;

// 3. Match by index (1:1 mapping)
for (let i = 0; i < scenarios.length; i++) {
  const scenario = scenarios[i];
  const testcase = testcases[i];
  // ...
}
```

This is what doc 13's orchestrator already does — confirmed correct.

---

## Q4: Partial Failure Handling

**Post a result with `status: "failure"` and continue.** Then close the run with status `"errors"`.

The backend's own behavior:
- Individual result: `status = "failure"`, `error` field populated
- Scenario: if any result failed → `status = "errors"`
- Run: if any scenario has errors → `status = "errors"`. Only `"success"` when ALL scenarios succeed

**For local execution, mirror this:**

```typescript
for (let i = 0; i < scenarios.length; i++) {
  const scenario = scenarios[i];
  const testcase = testcases[i];
  let scenarioHasErrors = false;

  try {
    const { output, traceId } = await invoke(testcase.data);

    for (const evalRevId of evaluatorRevisionIds) {
      try {
        const evalResult = await evaluate(evalRevId, testcase.data, output);
        resultBatch.push({
          run_id: runId,
          scenario_id: scenario.id,
          step_key: evalRevId,
          status: "success",
          testcase_id: testcase.id,
          trace_id: traceId,
          meta: { score: evalResult.score, reasoning: evalResult.reasoning },
        });
      } catch (evalErr) {
        scenarioHasErrors = true;
        resultBatch.push({
          run_id: runId,
          scenario_id: scenario.id,
          step_key: evalRevId,
          status: "failure",
          testcase_id: testcase.id,
          error: { message: String(evalErr) },
        });
      }
    }
  } catch (invokeErr) {
    scenarioHasErrors = true;
    // Post a failure result for the invocation step
    resultBatch.push({
      run_id: runId,
      scenario_id: scenario.id,
      step_key: "invocation",
      status: "failure",
      testcase_id: testcase.id,
      error: { message: String(invokeErr) },
    });
  }

  if (scenarioHasErrors) runHasErrors = true;
}

// Close with appropriate status
await ag.evaluations.closeRun(runId, runHasErrors ? "errors" : "success");
```

**What the UI expects:** The Agenta UI handles `"errors"` status gracefully — it shows which scenarios failed and which succeeded. It's a normal state, not a crash. Partial results are displayed.

---

## Summary: All Unknowns Resolved

| Question | Answer | Impact on SDK |
|---|---|---|
| Eval ID = Run ID? | Yes, same UUID | Simplifies flow — no extra query |
| Testset ref type | Revision ID | Use `testset.revision_id` from simple API |
| Scenario has testcase data? | No | Must fetch testset separately (already doing this) |
| Partial failure | Post `status: "failure"`, close with `"errors"` | Add try/catch per scenario, track `runHasErrors` |

**The SDK spec in doc 13 is confirmed correct** with one simplification (`evaluationId == runId`). Ready to implement.
