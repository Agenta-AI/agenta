# Agenta Agent: API Shape Confirmations

> Definitive answers to the questions in 09-dogfooding-response.md, verified against the actual router handlers, service layer, and DTOs.

---

## 1. Simple Testsets API — Confirmed Shapes

### POST /preview/simple/testsets/ — Create

**Request:**
```json
{
  "testset": {
    "slug": "onboarding-tests",
    "name": "Onboarding Test Cases",
    "description": "Auto-generated test cases for rh-onboarding",
    "data": {
      "testcases": [
        {
          "data": {
            "user_message": "hi",
            "expected_tool": "getUserContext",
            "expected_constraints": ["asks_for_store_url", "max_2_sentences"]
          }
        },
        {
          "data": {
            "user_message": "mybeans.com",
            "expected_tool": "detectStore",
            "persona": "casual coffee roaster"
          }
        }
      ]
    }
  }
}
```

**Response:** `SimpleTestsetResponse`
```json
{
  "count": 1,
  "testset": {
    "id": "uuid-here",
    "slug": "onboarding-tests",
    "name": "Onboarding Test Cases",
    "description": "...",
    "data": {
      "testcases": [
        {
          "id": "auto-generated-uuid",
          "data": { "user_message": "hi", "expected_tool": "getUserContext", ... }
        },
        ...
      ]
    },
    "revision_id": "uuid",
    "variant_id": "uuid",
    "created_at": "2026-03-27T...",
    "updated_at": "2026-03-27T..."
  }
}
```

**Yes, the created testset (with its `id`) is returned.** Testcases get auto-assigned UUIDs.

### GET /preview/simple/testsets/{id} — Fetch

**Yes, testcases are included inline.** The handler fetches the default revision and returns its `data.testcases` array with full testcase objects (id + data).

Response shape is identical to the create response.

### PUT /preview/simple/testsets/{id} — Edit

**Replaces testcases entirely.** This is a full replacement, not a merge. If you send 3 testcases, you get 3 testcases — previous ones are gone (in that revision).

**Request:**
```json
{
  "testset": {
    "id": "the-testset-id",
    "name": "Updated Name",
    "data": {
      "testcases": [
        { "data": { "user_message": "new case", ... } }
      ]
    }
  }
}
```

**For incremental adds, use the revisions/commit endpoint instead** (supports deltas).

### POST /preview/simple/testsets/query — List

**Response:** `SimpleTestsetsResponse`
```json
{
  "count": 5,
  "testsets": [
    {
      "id": "...",
      "slug": "onboarding-tests",
      "name": "Onboarding Test Cases",
      "data": { "testcases": [...] },
      "revision_id": "...",
      "variant_id": "...",
      "created_at": "...",
      "updated_at": "..."
    },
    ...
  ]
}
```

Each testset in the list includes inline testcases.

### POST /preview/simple/testsets/{id}/archive — Soft delete

Sets `deleted_at` and `deleted_by_id`. Use `/unarchive` to restore.

---

## 2. Evaluator Workflow Creation — Confirmed Shapes

### Q: Does the `url` field in revision data matter?

**Yes.** The evaluation runner uses `application_revision.data.url` to make HTTP calls to the service. For built-in evaluators, this is typically `http://localhost/services/chat/v0` or similar — it points to the Agenta service that hosts the evaluator handler.

For LLM-as-a-Judge (`auto_ai_critique`), the `url` should point to the service that handles the critique flow. Use:
```json
"url": "http://localhost/services/chat/v0"
```
This is the standard builtin service URL. The `uri` field (`agenta:builtin:auto_ai_critique:v0`) tells the service which handler to use.

### Q: What's the `schemas.outputs` expectation?

There's no hard requirement for specific field names. The output schema is freeform. However, the conventional structure for LLM-as-a-Judge is:
```json
{
  "schemas": {
    "outputs": {
      "type": "object",
      "properties": {
        "score": { "type": "number" },
        "reasoning": { "type": "string" }
      }
    }
  }
}
```

The evaluation results store whatever the evaluator returns in its `data` field. Downstream consumers (UI, aggregation) look for specific paths via the `mappings` system.

### Q: One evaluator for multiple checks, or separate evaluators?

**Separate evaluators.** Each evaluator should check one thing. Reasons:
1. The evaluation UI and metrics system groups scores by evaluator
2. You can selectively include/exclude evaluators per evaluation run
3. Easier to version and iterate on individual checks
4. Mappings are cleaner: `evaluator.slug.score` vs `evaluator.slug.tone_score` + `evaluator.slug.structure_score`

If you want a compound check, create a "meta-evaluator" that aggregates, but keep the individual checks as separate evaluators.

---

## 3. Evaluation Run Invocation — How It Works

### How the invocation step calls the application

The evaluation runner:

1. **Fetches the application revision** referenced in the step
2. **Extracts `data.url`** from the revision — this is the HTTP endpoint
3. **Extracts `data.parameters`** from the revision — these are the prompt/config params
4. **Calls `batch_invoke()`** which makes HTTP POST requests to the `data.url` endpoint with:
   - Testcase data as input
   - Revision parameters as configuration
   - Returns the response + trace_id

### For multi-turn: you need a service endpoint

The evaluation runner doesn't "know" about multi-turn. It calls the URL and expects a response. For multi-turn evaluation, you have two options:

**Option A: Deploy a conversation simulator as a service**

Create a service endpoint (e.g., `/api/evaluate/conversation`) that:
1. Receives a testcase with `turns` array
2. Plays out all turns against your agent
3. Returns the consolidated conversation + trace

Register this as the application's `data.url` in a special "evaluation variant."

**Option B: Use `data.status == "running"` (SDK-local execution)**

When creating a simple evaluation, if `data.status` is set to `"running"`, the service returns immediately and expects the caller (SDK) to handle execution locally. The runner checks:
```python
if _data.status == "running":
    # The SDK is responsible for executing this evaluation
    return evaluation
```

This means **your SDK/orchestration code can run the invocation step itself**, create results via the API, and the evaluation runner just tracks status. This is the path for custom invocation logic like multi-turn simulation.

**My recommendation:** Option B for the dogfood. Your orchestration layer:
1. Creates the evaluation run with `data.status = "running"`
2. Iterates testcases locally, running your conversation simulator
3. Posts results back via `POST /preview/evaluations/results/`
4. Closes the run via `POST /preview/evaluations/runs/{id}/close`

This gives you full control over the invocation step without deploying a separate service.

---

## 4. Evaluator Template Catalog — Response Shape

### GET /preview/evaluators/catalog/templates/

```json
{
  "count": 12,
  "templates": [
    {
      "key": "auto_exact_match",
      "name": "Exact Match",
      "description": "Checks if output exactly matches expected value",
      "categories": ["string_matching"],
      "flags": { "is_archived": false },
      "data": {
        "uri": "agenta:builtin:auto_exact_match:v0",
        "schemas": {
          "parameters": { ... },
          "outputs": { ... }
        }
      }
    },
    {
      "key": "auto_ai_critique",
      "name": "AI Critique",
      "description": "LLM-as-a-Judge evaluation",
      "categories": ["llm_judge"],
      "flags": { "is_archived": false },
      "data": {
        "uri": "agenta:builtin:auto_ai_critique:v0",
        "schemas": {
          "parameters": {
            "properties": {
              "prompt": {
                "x-ag-type": "prompt-template",
                "type": "object",
                "default": { "messages": [...], "llm_config": {...} }
              }
            }
          },
          "outputs": { ... }
        }
      }
    },
    ...
  ]
}
```

### GET /preview/evaluators/catalog/templates/{key}

Same shape, single template in `template` field:
```json
{
  "count": 1,
  "template": { "key": "auto_ai_critique", ... }
}
```

### GET /preview/evaluators/catalog/templates/{key}/presets/

Returns presets (pre-configured evaluator variants) for a template:
```json
{
  "count": 3,
  "presets": [
    {
      "key": "helpfulness",
      "name": "Helpfulness",
      "data": {
        "parameters": {
          "prompt": {
            "messages": [
              { "role": "system", "content": "Rate the helpfulness of the response..." }
            ]
          }
        }
      }
    },
    ...
  ]
}
```

---

## Summary: SDK Implementation Path

Based on everything confirmed above, here's the exact SDK additions needed:

### TestSets class (P0)
```
POST   /preview/simple/testsets/              → create
GET    /preview/simple/testsets/{id}           → get (testcases inline)
PUT    /preview/simple/testsets/{id}           → update (full replace)
DELETE /preview/simple/testsets/{id}           → delete
POST   /preview/simple/testsets/query          → query (list all)
POST   /preview/simple/testsets/{id}/archive   → archive
POST   /preview/simple/testsets/{id}/unarchive → unarchive
POST   /preview/testsets/revisions/commit      → commitRevision (delta)
```

### Evaluator Templates (on existing Workflows/Evaluators class)
```
GET /preview/evaluators/catalog/templates/          → listTemplates
GET /preview/evaluators/catalog/templates/{key}     → getTemplate
GET /preview/evaluators/catalog/templates/{key}/presets/ → listPresets
```

### Environments class (P1)
```
POST /preview/environments/                    → create
POST /preview/environments/query               → query
POST /preview/environments/revisions/commit    → deploy (commit ref)
POST /preview/environments/revisions/resolve   → resolve (promotion)
```
