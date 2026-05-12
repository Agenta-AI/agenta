# Agenta Agent Answers to Open Questions

> Responses from the agenta agent after reviewing the actual codebase.
> Cross-referenced against the API routers, models, DTOs, and frontend clients.

---

## Answers to 00-overview.md

No specific questions, but a correction:

> "Test set CRUD (not implemented yet)"

**Actually**: Test sets use the full Workflows git pattern (artifact → variant → revision) and have a complete API. The TS SDK just hasn't wrapped it yet. This is purely an SDK gap, not a platform gap.

---

## Answers to 01-testcase-generation.md

### Q1: What's the Agenta API shape for test set CRUD?

Test sets follow the same git pattern as workflows. All endpoints under `/preview/testsets/`:

| Endpoint | Method | Purpose |
|---|---|---|
| `/simple/testsets/` | POST | Create testset with inline testcases |
| `/simple/testsets/{id}` | GET | Fetch testset with testcases |
| `/simple/testsets/{id}` | PATCH | Edit testset |
| `/simple/testsets/{id}` | DELETE | Delete testset |
| `/testsets/query` | POST | List/filter testsets |
| `/testsets/revisions/retrieve` | POST | Retrieve specific revision |
| `/testsets/revisions/commit` | POST | Commit new revision (with delta support) |
| `/testsets/revisions/log` | POST | Get revision history |

**Create request shape** (Simple API):
```json
POST /preview/simple/testsets/
{
  "testset": {
    "slug": "onboarding-tests",
    "name": "Onboarding Test Cases",
    "data": {
      "testcases": [
        { "data": { "user_message": "hi", "expected_tool": "getUserContext" } },
        { "data": { "user_message": "mybeans.com", "expected_tool": "detectStore" } }
      ]
    }
  }
}
```

**Testcase structure**: Each testcase is `{ data: Record<string, unknown> }` — completely freeform columns. No enforced schema. The `data` object holds whatever key-value pairs you want. A `testcase_dedup_id` is computed automatically from the data hash.

**Revision commits support deltas**:
```json
POST /preview/testsets/revisions/commit
{
  "testset_revision": {
    "testset_id": "...",
    "data": {
      "testcases": [/* new/replaced cases */]
    }
  }
}
```

### Q2: Does the evaluation runner support multi-turn natively?

**No.** The evaluation runner calls the application once per scenario (testcase). Multi-turn is a consumer-side concern. You'd need to:

1. Wrap your application in a "conversation simulator" that plays all turns
2. OR model each turn as a separate testcase, linked by metadata
3. OR use the `is_split` flag with repeats to fan out execution

The evaluation runner does support **steps** (input → invocation → annotation), and each step can reference traces. So you could model a multi-turn conversation as one scenario where the invocation step runs the full conversation and returns a consolidated trace.

### Q3: Is there a "create test set from traces" API?

**Not as a single API call.** The flow is:

1. Query traces: `POST /preview/spans/query` (already in SDK)
2. Extract inputs/outputs from trace attributes (`ag.data.inputs`, `ag.data.outputs`)
3. Create testset: `POST /preview/simple/testsets/` with the extracted data

This is a client-side composition. The SDK should provide a convenience method, but the underlying operations already exist.

### Q4: How are evaluator results tied back to traces?

`EvaluationResult` has `trace_id` and `span_id` fields. When the evaluation runner executes an invocation step, it creates a trace and stores the trace_id in the result. The `Link` system auto-connects traces to evaluation runs.

### Q5: Conversation metadata in test cases?

Testcases are freeform `{ data: Record<string, unknown> }`. You can store anything:
```json
{
  "data": {
    "turns": [
      {"user": "hi", "expected_tool": "getUserContext"},
      {"user": "mybeans.com", "expected_tool": "detectStore"}
    ],
    "expected_completion": true,
    "max_turns": 4,
    "persona": "casual coffee roaster"
  }
}
```

No schema enforcement — the evaluation runner uses `mappings` to extract specific paths from testcase data.

---

## Answers to 02-evaluator-generation.md

### Q1: What evaluator types does Agenta support?

Evaluators are **workflows** with `is_evaluator: true`. The catalog at `/preview/evaluators/catalog/templates/` lists built-in types:

- **Code evaluators** — custom code (Python) evaluators with access to inputs/outputs
- **LLM-as-a-Judge** — `auto_ai_critique` URI, configurable prompt + model
- **Exact match** — `auto_exact_match`
- **Regex** — `auto_regex_test`
- **JSON match** — `auto_json_match`
- **Semantic similarity** — `auto_semantic_similarity`
- **Starts/ends with** — `auto_starts_with`, `auto_ends_with`
- **Contains keywords** — `auto_contains`
- **Webhook** — calls external endpoint for scoring
- **Human** — manual annotation via queue UI

Each has a URI like `agenta:builtin:auto_exact_match:v0`.

### Q2: Can code evaluators access trace data?

**Yes.** Evaluator steps have `inputs` that reference other steps (input step and invocation step). The invocation step's result includes the trace. The evaluator receives the full output including trace attributes.

The mapping system connects step outputs to evaluator inputs:
```json
{
  "column": {"kind": "invocation", "name": "outputs"},
  "step": {"key": "invocation-key", "path": "attributes.ag.data.outputs"}
}
```

So you can map `attributes.ag.data.outputs.tool_calls` into your evaluator.

### Q3: LLM-as-a-Judge API shape?

Create as a workflow with the `auto_ai_critique` URI:

```json
POST /preview/workflows/
{
  "workflow": {
    "slug": "rh-tone-check",
    "name": "Casual Tone Evaluator",
    "flags": {"is_evaluator": true}
  }
}

POST /preview/workflows/revisions/commit
{
  "workflow_revision": {
    "workflow_id": "<id>",
    "data": {
      "uri": "agenta:builtin:auto_ai_critique:v0",
      "url": "http://localhost/services/chat/v0",
      "parameters": {
        "prompt": {
          "messages": [
            {"role": "system", "content": "Rate whether this response uses casual tone..."},
            {"role": "user", "content": "Input: {{inputs}}\nOutput: {{outputs}}\nScore (0-1):"}
          ],
          "llm_config": {"model": "gpt-5.4"}
        }
      },
      "schemas": {
        "outputs": {
          "type": "object",
          "properties": {
            "score": {"type": "number"},
            "reasoning": {"type": "string"}
          }
        }
      }
    }
  }
}
```

### Q4: Can evaluators be scoped to applications?

**No enforcement at the API level.** Evaluators are project-scoped, not app-scoped. Any evaluator can be used with any app in the same project. Scoping is purely organizational (naming, metadata).

### Q5: Tool call assertion evaluators?

Model as **code evaluators** that parse the trace output. The invocation step exposes `attributes.ag.data.outputs` which includes tool call data. Map that path into your evaluator's input, then the evaluator code inspects it.

There's no first-class "tool call assertion" type. But with the mapping system, you have full access to trace attributes.

### Q6: Evaluator versioning alongside prompts?

**Yes, built-in.** Evaluators use the same revision model as everything else. When you update an evaluator, you commit a new revision. You can pin evaluation runs to specific evaluator revisions via `evaluator_revision` references. So you get full traceability: "this evaluation used prompt revision X with evaluator revision Y."

---

## Answers to 03-orchestration-loop.md

### Q: Architecture preference (SDK vs. consumer vs. separate package)?

**Option C is correct.** The SDK should provide CRUD primitives. Orchestration is consumer-side logic.

Here's why from the Agenta perspective:
- The SDK mirrors the REST API — it's a thin typed client
- Orchestration logic (prompt analysis, variant generation, decision making) involves LLM calls that have nothing to do with the platform API
- Different consumers will want different optimization strategies

**Recommended split:**
- `lib/agenta-sdk/` — API client (what we built)
- `lib/auto-agenta/` — orchestration layer (consumer-side, uses SDK)
- Test case generation, evaluator generation, variant generation are all LLM calls that belong in the orchestration layer

---

## Answers to 04-multi-turn-evaluation.md

### Q1: Can a single evaluation run handle multiple sub-evaluations per turn?

**Yes.** A single run has multiple **steps**, and each step can be an annotation step with its own evaluator. So you could have:

```
Step: input (testcase)
Step: invocation (call the app for turn 1)
Step: annotation-turn1-tone (evaluate tone)
Step: annotation-turn1-structure (evaluate structure)
Step: invocation-turn2 (call the app for turn 2)
Step: annotation-turn2-tone (evaluate tone)
...
```

BUT: this requires modeling the multi-turn flow in the steps definition upfront. The evaluation runner doesn't natively "loop" through turns.

### Q2: Is the scenario model flexible enough for turns?

**Partially.** Each scenario maps to one testcase. If your testcase contains all turns as structured data (see Q5 from 01-testcase-generation), then one scenario = one full conversation. The evaluator receives the full testcase data and can evaluate per-turn.

The more practical approach: **one scenario = one full conversation**, with the invocation step running the entire multi-turn flow and the evaluator receiving the complete conversation trace.

### Q3: One scenario with multiple results, or multiple scenarios?

**One scenario per conversation, multiple results.** Each annotation step produces an `EvaluationResult` per scenario. So if you have 3 evaluator steps (tone, structure, completion), you get 3 results per scenario. Use step keys to distinguish: `invocation.tone_check`, `invocation.structure_check`, `invocation.completion_check`.

### Q4: Multi-turn traces?

**One trace per conversation with multiple spans.** Each LLM call within the conversation is a child span. The parent span covers the full conversation. Spans have `ag.type.tree = "invocation"` and child spans for each tool call/LLM call.

---

## Answers to 05-sdk-gaps.md

### Test Sets Q1-Q4:

1. **Endpoints**: Listed above in Q1 of 01-testcase-generation.
2. **Schema**: Freeform. No column schema enforcement. Testcases are `{ data: Record<string, unknown> }`.
3. **Revision model**: Yes, commits create new revisions automatically. The `commit` endpoint supports delta operations.
4. **createFromTraces**: Client-side composition. Fetch traces → extract data → create testset.

### Environments Q1-Q3 (Online Evaluation):

1. **Online evaluation API**: This maps to the `is_live: true` flag on evaluation runs. Creating an evaluation with `flags: { is_live: true }` sets up continuous evaluation. The `start` endpoint activates it.

2. **Same evaluators**: Yes. Online and offline evaluations use the same evaluator definitions. The only difference is the data source: offline uses testsets, online uses live traces.

3. **Sampling/filtering**: Configured via the `query_steps` in the evaluation data. Live evaluations use query steps that filter traces by criteria. The sampling rate isn't a first-class concept — you'd filter traces in the query step.

### Environments: Deployment

The environments API at `/preview/environments/` manages deployment:
- Create an environment (e.g., "production")
- Commit a revision that references the app revision to deploy
- The `resolve` endpoint resolves all references at deployment time

### What to build next in the SDK:

**P0: TestSets** — endpoints exist, just need the manager class. Same pattern as Workflows.

**P1: Environments** — endpoints exist, need the manager. Simple CRUD + `revisions/commit` for deploying + `revisions/resolve` for promotion.

**P1: Online Evaluation** — no separate API needed. It's the same evaluations API with `is_live: true`. The SDK already has `evaluations.createSimple()` which accepts flags.

**P2: Trace Annotation** — annotations are modeled as evaluation results with `origin: "human"`. Use the annotation queue system (`/preview/simple/queues/`). The SDK already has `Evaluations` — it just needs the queue methods.

---

## Answers to 06-annotation-strategies.md

### Q1: Native annotation model?

**Yes.** Annotations are evaluation results with `origin: "human"` or `origin: "auto"`. They're stored in the `EvaluationResult` entity with `step_key`, `scenario_id`, and `run_id`. The result `data` field holds the annotation payload (scores, labels, notes).

### Q2: Human review queue?

**Yes.** The `/preview/simple/queues/` API provides annotation queues:
- Create a queue with `kind: "traces"` to annotate traces
- Assign users via `assignments: [[user_a, user_b], [user_c]]`
- Users get assigned scenarios to review
- `POST /preview/simple/queues/{id}/traces/` adds trace IDs to the queue

The SDK `Evaluations` class doesn't have queue methods yet, but the `EvaluationQueue` types exist.

### Q3: Online eval → test set annotation link?

Online evaluation results reference traces via `trace_id`. You can query results for a live evaluation, get the trace IDs, and use those to create test cases. It's a client-side composition:

```
Live eval results → filter by score → extract trace_ids → fetch traces → create testset
```

### Q4: LLM-as-a-Judge for test case annotation — Agenta or standalone?

**Use Agenta's evaluation system.** Create an LLM-as-a-Judge evaluator as a workflow, then run it against your candidate test cases. The scores become the annotation. This is exactly what the evaluation runner does — it's not limited to "evaluation" in the narrow sense; it's a general-purpose "run evaluators against data" system.

### Q5: Confidence and review status in Agenta's data model?

Store in the `metadata` field of `EvaluationResult`. The metadata field is freeform (`Dict[str, Any]`), so you can add:
```json
{
  "confidence": 0.85,
  "needs_review": false,
  "auto_scores": { "structural": 1.0, "tone": 0.85 },
  "review_status": "approved"
}
```

The evaluation queue system handles the review workflow — push low-confidence cases to a queue, humans review them, results are updated.
