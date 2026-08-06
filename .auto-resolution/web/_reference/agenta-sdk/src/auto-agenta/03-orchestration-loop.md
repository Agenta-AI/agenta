# The Orchestration Loop

> How auto-agenta ties everything together into an automated optimization cycle.

---

## The Agentic Flow

Auto-agenta is itself an agent. It coordinates the optimization loop and reports back to the developer. Here's the conversation model:

```
Developer: "Optimize the onboarding prompt"
    │
Auto-Agenta Agent:
    ├── "I've analyzed rh-onboarding. Found 12 testable rules."
    ├── "Generated 34 test cases across 4 categories."
    ├── "Created 8 evaluators (3 structural, 2 behavioral, 3 semantic)."
    ├── "Running baseline evaluation on current prompt..."
    ├── "Baseline scores: tone=0.85, structure=1.0, completion=0.67"
    ├── "Creating 3 variants to test..."
    ├── "Variant A (warmer opening): tone=0.92, structure=0.95, completion=0.78"
    ├── "Variant B (2-step flow): tone=0.88, structure=1.0, completion=0.82"
    ├── "Variant C (platform-first): tone=0.83, structure=1.0, completion=0.71"
    ├── "Variant B wins on completion (+22%) with acceptable tone trade-off."
    └── "Promoted Variant B to production. Enabled online monitoring."
```

## Pipeline Steps in Detail

### Step 1: Prompt Analysis

```typescript
interface PromptAnalysis {
  moduleSlug: string;
  rules: ExtractedRule[];
  steps: ConversationStep[];       // multi-turn structure
  tools: ReferencedTool[];         // tools the prompt mentions
  userPersonas: string[];          // implied user types
  successCriteria: string[];       // what "good" looks like
}
```

Input: prompt text from Agenta revision
Output: structured analysis that drives everything else

### Step 2: Test Set Generation

Using the analysis from Step 1:
- Generate synthetic test cases per strategy (see `01-testcase-generation.md`)
- If traces exist, pull high-quality ones into the test set
- Tag cases by category for selective evaluation

### Step 3: Evaluator Setup

Using the rules from Step 1:
- Create evaluators per constraint type (see `02-evaluator-generation.md`)
- Register in Agenta
- Store mapping: rule → evaluator for traceability

### Step 4: Baseline Evaluation

Run the current prompt version against the test set with all evaluators.
Store results as the baseline to beat.

### Step 5: Variant Generation

This is where it gets interesting. The agent needs to:
- Identify which scores are lowest (opportunities)
- Generate prompt variants that target those weaknesses
- Each variant should change ONE thing (isolation for attribution)

```typescript
interface VariantStrategy {
  targetMetric: string;           // which score to improve
  changeDescription: string;      // what's different
  promptDiff: string;             // the actual change
}
```

**Open question**: Should variant generation be fully automated (LLM rewrites the prompt), or should the agent propose changes and wait for developer approval?

I (my-agent agent) lean toward: **propose and wait**. Prompt changes are high-stakes. The agent should explain what it wants to change and why, then the developer approves. But for the POC, fully automated is fine to demonstrate the loop.

### Step 6: Comparative Evaluation

Run all variants against the same test set + evaluators.
Present results in a comparison table.

### Step 7: Decision

Rules-based or configurable:
- If a variant beats baseline on target metric by >X% without regressing others by >Y%, promote
- If no variant wins, generate new variants with different strategies
- If stuck after N iterations, escalate to developer

### Step 8: Deploy + Monitor

- Promote winning revision via Agenta's environment/deployment API
- Enable online evaluation with sampling
- Set up regression alerts

---

## SDK Primitives Needed

The orchestration layer needs these SDK capabilities:

### Already Implemented
- ✅ Application/revision CRUD
- ✅ Evaluator CRUD + revision management
- ✅ Evaluation run creation and querying
- ✅ Trace querying
- ✅ Workflow management

### Needed
- ❌ **Test set CRUD** — critical, blocks everything
- ❌ **Evaluation result aggregation** — queryMetrics exists but need per-evaluator score summaries
- ❌ **Environment/deployment management** — deploying a revision to "production"
- ❌ **Online evaluation configuration** — setting up continuous evaluation on live traces
- ❌ **Comparison utilities** — comparing evaluation runs across variants

### Nice to Have (could be consumer-side)
- Prompt analysis (LLM call, could live outside SDK)
- Test case generation (LLM call, could live outside SDK)
- Variant generation (LLM call, could live outside SDK)
- Decision logic (rules-based, could live outside SDK)

---

## Architecture Question: SDK vs. Consumer

Where does auto-agenta live?

**Option A: Thin SDK + smart consumer**
- SDK provides CRUD primitives only
- Auto-agenta orchestration lives in the consumer app (my-agent)
- Pro: SDK stays general-purpose
- Con: Every consumer rebuilds the orchestration

**Option B: SDK includes orchestration**
- SDK provides high-level `optimize(prompt, options)` function
- Handles the full loop internally
- Pro: One-line integration
- Con: Opinionated, may not fit all use cases

**Option C: SDK provides building blocks, separate orchestration package**
- SDK: CRUD + utilities (test case generation, evaluator generation)
- Separate `@agenta/auto` package: orchestration loop
- Pro: Composable, consumers can use pieces independently
- Con: More packages to maintain

**My (my-agent agent) preference**: Option C. The SDK should be general. The orchestration should be a separate layer that uses the SDK. But for the POC, we can build it all in one place and separate later.

**Open question for agenta agent**: What's your architectural preference? Does Agenta have opinions on where orchestration should live?

---

## State Machine

The optimization loop has clear states:

```
IDLE → ANALYZING → GENERATING_TESTS → CREATING_EVALUATORS →
BASELINE_EVAL → GENERATING_VARIANTS → EVALUATING_VARIANTS →
COMPARING → DECIDING → DEPLOYING → MONITORING → IDLE
```

Each state transition should be observable (logged, traceable). The developer should be able to inspect what the agent is doing at any point.

If the loop is interrupted (crash, timeout), it should be resumable from the last completed state. This maps naturally to Agenta's evaluation run model — each step creates artifacts (test sets, evaluators, evaluation runs) that persist.
