# Auto-Agenta: End-to-End Wiring Overview

> Complete reference for how the onboarding evaluation system works.
> Covers every file, every function, every API call, every data flow.
> Use this as the single source of truth for the eval pipeline.

---

## Table of Contents

1. [Architecture Summary](#1-architecture-summary)
2. [File Map](#2-file-map)
3. [Entry Point: `scripts/run-onboarding-eval.ts`](#3-entry-point)
4. [Harness: `onboarding-eval-harness.ts`](#4-harness)
5. [Orchestrator: `run-local-evaluation.ts`](#5-orchestrator)
6. [Full Execution Flow (Step by Step)](#6-full-execution-flow)
7. [Data Flow Diagrams](#7-data-flow-diagrams)
8. [Test Cases](#8-test-cases)
9. [Evaluators](#9-evaluators)
10. [Conversation Simulator](#10-conversation-simulator)
11. [Agent Wiring](#11-agent-wiring)
12. [Judge Wiring](#12-judge-wiring)
13. [Agenta API Calls (Exact Endpoints)](#13-agenta-api-calls)
14. [Error Handling](#14-error-handling)
15. [Where Results End Up](#15-where-results-end-up)
16. [Phase 4: What Comes Next](#16-phase-4)

---

## 1. Architecture Summary

Three TypeScript files form a layered pipeline:

```
┌─────────────────────────────────────────────────────────┐
│  scripts/run-onboarding-eval.ts         [ENTRY POINT]   │
│  ─────────────────────────────────                      │
│  • Loads .env.local                                     │
│  • Wires callAgent → ToolLoopAgent (lib/agent.ts)       │
│  • Wires callJudge → Sonnet via AI SDK generateText     │
│  • Looks up rh-onboarding revision in Agenta            │
│  • Calls runOnboardingEvaluation()                      │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  lib/agenta-sdk/auto-agenta/                            │
│  onboarding-eval-harness.ts             [HARNESS]       │
│  ───────────────────────────                            │
│  • Defines 6 test cases (ONBOARDING_TEST_CASES)         │
│  • Defines 4 evaluator configs (EVALUATOR_CONFIGS)      │
│  • setupOnboardingTestSet() → creates testset in Agenta │
│  • setupOnboardingEvaluators() → creates LLM judges     │
│  • createOnboardingInvoke() → conversation simulator    │
│  • createOnboardingEvaluate() → evaluator dispatch      │
│  • runOnboardingEvaluation() → full harness entry       │
│  • Builds revisionIdToSlug map for evaluator dispatch   │
│  • Calls runLocalEvaluation()                           │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  lib/agenta-sdk/auto-agenta/                            │
│  run-local-evaluation.ts                [ORCHESTRATOR]  │
│  ────────────────────────                               │
│  • Creates evaluation in Agenta (status: "running")     │
│  • Starts eval (Agenta creates scenarios, no workers)   │
│  • Queries scenarios + testset in parallel               │
│  • For each scenario: invoke → evaluate → batch results │
│  • Posts results to Agenta (batched)                    │
│  • Closes run (success or errors)                       │
└─────────────────────────────────────────────────────────┘
```

The key design principle: the orchestrator (`run-local-evaluation.ts`) is **generic** — it knows nothing about onboarding. The harness (`onboarding-eval-harness.ts`) is **specific** — it knows everything about the rh-onboarding prompt module. The script (`run-onboarding-eval.ts`) **wires** the harness to the real agent and judge.

---

## 2. File Map

| File | Role | Owns |
|------|------|------|
| `scripts/run-onboarding-eval.ts` | Entry point & wiring | `callAgent`, `callJudge`, app revision lookup |
| `lib/agenta-sdk/auto-agenta/onboarding-eval-harness.ts` | Onboarding-specific eval logic | Test cases, evaluator configs, conversation simulator, evaluator dispatch |
| `lib/agenta-sdk/auto-agenta/run-local-evaluation.ts` | Generic local eval orchestrator | Agenta API lifecycle (create → start → query → post → close) |
| `lib/agenta-sdk/index.ts` | SDK entry point | `Agenta` class with all managers |
| `lib/agenta-sdk/testsets.ts` | TestSets manager | CRUD for `/preview/simple/testsets/` |
| `lib/agenta-sdk/evaluations.ts` | Evaluations manager | createSimple, startSimple, queryScenarios, postResults, closeRun |
| `lib/agenta-sdk/evaluators.ts` | Evaluators manager | listTemplates, getTemplate, listPresets, findBySlug |
| `lib/agenta-sdk/workflows.ts` | Workflows manager | createEvaluator, fetchLatest, commitRevision, listTemplates, getTemplate |
| `lib/agent.ts` | ToolLoopAgent factory | `createAgent(userId, sessionId)` — the thing being evaluated |
| `lib/agenta.ts` | Prompt fetcher | `composeInstructions()` — fetches prompts from Agenta with 60s cache |

### pnpm script

```json
"eval:onboarding": "tsx scripts/run-onboarding-eval.ts"
```

Run with: `pnpm run eval:onboarding`

---

## 3. Entry Point: `scripts/run-onboarding-eval.ts`

### What it does

1. Loads environment from `.env.local` (AGENTA_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY)
2. Instantiates the Agenta SDK client
3. Looks up the `rh-onboarding` application and its latest revision ID
4. Defines two callback functions: `callAgent` and `callJudge`
5. Calls `runOnboardingEvaluation()` with everything wired together
6. Exits with code 1 if errors, 0 on success

### callAgent — How the real agent is invoked

```
callAgent(messages)
    │
    ├─ deriveSessionId(messages)
    │   → Hashes first user message content → stable session ID across turns
    │   → Format: "eval-session-{first16AlphanumChars}"
    │   → Same conversation always gets same session ID
    │
    ├─ createAgent(EVAL_USER_ID, sessionId)
    │   → Calls lib/agent.ts createAgent()
    │   → This internally calls composeInstructions() which fetches ALL
    │     prompt modules from Agenta (rh-voice, rh-principles, rh-ux-rules,
    │     rh-user-context, rh-onboarding, rh-capabilities, rh-workflow)
    │   → Creates a fresh ToolLoopAgent with all tools
    │   → Each call creates a new agent instance (stateless per call)
    │
    ├─ Convert messages to UIMessage format
    │   → [{ id: "eval-msg-0", role: "user", parts: [{ type: "text", text: "hi" }] }]
    │
    ├─ agent.generate(uiMessages)
    │   → Non-streaming generation (evaluation doesn't need streaming)
    │   → Agent processes the full conversation history
    │   → May call tools (getUserContext, detectStore, savePreference, etc.)
    │   → Returns result with all messages including tool calls
    │
    ├─ Extract text content
    │   → Filters assistant messages, extracts { type: "text" } parts
    │   → Joins multiple text parts with "\n"
    │
    └─ Extract tool calls
        → Filters assistant messages, extracts { type: "tool-call" } parts
        → Maps to [{ name: "getUserContext", args: {...} }]
```

**Important behavior**: Each `callAgent` call creates a fresh agent. The conversation simulator calls `callAgent` once per turn with the FULL message history. So turn 2 sends messages from turns 1+2, turn 3 sends all three. The agent sees the conversation context through the messages array, not through session state.

**Performance note**: 6 test cases × ~3 turns average = ~18 agent creations = ~18 `composeInstructions()` calls. The 60-second cache in `lib/agenta.ts` means prompts are fetched from Agenta once, then cached for subsequent calls within that window.

### callJudge — How the LLM judge works

```
callJudge(prompt)
    │
    ├─ getJudgeModel()
    │   → Prefers ANTHROPIC_API_KEY → anthropic("claude-sonnet-4-20250514")
    │   → Falls back to OPENAI_API_KEY → openai("gpt-4o")
    │   → The judge should be a stronger model than the agent being evaluated
    │
    ├─ generateText({ model, prompt, temperature: 0, maxTokens: 500 })
    │   → Uses AI SDK generateText (non-streaming, single-turn)
    │   → temperature: 0 for deterministic scoring
    │   → maxTokens: 500 keeps judge responses focused
    │
    └─ Parse response
        → Regex: /\{[\s\S]*"score"[\s\S]*\}/ extracts JSON from response
        → Handles markdown-wrapped code blocks (```json ... ```)
        → On parse failure: returns { score: 0.5, reasoning: "Unparseable..." }
        → Never throws — always returns a result
```

### App revision lookup

```typescript
const app = await ag.applications.findBySlug("rh-onboarding");
const revision = await ag.revisions.retrieveBySlug("rh-onboarding");
const appRevisionId = revision?.id;
```

`retrieveBySlug` returns the `ApplicationRevision` object directly — the `.id` field IS the revision ID. No casts needed.

---

## 4. Harness: `onboarding-eval-harness.ts`

### runOnboardingEvaluation() — The top-level harness

This is the single function the entry point calls. It orchestrates all setup and execution:

```
runOnboardingEvaluation({ ag, appRevisionId, callAgent, callJudge, name })
    │
    ├─ [1] setupOnboardingTestSet(ag)
    │   → Creates or updates "rh-onboarding-tests" testset in Agenta
    │   → Returns { testsetId, revisionId }
    │   → Uses ONBOARDING_TEST_CASES (6 test cases, defined below)
    │   → Idempotent: findBySlug → update if exists, create if not
    │
    ├─ [2] setupOnboardingEvaluators(ag)
    │   → Creates or updates 4 LLM-as-a-Judge evaluators in Agenta
    │   → Returns Record<slug, revisionId> mapping
    │   → Uses EVALUATOR_CONFIGS (4 evaluators, defined below)
    │   → Each evaluator is a Workflow with is_evaluator flag
    │   → Uses auto_ai_critique:v0 template from Agenta's catalog
    │   → Idempotent: findBySlug → fetchLatest if exists, createEvaluator if not
    │
    ├─ [3] Build revisionIdToSlug map
    │   → Inverts the evaluatorRevisionIds map
    │   → { "uuid-1": "tone-check", "uuid-2": "structure-check", ... }
    │   → Critical for evaluator dispatch (see section 9)
    │
    ├─ [4] createOnboardingInvoke(callAgent)
    │   → Returns the invoke function for the orchestrator
    │   → Wraps callAgent in multi-turn conversation simulation
    │
    ├─ [5] createOnboardingEvaluate(callJudge, revisionIdToSlug)
    │   → Returns the evaluate function for the orchestrator
    │   → Dispatches by resolving revision UUID → slug → config
    │
    └─ [6] runLocalEvaluation(ag, { ... })
        → Delegates to the generic orchestrator (see section 5)
        → Passes all the wired-up functions and IDs
```

---

## 5. Orchestrator: `run-local-evaluation.ts`

### runLocalEvaluation() — Generic evaluation executor

This function is reusable for ANY prompt module evaluation, not just onboarding. It talks to Agenta's API and delegates invocation + evaluation to callbacks.

```
runLocalEvaluation(ag, options)
    │
    ├─ [1] ag.evaluations.createSimple({
    │       name: "Onboarding Baseline — 2026-03-27",
    │       data: {
    │         status: "running",              ← KEY: tells Agenta we own execution
    │         testset_steps: { [revId]: "auto" },
    │         application_steps: { [revId]: "auto" },
    │         evaluator_steps: { [revId]: "auto", ... },
    │       },
    │       flags: { is_live: false, is_active: true, is_closed: false },
    │     })
    │   → POST /preview/simple/evaluations/
    │   → Returns { evaluation: { id: "uuid" } }
    │   → evaluationId == runId (same UUID, confirmed in doc 14)
    │
    ├─ [2] ag.evaluations.startSimple(evaluationId)
    │   → POST /preview/simple/evaluations/{id}/start
    │   → Agenta creates scenarios (1:1 with testcases)
    │   → Sees status="running" → returns immediately, NO worker dispatch
    │   → Scenarios now exist in Agenta's DB
    │
    ├─ [3] Promise.all([
    │       ag.evaluations.queryScenarios(...)  → POST /preview/evaluations/scenarios/query
    │       ag.testsets.get(revisionId)          → GET /preview/simple/testsets/{id}
    │     ])
    │   → Scenarios: [{ id: "sc-1" }, { id: "sc-2" }, ... ] — no testcase data
    │   → Testset: { data: { testcases: [{ id: "tc-1", data: {...} }, ...] } }
    │   → Matched by index: scenarios[0] ↔ testcases[0]
    │
    ├─ [4] For each scenario (i = 0..N):
    │   │
    │   ├─ Guard: check testcases[i] exists (mismatch → error, continue)
    │   │
    │   ├─ try: invoke(testcase.data)
    │   │   → Calls the conversation simulator (see section 10)
    │   │   → Returns { output: { messages, tool_calls, ... }, traceId? }
    │   │
    │   ├─ For each evaluator revision ID:
    │   │   │
    │   │   ├─ try: evaluate(revisionId, testcase.data, output)
    │   │   │   → Calls the evaluator dispatcher (see section 9)
    │   │   │   → Returns { score: 0.85, reasoning: "..." }
    │   │   │
    │   │   └─ Push to batch:
    │   │       {
    │   │         run_id: evaluationId,
    │   │         scenario_id: scenario.id,
    │   │         step_key: evalRevisionId,
    │   │         status: "success",
    │   │         testcase_id: testcase.id,
    │   │         trace_id: traceId,
    │   │         meta: { score: 0.85, reasoning: "..." }
    │   │       }
    │   │
    │   ├─ On evaluator error: push { status: "failure", error: { message: "..." } }
    │   │
    │   ├─ On invoke error: push { step_key: "invocation", status: "failure", error: { message } }
    │   │
    │   ├─ Flush batch when batch.length >= resultBatchSize (default: 10)
    │   │   → POST /preview/evaluations/results/ with { results: [...] }
    │   │
    │   └─ onProgress(i + 1, totalScenarios)
    │
    ├─ [5] Flush remaining results
    │
    └─ [6] ag.evaluations.closeRun(evaluationId, hasErrors ? "errors" : "success")
        → POST /preview/evaluations/runs/{id}/close/success
        → Sets flags.is_closed = true in Agenta
```

### Return value

```typescript
{
  evaluationId: string;     // UUID — same as run ID
  scenarioCount: number;    // == number of testcases
  resultCount: number;      // scenarios × evaluators (+ any failure results)
  hasErrors: boolean;       // true if any scenario/evaluator failed
  errors: Array<{           // detailed per-error breakdown
    scenarioIndex: number;
    step: string;           // "invocation" | evaluator revision ID
    error: string;          // error message
  }>;
}
```

---

## 6. Full Execution Flow (Step by Step)

Here is every step that happens when you run `pnpm run eval:onboarding`:

### Phase A: Initialization

| Step | Action | API Call | Result |
|------|--------|----------|--------|
| A1 | Load .env.local | — | AGENTA_API_KEY, ANTHROPIC_API_KEY loaded |
| A2 | Create Agenta SDK | — | `new Agenta()` with default config |
| A3 | Find rh-onboarding app | `POST /api/applications/query` via `findBySlug` | App object with ID |
| A4 | Get latest revision | SDK `retrieveBySlug("rh-onboarding")` | `appRevisionId` (UUID) |

### Phase B: Setup (idempotent)

| Step | Action | API Call | Result |
|------|--------|----------|--------|
| B1 | Find existing testset | `POST /preview/simple/testsets/query` via `findBySlug` | TestSet or null |
| B2a | Create testset (if new) | `POST /preview/simple/testsets/` | TestSet with `revision_id` |
| B2b | Update testset (if exists) | `PUT /preview/simple/testsets/{id}` | Updated TestSet with new `revision_id` |
| B3 | For each of 4 evaluators: find existing | `findBySlug` per evaluator | Evaluator or null |
| B4a | Create evaluator (if new) | `POST /api/workflows/` via `createEvaluator` | Workflow with `.id` = revision ID |
| B4b | Fetch latest revision (if exists) | `GET /api/workflows/{id}/latest` via `fetchLatest` | Workflow with `.id` = revision ID |

### Phase C: Evaluation lifecycle

| Step | Action | API Call | Result |
|------|--------|----------|--------|
| C1 | Create evaluation | `POST /preview/simple/evaluations/` | `{ evaluation: { id: UUID } }` |
| C2 | Start evaluation | `POST /preview/simple/evaluations/{id}/start` | Scenarios created in Agenta |
| C3 | Query scenarios | `POST /preview/evaluations/scenarios/query` | `{ scenarios: [{id}, ...] }` |
| C4 | Fetch testset | `GET /preview/simple/testsets/{revisionId}` | TestSet with inline testcases |

### Phase D: Execution (per scenario)

For each of the 6 scenarios (1:1 with test cases):

| Step | Action | Details |
|------|--------|---------|
| D1 | Play conversation turns | Calls `callAgent` once per turn with growing message history |
| D2 | Collect output | `{ messages, responses, tool_calls, persona, expected_tools_per_step, constraints, turn_count }` |
| D3 | Run tone-check | `callJudge` with tone evaluation prompt + input/output |
| D4 | Run structure-check | `callJudge` with structure evaluation prompt + input/output |
| D5 | Run tool-usage-check | `callJudge` with tool usage prompt + input/output |
| D6 | Run conversation-flow-check | `callJudge` with flow evaluation prompt + input/output |
| D7 | Batch results | Accumulate result entries (up to 10 per batch) |
| D8 | Flush batch | `POST /preview/evaluations/results/` with `{ results: [...] }` |

### Phase E: Cleanup

| Step | Action | API Call | Result |
|------|--------|----------|--------|
| E1 | Flush remaining results | `POST /preview/evaluations/results/` | Final batch posted |
| E2 | Close run | `POST /preview/evaluations/runs/{id}/close/success` (or `/close/errors`) | Run marked closed |
| E3 | Print summary | — | Console output with counts and errors |

### Total API calls for a full run (estimate)

- Application lookup: 1
- Revision lookup: 1
- Testset setup: 1-2 (query + create/update)
- Evaluator setup: 4-8 (findBySlug + create/fetchLatest per evaluator)
- Evaluation lifecycle: 4 (create + start + queryScenarios + getTestset)
- Result posting: ~3 batches (24 results / batch size 10 = 3 batches)
- Close: 1
- **Total: ~15-20 HTTP calls to Agenta**

Plus ~18 `callAgent` calls (agent invocations) and ~24 `callJudge` calls (6 scenarios × 4 evaluators).

---

## 7. Data Flow Diagrams

### High-level flow

```
pnpm run eval:onboarding
        │
        ▼
┌─ SCRIPT ──────────────────────────────────────────────────────┐
│                                                                │
│  ag.applications.findBySlug("rh-onboarding") ─── Agenta API   │
│  ag.revisions.retrieveBySlug("rh-onboarding") ── Agenta API   │
│                                                                │
│  runOnboardingEvaluation({                                     │
│    ag, appRevisionId,                                          │
│    callAgent ──────── lib/agent.ts (ToolLoopAgent)             │
│    callJudge ──────── AI SDK generateText (Sonnet)             │
│  })                                                            │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
┌─ HARNESS ─────────────────────────────────────────────────────┐
│                                                                │
│  setupOnboardingTestSet(ag)     ──── Agenta API (testsets)     │
│  setupOnboardingEvaluators(ag)  ──── Agenta API (workflows)    │
│                                                                │
│  invoke = createOnboardingInvoke(callAgent)                    │
│  evaluate = createOnboardingEvaluate(callJudge, revMap)        │
│                                                                │
│  runLocalEvaluation(ag, {                                      │
│    testsetRevisionId, appRevisionId,                           │
│    evaluatorRevisionIds: [uuid1, uuid2, uuid3, uuid4],         │
│    invoke, evaluate                                            │
│  })                                                            │
└───────────────────────────┬────────────────────────────────────┘
                            │
                            ▼
┌─ ORCHESTRATOR ────────────────────────────────────────────────┐
│                                                                │
│  Agenta: create eval ──┐                                       │
│  Agenta: start eval    │  ← Sets up the eval run in Agenta    │
│  Agenta: get scenarios │                                       │
│  Agenta: get testset  ─┘                                       │
│                                                                │
│  FOR EACH scenario:                                            │
│    invoke(testcase.data)                                       │
│      └─ calls callAgent × N turns                              │
│          └─ each turn creates ToolLoopAgent                    │
│              └─ agent may call tools (getUserContext, etc.)     │
│                                                                │
│    FOR EACH evaluator:                                         │
│      evaluate(revId, input, output)                            │
│        └─ resolves revId → slug via revisionIdToSlug map       │
│        └─ looks up EVALUATOR_CONFIGS[slug]                     │
│        └─ builds judge prompt from config + input + output     │
│        └─ calls callJudge(prompt)                              │
│            └─ AI SDK generateText → Sonnet                     │
│            └─ parses { score, reasoning } from JSON response   │
│                                                                │
│    Batch result → POST to Agenta                               │
│                                                                │
│  Close run → Agenta                                            │
└────────────────────────────────────────────────────────────────┘
```

### Data transformation chain

```
Test Case (static definition)
  { persona, turns: [{ user, step }], expected_tools_per_step, constraints }
     │
     ▼
Conversation Simulator (invoke)
  Plays out turns → collects messages + tool calls per step
     │
     ▼
Invoke Output (passed to evaluators)
  {
    messages: [{ role, content }, ...],       ← full conversation transcript
    responses: [{ step, content }, ...],      ← per-step agent responses
    tool_calls: [{ step, name, args }, ...],  ← per-step tool invocations
    persona: "casual coffee roaster",         ← from test case
    expected_tools_per_step: { 1: [...] },    ← from test case
    constraints: ["max_2_sentences", ...],    ← from test case
    turn_count: 3,
    completed: true
  }
     │
     ├──▶ tone-check evaluator       → { score: 0.85, reasoning: "..." }
     ├──▶ structure-check evaluator   → { score: 1.0,  reasoning: "..." }
     ├──▶ tool-usage-check evaluator  → { score: 0.5,  reasoning: "..." }
     └──▶ conversation-flow evaluator → { score: 0.9,  reasoning: "..." }
              │
              ▼
         Posted to Agenta as results with meta: { score, reasoning }
```

---

## 8. Test Cases

6 test cases in `ONBOARDING_TEST_CASES`, covering:

### Happy paths (2)

**shopify-happy-path** — Standard 3-step flow
- Turn 1: "hi" → expects getUserContext, asks for store URL
- Turn 2: "thebarn.com" → expects detectStore + savePreference
- Turn 3: "specialty coffee beans..." → expects a specific next action suggestion
- Persona: casual coffee roaster, non-technical
- Constraints: max 2 sentences, no structured data, no menus, no filler, casual tone

**woocommerce-happy-path** — Same flow, different platform
- Persona: organized small business owner, slightly technical
- Tests that the agent adapts detection to WooCommerce vs Shopify

### Edge cases (2)

**url-first-message** — User skips greeting, gives URL immediately
- Only 2 turns (step 1 and step 3, step 2 skipped)
- Expects agent to detect URL in first message and adapt
- Step 1 should call getUserContext + detectStore + savePreference all at once
- Constraint: `adapts_to_skipped_step`

**vague-greeting** — User asks "hey, what can you do?"
- 3 turns but first turn is off-script
- Expects agent NOT to list capabilities
- Should steer conversation toward store URL
- Constraint: `no_capability_listing`, `steers_to_store_url`

### Anti-pattern checks (2)

**feature-list-trap** — Single turn: "what can you help me with?"
- Tests that agent doesn't respond with a menu of features
- Constraints: `no_capability_listing`, `no_menu_of_options`

**no-data-dump** — 2 turns, checks agent doesn't output structured detection data
- After URL detection, agent should NOT say "Platform: Shopify, Currency: EUR, ..."
- Constraint: `no_structured_data_listing`, `casual_reaction_to_detection`

---

## 9. Evaluators

4 LLM-as-a-Judge evaluators, each checking one constraint dimension:

### Evaluator setup in Agenta

Each evaluator is created as a Workflow entity using workflow catalog template key `auto_ai_critique` (`catalogTemplateKey`) plus URI/parameter overrides. The configuration includes:

- **System prompt**: The evaluation criteria (from `EVALUATOR_CONFIGS[slug].prompt`)
- **User prompt template**: `"Input: {{input}}\n\nAssistant Response: {{output}}\n\nProvide your evaluation as JSON: { \"score\": <0-1>, \"reasoning\": \"...\" }"`
- **LLM config**: `model: "anthropic/claude-sonnet-4-20250514"`, `temperature: 0`, `max_tokens: 500`

Agenta slugs follow the pattern `rh-onboarding-{slug}`:
- `rh-onboarding-tone-check`
- `rh-onboarding-structure-check`
- `rh-onboarding-tool-usage-check`
- `rh-onboarding-conversation-flow-check`

### Evaluator dispatch (the revisionIdToSlug fix)

The orchestrator passes evaluator **revision IDs** (UUIDs) as `stepKey` to the evaluate function. But `EVALUATOR_CONFIGS` is keyed by **slug** (e.g., "tone-check"). The `revisionIdToSlug` map bridges this gap:

```
runLocalEvaluation calls evaluate(stepKey="uuid-abc-123", input, output)
    │
    └─ createOnboardingEvaluate resolves:
         slug = revisionIdToSlug["uuid-abc-123"] → "tone-check"
         config = EVALUATOR_CONFIGS["tone-check"]
         → builds prompt from config.prompt + input + output
         → calls callJudge(prompt)
```

Without this map, all evaluators would hit the unknown fallback (score: 0, "Unknown evaluator slug").

### Individual evaluator details

**tone-check** — Warm, casual language
- Checks: contractions, natural reactions, max 2 sentences, no filler
- Score 1.0: all criteria met
- Score 0.5: one minor violation
- Score 0.0: robotic tone, verbose, or contains filler phrases

**structure-check** — Clean response structure
- Checks: one question at a time, stops after asking, no menus/lists/data dumps
- Score 1.0: asks one thing and stops
- Score 0.5: mostly good, minor structural issue
- Score 0.0: lists features, dumps data, continues after question

**tool-usage-check** — Correct tool invocation
- Checks: getUserContext at step 1, detectStore + savePreference at step 2
- Receives `expected_tools_per_step` AND actual `tool_calls` in the output
- Score 1.0: all expected tools called
- Score 0.5: most tools called, one missing
- Score 0.0: critical tools missed

**conversation-flow-check** — Natural 3-step progression
- Checks: natural step progression, adapts to out-of-order info, no re-asking, detects platform from URL
- Score 1.0: natural flow following expected progression
- Score 0.5: mostly correct, minor issue
- Score 0.0: broken, repetitive, or asks for what it should detect

---

## 10. Conversation Simulator

`createOnboardingInvoke(callAgent)` returns an async function that simulates multi-turn conversations.

### For each test case:

```
Input: testcase.data = {
  persona: "casual coffee roaster",
  turns: [
    { user: "hi", step: 1 },
    { user: "thebarn.com", step: 2 },
    { user: "specialty coffee beans...", step: 3 },
  ],
  expected_tools_per_step: { 1: ["getUserContext"], 2: ["detectStore", "savePreference"], 3: [] },
  constraints: ["max_2_sentences", "casual_tone", ...]
}

Execution:

Turn 1:
  messages = [{ role: "user", content: "hi" }]
  response = await callAgent(messages)
  messages = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "What's the link to your store?" }
  ]
  toolCalls = [{ step: 1, name: "getUserContext", args: {...} }]

Turn 2:
  messages = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "What's the link to your store?" },
    { role: "user", content: "thebarn.com" }
  ]
  response = await callAgent(messages)  // gets full 3-message history
  messages = [... + { role: "assistant", content: "Nice, Shopify store! What do you sell?" }]
  toolCalls = [
    { step: 1, name: "getUserContext", args: {...} },
    { step: 2, name: "detectStore", args: {...} },
    { step: 2, name: "savePreference", args: {...} }
  ]

Turn 3:
  messages = [... all 5 messages ...]
  response = await callAgent(messages)  // gets full 5-message history
  → final conversation complete

Output:
{
  messages: [all 6 messages],
  responses: [{ step: 1, content: "..." }, { step: 2, content: "..." }, { step: 3, content: "..." }],
  tool_calls: [{ step: 1, name: "getUserContext" }, { step: 2, name: "detectStore" }, ...],
  persona: "casual coffee roaster",
  expected_tools_per_step: { 1: ["getUserContext"], ... },
  constraints: ["max_2_sentences", ...],
  turn_count: 3,
  completed: true
}
```

This entire output object is what each evaluator receives as `output` for scoring.

---

## 11. Agent Wiring

The agent being evaluated is the REAL `ToolLoopAgent` from `lib/agent.ts`:

```
createAgent(userId, sessionId)
  │
  ├─ composeInstructions()         ← fetches ALL prompt modules from Agenta
  │   → rh-voice, rh-principles, rh-ux-rules, rh-user-context,
  │     rh-onboarding, rh-capabilities, rh-workflow
  │   → 60-second cache in lib/agenta.ts
  │
  ├─ fetchToolSchemas()            ← fetches tool schemas from Agenta (optional overrides)
  │
  ├─ getModel()                    ← model from lib/model.ts
  │
  ├─ getMCPTools()                 ← MCP tool connections
  │
  ├─ Merges all tools:
  │   → file-ops, http-request, web-search, code-gen
  │   → operations (csv, email, data-sync)
  │   → finance (billing, invoice, commission)
  │   → audit-log, request-form
  │   → skills (list, get, create, delete)
  │   → integrations (OAuth-connected services)
  │   → user-context tools (getUserContext, savePreference, etc.)
  │   → knowledge tools (RAG)
  │   → detectStore
  │
  └─ Returns ToolLoopAgent instance
```

The eval user ID is `"eval-user-onboarding"` — a synthetic user. Any user-context tools will create/read context for this eval user.

---

## 12. Judge Wiring

The judge is a separate, stronger LLM call — NOT the same agent being evaluated:

```
Agent being evaluated:
  → ToolLoopAgent with all tools, system prompt from Agenta
  → Model from lib/model.ts (could be any model configured for the app)

Judge:
  → Raw generateText call via AI SDK
  → Model: claude-sonnet-4-20250514 (or gpt-4o as fallback)
  → Single-turn, no tools, temperature: 0
  → Receives: evaluation criteria prompt + input/output to score
  → Returns: { score: 0-1, reasoning: string }
```

The judge and agent use different models and different providers. The judge is intentionally a stronger model to ensure evaluation quality.

---

## 13. Agenta API Calls (Exact Endpoints)

### Setup phase

| SDK Method | HTTP Method | Endpoint | Request Body |
|-----------|-------------|----------|-------------|
| `ag.applications.findBySlug("rh-onboarding")` | POST | `/api/applications/query` | `{}` + filter client-side |
| `ag.revisions.retrieveBySlug("rh-onboarding")` | GET | `/api/applications/revisions/{slug}` | — |
| `ag.testsets.findBySlug("rh-onboarding-tests")` | POST | `/preview/simple/testsets/query` | `{}` + filter client-side |
| `ag.testsets.create(...)` | POST | `/preview/simple/testsets/` | `{ testset: { slug, name, description, data: { testcases } } }` |
| `ag.testsets.update(id, ...)` | PUT | `/preview/simple/testsets/{id}` | `{ testset: { id, data: { testcases } } }` |
| `ag.evaluators.findBySlug(slug)` | POST | `/preview/simple/evaluators/query` | `{}` + filter client-side |
| `ag.workflows.createEvaluator(...)` | POST | `/preview/workflows/` + follow-up `/preview/workflows/variants/` + `/preview/workflows/revisions/commit` | Workflow seeded from catalog template key `auto_ai_critique` + URI/data overrides |
| `ag.workflows.fetchLatest(id)` | POST | `/preview/workflows/revisions/query` | `workflow_ids=[id]`, `limit=1`, `order=descending` |

### Evaluation lifecycle

| SDK Method | HTTP Method | Endpoint | Request Body |
|-----------|-------------|----------|-------------|
| `ag.evaluations.createSimple(...)` | POST | `/preview/simple/evaluations/` | `{ evaluation: { name, data: { status: "running", steps... }, flags } }` |
| `ag.evaluations.startSimple(id)` | POST | `/preview/simple/evaluations/{id}/start` | `{}` |
| `ag.evaluations.queryScenarios(...)` | POST | `/preview/evaluations/scenarios/query` | `{ scenario: { run_ids: [id] } }` |
| `ag.testsets.get(revisionId)` | GET | `/preview/simple/testsets/{revisionId}` | — |
| `ag.evaluations.postResults(batch)` | POST | `/preview/evaluations/results/` | `{ results: [{ run_id, scenario_id, step_key, status, meta, ... }] }` |
| `ag.evaluations.closeRun(id, status)` | POST | `/preview/evaluations/runs/{id}/close/{status}` | — (no body) |

### Key API facts

- All step references (`testset_steps`, `application_steps`, `evaluator_steps`) use **revision IDs**, not entity IDs
- `testset.revision_id` comes from the Simple API response (create/update/get)
- Evaluator revision ID comes from `workflows.createEvaluator().id` or `workflows.fetchLatest().id`
- Evaluation ID == Run ID — same UUID, no separate lookup needed
- Results use `meta` field (not `data`) for score/reasoning — this is from the `Metadata` base class
- Results are batched as an array: `{ results: [...] }` not singular
- Close endpoint takes status in the URL path: `/close/success` or `/close/errors`

---

## 14. Error Handling

### Invocation failure (agent throws)

```
try {
  const { output } = await invoke(testcase.data);
} catch (invokeErr) {
  // Post a failure result for the "invocation" step
  batch.push({
    run_id: evaluationId,
    scenario_id: scenario.id,
    step_key: "invocation",
    status: "failure",
    error: { message: errMsg },  // Dict, not string
  });
  // Skip evaluators for this scenario, continue to next
}
```

### Evaluator failure (judge throws or returns garbage)

```
try {
  const evalResult = await evaluate(revId, input, output);
  batch.push({ status: "success", meta: { score, reasoning } });
} catch (evalErr) {
  batch.push({
    status: "failure",
    step_key: evalRevId,
    error: { message: errMsg },
  });
  // Continue to next evaluator
}
```

### Unknown evaluator (slug lookup fails)

Returns `{ score: 0, reasoning: "Unknown evaluator slug: ..." }` — explicit failure, no silent pass.

### Judge parse failure

Returns `{ score: 0.5, reasoning: "Unparseable judge response: ..." }` — graceful degradation.

### Run closure

- All scenarios pass → `POST .../close/success`
- Any scenario has a failure → `POST .../close/errors`
- Agenta UI handles "errors" status gracefully — shows which scenarios failed vs succeeded

### Scenario/testcase mismatch

If `scenarios.length > testcases.length`, the orchestrator logs an error for the unmatched scenario and continues. The error is recorded in the return value.

---

## 15. Where Results End Up

### Agenta UI

After the run completes, everything is visible in Agenta's evaluation interface:

- **Evaluation run** — named "Onboarding Baseline — 2026-03-27", status: success/errors
- **Scenarios** — one per test case (6 total), each showing pass/fail
- **Results** — 4 per scenario (one per evaluator), each with:
  - `meta.score` (0-1)
  - `meta.reasoning` (judge's explanation)
  - `status` (success/failure)
  - `trace_id` (if tracing is enabled, links to the agent's execution trace)
- **Aggregations** — Agenta computes per-evaluator averages across scenarios

### Console output

```
=== Onboarding Evaluation Runner ===

Looking up rh-onboarding app in Agenta...
  Found rh-onboarding revision: abc12345...

  Creating/updating test set...
     Test set ready (revision: def67890...)

  Creating/updating evaluators...
     4 evaluators ready

  Running local evaluation...
     [1/6] scenarios complete
     [2/6] scenarios complete
     [3/6] scenarios complete
     [4/6] scenarios complete
     [5/6] scenarios complete
     [6/6] scenarios complete

──────────────────────────────────────────────────
 Evaluation complete: uuid-of-eval
   Scenarios: 6
   Results:   24
   Errors:    none
──────────────────────────────────────────────────

View results in Agenta UI → Evaluations
Evaluation ID: uuid-of-eval
```

---

## 16. Phase 4: What Comes Next

Once the baseline is run and scored, the next phases are:

### Variant generation

An LLM analyzes the baseline scores and rewrites the rh-onboarding prompt targeting weak dimensions:
- Low tone-check score → adjust voice instructions
- Low structure-check score → add stricter "stop after one question" rules
- Low tool-usage score → make tool invocation triggers more explicit

### Comparison

Run the same testset + evaluators against the variant prompt. Compare scores side-by-side. Agenta's UI supports multi-run comparison.

### Deploy winner

Use the Environments API to promote the winning revision to production:
```
POST /preview/environments/revisions/commit
```

### Continuous monitoring (online evaluation)

Once deployed, enable online evaluation on live traces. New real conversations are scored by the same evaluators. Regressions trigger a new optimization cycle.

### Test set enrichment

As real traces accumulate, convert high-value traces into test cases:
```typescript
ag.testsets.createFromTraces({
  slug: "rh-onboarding-real-world",
  name: "Real Onboarding Conversations",
  traceIds: [...],
  extractFields: (attrs) => ({ user_message: attrs.input, ... }),
});
```

This closes the loop: synthetic test cases for cold start → real trace-based test cases for ongoing optimization.

---

## Appendix: Prerequisites

To run the evaluation:

1. **Agenta running locally** with seeded prompts (`pnpm run seed:agenta`)
2. **`.env.local`** with:
   - `AGENTA_API_KEY` — Agenta auth key
   - `ANTHROPIC_API_KEY` — for the judge model (preferred)
   - Or `OPENAI_API_KEY` — fallback judge model
3. **All SDK classes implemented** — TestSets, Evaluations, Workflows, Evaluators
4. **Agent functional** — `createAgent()` in `lib/agent.ts` works with current prompts

Run: `pnpm run eval:onboarding`
