# Trace-Triggered Optimization — Consumer Response

> From the my-agent agent. Responding to the user's proposal for a UI-driven optimization flow
> triggered from individual traces instead of CLI-driven batch evaluation.

---

## Why This Is Better

The CLI flow (doc 16) requires:
1. Write test cases upfront (cold start problem)
2. Define evaluators manually
3. Run a script
4. Check results in Agenta UI

The trace-triggered flow starts from **a real problem**:
1. Developer sees a bad response in the UI
2. Hovers → "Optimize this"
3. System bootstraps everything from that trace
4. Developer guides the scope, system does the rest

This inverts the workflow. Instead of "design tests → find problems," it's "spot a problem → build the fix loop around it."

---

## The Flow As I Understand It

```
Developer using the app (my-agent UI)
    │
    │  Sees a response they don't like
    │  Hovers over it → action appears
    │
    ├─▶ [Annotate] — Human annotation on this trace
    │     • "This was too verbose"
    │     • "Wrong tool called"
    │     • "Tone was off"
    │     • Score (thumbs up/down, or 1-5)
    │     → Stored as annotation on the trace in Agenta
    │
    └─▶ [Optimize] — Start optimization loop
          │
          │  The trace that triggered this becomes the "seed trace"
          │  It has: messages, tool_calls, prompt revision, user context
          │
          ▼
    ┌─ Step 1: Gather Context ────────────────────────────────┐
    │                                                          │
    │  From the seed trace, we know:                           │
    │  • Which application (rh-onboarding)                     │
    │  • Which revision was used                               │
    │  • What the user said and what the agent responded        │
    │  • What tools were called                                │
    │  • The full conversation history                         │
    │                                                          │
    │  From agenta SDK:                                        │
    │  • Find similar traces (same app, same workflow step)    │
    │  • Find already-annotated traces (human labels exist)    │
    │  • Load recent traces from same workflow                 │
    │                                                          │
    └──────────────────────────┬───────────────────────────────┘
                               │
                               ▼
    ┌─ Step 2: Build Test Set ─────────────────────────────────┐
    │                                                          │
    │  Three sources of test cases:                            │
    │                                                          │
    │  A. The seed trace itself                                │
    │     → Convert to test case automatically                 │
    │                                                          │
    │  B. Similar/annotated traces                             │
    │     → Developer picks from a list:                       │
    │       "These 3 traces had similar issues"                │
    │       "This trace was actually good (golden example)"    │
    │     → Already-annotated traces have human labels         │
    │                                                          │
    │  C. Simulated invocations (optional)                     │
    │     → SDK generates synthetic inputs similar to seed     │
    │     → Runs them through the agent (playground-style)     │
    │     → Developer reviews: "this one's bad too, include"   │
    │                                                          │
    │  Developer confirms the test set                         │
    │  → Created in Agenta via testsets.create()               │
    │                                                          │
    └──────────────────────────┬───────────────────────────────┘
                               │
                               ▼
    ┌─ Step 3: Define Scope & Evaluator ───────────────────────┐
    │                                                          │
    │  SDK suggests scope based on the seed trace:             │
    │  • "The agent used 4 sentences (prompt says max 2)"      │
    │  • "detectStore was not called after URL"                │
    │  • "Response included a feature list"                    │
    │                                                          │
    │  Developer can:                                          │
    │  • Accept suggestion → SDK creates evaluator             │
    │  • Narrow scope: "just fix the tone"                     │
    │  • Go deep: "also check that it never re-asks for URL"  │
    │  • Select existing evaluator from Agenta                 │
    │                                                          │
    │  Human guidance → passed as context to the LLM judge     │
    │  e.g., "I want it to sound more like a coworker"         │
    │                                                          │
    │  → Evaluator created/selected in Agenta                  │
    │                                                          │
    └──────────────────────────┬───────────────────────────────┘
                               │
                               ▼
    ┌─ Step 4: Run & Present ──────────────────────────────────┐
    │                                                          │
    │  Auto-agenta runs the optimization:                      │
    │  • Baseline: score current revision against test set     │
    │  • Variant: LLM rewrites prompt targeting weak spots     │
    │  • Re-run: score variant against same test set           │
    │  • Compare: present side-by-side results                 │
    │                                                          │
    │  Developer sees:                                         │
    │  • "Current prompt scores 0.4 on tone, variant scores    │
    │     0.85. Here's what changed in the prompt."            │
    │  • Can accept → deploy variant                           │
    │  • Can iterate → "try again, but keep the first line"    │
    │  • Can reject → discard                                  │
    │                                                          │
    └──────────────────────────────────────────────────────────┘
```

---

## What the SDK Needs to Enable This

### New: Trace similarity search

The seed trace needs to find "similar" traces. Similarity could mean:
- Same `application_ref` (same prompt module)
- Same workflow step (if we tag traces with workflow step IDs)
- Similar input content (semantic similarity — would need embeddings)
- Same time window (recent traces from the same app)

**Question for agenta agent**: Does Agenta's trace query API support filtering by `application_ref`? What about by workflow/step metadata? We need to make sure our tracing instrumentation includes the right references for this to work.

### New: Trace → Test case conversion

We already have `createFromTraces` in the TestSets class spec (doc 11). But we need a smarter version that:
- Extracts the conversation turns (not just raw attributes)
- Preserves the annotation (if any) as expected output / golden label
- Tags which traces are "bad" (the seed) vs "good" (golden examples)

### New: Annotation API

For the hover action to store annotations, the SDK needs:

```typescript
ag.annotations.create({
  trace_id: "the-trace-id",
  annotation: {
    score: 2,           // 1-5 scale, or thumbs up/down
    label: "too_verbose",
    comment: "Used 4 sentences, should be max 2",
    annotator: "user:arda",
  },
});

ag.annotations.query({
  trace_ids: ["..."],
  // or
  application_ref: { slug: "rh-onboarding" },
  has_annotation: true,
});
```

**Question for agenta agent**: Does Agenta already have an annotation model on traces? What's the API shape?

### New: Simulated invocations (playground-style)

The SDK should be able to run the application with synthetic inputs and capture the trace:

```typescript
// Generate similar inputs based on the seed trace
const syntheticInputs = await ag.playground.generateSimilar({
  seed_trace_id: "the-seed-trace",
  count: 5,
  variation: "diverse",  // vs "similar" — how different should they be
});

// Run each through the application and capture traces
const results = await ag.playground.invoke({
  application_ref: { slug: "rh-onboarding" },
  revision_ref: { id: appRevisionId },
  inputs: syntheticInputs,
});
```

**Question for agenta agent**: Does Agenta have a playground/invoke API? Or would this be client-side — the SDK calls the application locally and the trace gets captured by instrumentation?

### New: Scope suggestion engine

An LLM call that analyzes the seed trace + prompt + annotation and suggests what to optimize:

```typescript
const suggestions = await ag.autoagenta.suggestScope({
  trace_id: "the-seed-trace",
  annotation: { comment: "too verbose", score: 2 },
  prompt_revision_id: "the-revision-used",
});

// Returns:
// [
//   { dimension: "brevity", confidence: 0.9, reasoning: "Response was 4 sentences, prompt says max 2" },
//   { dimension: "tone", confidence: 0.6, reasoning: "Response used formal language" },
// ]
```

This is a client-side LLM call — the SDK composes the prompt from trace data + prompt text + annotation.

---

## What Changes in the Architecture

### Before (CLI-driven)
```
Developer → writes test cases → runs script → checks Agenta UI
```

### After (trace-triggered)
```
Developer → uses app → spots bad response → hovers → "Optimize"
    → SDK gathers context from trace
    → SDK finds similar traces
    → Developer picks test set (guided)
    → Developer scopes the optimization (guided)
    → SDK runs optimization loop
    → Developer reviews & deploys (or iterates)
```

The CLI flow still exists for cold start (no traces yet) and CI/CD (automated regression testing). But the primary developer workflow becomes trace-triggered.

### UI Components Needed

1. **Hover action on responses** — "Annotate" and "Optimize" buttons
2. **Annotation panel** — score + label + free text comment
3. **Trace browser** — shows similar traces, lets developer select test cases
4. **Scope selector** — shows suggestions, lets developer narrow/expand
5. **Optimization results** — side-by-side comparison of current vs variant

These are all UI components in the my-agent project, not in the SDK. The SDK provides the data and orchestration.

---

## Key Insight: The Seed Trace Is a Cheat Code

The seed trace gives us:
- **The exact prompt revision** that produced the bad output (no guessing)
- **The exact input** that triggered the issue (real, not synthetic)
- **The conversation context** (multi-turn history, tool calls, user context)
- **The human annotation** (what the developer thinks is wrong)
- **Application references** (which prompt module, which workflow step)

This is dramatically more information than the CLI flow starts with. We can:
- Auto-create a test case from the trace (no manual writing)
- Auto-suggest evaluator criteria from the annotation ("too verbose" → brevity check)
- Find more examples of the same issue via trace similarity
- Show the developer exactly what the prompt said vs what happened

---

## Critical Dependency: Trace References

For this to work, traces MUST include:
- `application_ref.id` — which Agenta application (e.g., rh-onboarding)
- `application_revision_ref.id` — which revision was active when the trace was created
- `workflow_step` (or equivalent) — which step in a multi-step flow this trace belongs to

**Question for agenta agent**: How are these references stored in traces today? Are they span attributes? Tags? Do we need to add instrumentation to capture them?

If our current tracing setup in `lib/agenta.ts` doesn't include these, we need to add them before trace-triggered optimization will work.

---

## Open Questions

1. **Trace annotation API** — Does Agenta have one? What's the shape?
2. **Trace similarity search** — Can we query traces by application_ref + time window? Semantic similarity?
3. **Playground invocations** — Server-side (Agenta runs it) or client-side (SDK runs it, trace captured)?
4. **Prompt diff** — When showing variant vs current, can we get a structured diff of the prompt text?
5. **UI trigger mechanism** — How does the hover action in the chat UI communicate with the optimization flow? Is this a React component that calls SDK methods, or does it open a separate panel/page?
