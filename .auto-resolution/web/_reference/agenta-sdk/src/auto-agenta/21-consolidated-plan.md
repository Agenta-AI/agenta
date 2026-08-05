# Auto-Agenta: Consolidated Plan

> Merging all decisions from docs 01–20 into one actionable plan.
> This is the single source of truth for what we're building.

---

## What Is Auto-Agenta?

A trace-triggered prompt optimization system. A developer sees a bad AI response in their app, hovers it, clicks "Optimize", and the system:
1. Gathers context from the trace
2. Finds similar traces
3. Builds a test set
4. Creates/selects evaluators
5. Scores the current prompt
6. Generates a variant
7. Scores the variant
8. Presents results with a deploy option

**First user**: the my-agent project (dogfood). **End goal**: a feature in the Agenta TypeScript SDK that any consumer can use.

---

## Architecture

```
┌─ Consumer App (my-agent) ─────────────────────────────┐
│                                                        │
│  Chat UI                                               │
│  ├── <Message>                                         │
│  │   └── <TraceActions traceId={id} />  ← entry point │
│  │       ├── [Annotate] → Popover with AnnotationPanel │
│  │       └── [Optimize] → Sheet with OptimizationFlow  │
│  │                                                     │
│  └── <AgentaProvider host={...} apiKey={...}>          │
│       (context for all agenta-sdk/react components)    │
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         │
                         │ uses
                         ▼
┌─ agenta-sdk ──────────────────────────────────────────┐
│                                                        │
│  agenta-sdk/client     (API client)                    │
│  ├── AgentaClient                                      │
│  ├── Applications                                      │
│  ├── Revisions                                         │
│  ├── Evaluations       (+ postResults, close)          │
│  ├── Evaluators        (+ listTemplates, getTemplate)  │
│  ├── TestSets          (new — CRUD + query)            │
│  ├── Annotations       (new — CRUD + query by trace)   │
│  ├── Tracing           (existing + query by app ref)   │
│  └── Workflows         (existing)                      │
│                                                        │
│  agenta-sdk/react      (UI components — dogfood first) │
│  ├── <AgentaProvider>                                  │
│  ├── <TraceActions>                                    │
│  ├── <AnnotationPanel>   (popover)                     │
│  ├── <OptimizationFlow>  (sheet, wizard state machine) │
│  │   ├── Step: GatherContext                           │
│  │   ├── Step: TraceBrowser (select test cases)        │
│  │   ├── Step: ScopeSelector (define evaluators)       │
│  │   ├── Step: Runner (baseline → variant → compare)   │
│  │   └── Step: Results (diff + deploy/iterate/discard) │
│  ├── <PromptDiff>                                      │
│  └── Hooks:                                            │
│      ├── useAnnotation                                 │
│      ├── useTraceContext                               │
│      ├── useSimilarTraces                              │
│      └── useOptimization                               │
│                                                        │
│  agenta-sdk/auto-agenta (orchestration)                │
│  ├── runLocalEvaluation()                              │
│  ├── Prompt analyzer (LLM → extract rules)             │
│  ├── Test case generator (LLM → produce cases)         │
│  ├── Evaluator configurator (rules → judge prompts)    │
│  └── Scope suggestion engine (trace + annotation →     │
│      optimization dimensions)                          │
│                                                        │
└────────────────────────┬───────────────────────────────┘
                         │
                         │ API calls
                         ▼
┌─ Agenta Backend ──────────────────────────────────────┐
│  /preview/simple/testsets/*     (CRUD)                 │
│  /preview/simple/evaluations/*  (create, start, close) │
│  /preview/evaluations/results/* (post results)         │
│  /preview/evaluators/catalog/*  (templates, presets)   │
│  /annotations/*                 (CRUD)                 │
│  /observability/v1/traces/*     (query by app ref)     │
│  /applications/*                (revisions, deploy)    │
└────────────────────────────────────────────────────────┘
```

---

## Decided Design Choices

| Decision | Choice | Source |
|----------|--------|--------|
| Styling | Radix + Tailwind, shadcn-style (ejectable later) | Doc 20 Q1 |
| Multi-step state | Wizard state machine inside `<OptimizationFlow>` | Doc 20 Q2 |
| Optimization panel | Sheet from the right (~40-50% viewport) | Doc 20 Q3 |
| Annotation panel | Popover anchored to trace action button | Doc 20 Q3 |
| Real-time updates | `onProgress` callback for local execution, exponential backoff polling for remote | Doc 20 Q4 |
| Design alignment | Mirror Agenta's patterns conceptually (EnhancedModal, SectionCard, StatusTag) but use Radix, not Ant Design | Doc 20 Q5 |
| Multi-turn evaluation | Local execution (`data.status = "running"`), SDK runs conversation simulator | Docs 12-15 |
| Evaluator pattern | One evaluator per dimension, not compound | Doc 10 Q3 |
| Test case creation | From traces (primary), from synthetic generation (secondary) | Doc 17 |
| Result posting | Batched array `{ results: [...] }`, not singular | Doc 12 |
| Eval ID = Run ID | Same UUID, no extra query | Doc 14 Q1 |
| Testset reference | Revision ID, not testset ID | Doc 14 Q2 |
| Partial failure | Per-result `status: "failure"`, run closes with `"errors"` | Doc 14 Q4 |

---

## Optimization Flow State Machine

```
idle
  → gathering_context      (fetch seed trace, app ref, revision)
  → building_testset       (find similar traces, user selects, create testset)
  → selecting_scope        (suggest dimensions, user confirms, create/select evaluators)
  → scoring_baseline       (run local eval against current revision)
  → generating_variant     (LLM rewrites prompt targeting weak scores)
  → scoring_variant        (run local eval against variant revision)
  → comparing              (compute diffs, prepare results view)
  → complete               (show results: deploy / iterate / discard)

Transitions:
  - User can cancel at any step → idle
  - "Iterate" from complete → generating_variant (keep testset + evaluators)
  - "Deploy" from complete → calls environments.deploy() → idle
  - "Discard" from complete → idle
```

---

## Implementation Phases

### Phase 1: SDK Primitives (agenta agent)

**New SDK classes:**
- `TestSets` — CRUD + query (endpoints confirmed in doc 10)
- `Annotations` — CRUD + query by trace ID (endpoints confirmed in doc 18)
- `Evaluators.listTemplates()` / `getTemplate()` / `listPresets()` (endpoints confirmed in doc 10)

**Extensions to existing:**
- `Evaluations.postResults()` — batch post
- `Evaluations.close()` — success/errors
- `Tracing.queryByApp()` — filter by `ag.refs.application.id` attribute

### Phase 2: Orchestration (my-agent agent)

**Files:**
- `run-local-evaluation.ts` — generic orchestrator (done, reviewed in docs 12-15)
- `onboarding-eval-harness.ts` — rh-onboarding specific harness (done, reviewed)
- `run-onboarding-eval.ts` — CLI entry point wiring (done, reviewed)

**New orchestration modules:**
- Prompt analyzer — LLM call: prompt text → extracted rules, steps, tools
- Test case generator — LLM call: analysis → test cases
- Evaluator configurator — maps rules → judge prompts using Agenta templates
- Scope suggestion engine — trace + annotation → optimization dimensions
- Variant generator — LLM call: prompt + weak scores → improved prompt variant

### Phase 3: UI Components (my-agent first, SDK extract later)

**Build in `my-agent/components/agenta/`:**
1. `AgentaProvider` — context with API client
2. `TraceActions` — hover overlay, entry point
3. `AnnotationPanel` — popover (score + label + comment)
4. `OptimizationFlow` — sheet with wizard state machine
5. `PromptDiff` — client-side revision comparison

**Hooks in `my-agent/hooks/`:**
1. `useAnnotation`
2. `useTraceContext`
3. `useSimilarTraces`
4. `useOptimization`

### Phase 4: Wire-up + Dogfood

1. Add `<TraceActions>` to our chat message component
2. Ensure our tracing sets `ag.refs.application.id` and `ag.refs.application_revision.id`
3. Run full flow: spot bad response → annotate → optimize → deploy variant
4. Track meta-observations in `dogfood-findings.md`

### Phase 5: Extract to SDK (post-dogfood)

1. Move validated components to `agenta-sdk/react/`
2. Set up package exports (`agenta-sdk`, `agenta-sdk/react`, `agenta-sdk/auto-agenta`)
3. Add ejectable CLI (`npx agenta-sdk init`)
4. Document consumer integration

---

## Critical Prerequisites

Before any of this works:

1. **Traces must include app references** — `ag.refs.application.id` and `ag.refs.application_revision.id` must be set in span attributes. Check `lib/agenta.ts` / `lib/telemetry.ts` in my-agent.

2. **Agenta seeded with our prompts** — ✅ Done (user confirmed).

3. **Annotation API accessible** — The SDK needs `Annotations` class. Agenta agent confirmed the endpoints exist at `/annotations/*`.

4. **Judge model available** — The variant generation and LLM-as-a-Judge steps need a strong model. Currently using Anthropic Sonnet via AI SDK provider. Ensure the API key / gateway is configured.

---

## Open Items

- [ ] Verify `lib/agenta.ts` sets trace references (`ag.refs.application.id` etc.)
- [ ] Agenta agent: implement `TestSets`, `Annotations`, evaluator template methods in SDK
- [ ] My-agent agent: build Phase 3 UI components
- [ ] Both: wire-up and run first dogfood loop
- [ ] Capture dogfood findings for product feedback
