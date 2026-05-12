# Synthetic Test Case Generation — Plan

> For when no past traces exist (cold start), or when trace coverage is thin.

---

## When to trigger

The optimization hook's trace collection step:
1. Seed trace exists (always — the user just interacted)
2. Past traces: `0-2 found` → supplement with synthetic cases
3. Past traces: `3+ found` → no synthesis needed, use real data

## What to generate

Given the seed trace (input + output + annotation), generate variations:

### From the annotation label
- `too_verbose` → generate inputs that tend to produce verbose responses (long questions, open-ended prompts)
- `wrong_tool` → generate inputs that test tool selection (ambiguous requests, edge-case tool triggers)
- `off_tone` → generate inputs across different tones (formal request, casual chat, frustrated user)
- `bad` (generic) → generate adversarial inputs (unclear instructions, contradictory requests)

### From the seed input
- Rephrase the same question differently (5 variations)
- Simplify / complicate the input
- Change the context (different user persona, different product domain)

## How to generate

This requires an LLM call — can't be done purely client-side without an API route.

### Option A: Server-side API route
```
POST /api/agenta/generate-testcases
Body: { seedInput, seedOutput, annotation, count: 5 }
Response: { testcases: [{ input, expectedBehavior }] }
```

The API route calls an LLM (via the project's existing AI SDK setup) to generate variations.

### Option B: Use Agenta's evaluation system
Create a "test case generator" evaluator that takes a seed trace and produces variations.
This would be a workflow with a custom prompt that outputs structured test data.

### Option C: Template-based (no LLM needed)
For common labels, use predefined templates:
- `too_verbose`: add "Be brief." to the input, or "Answer in one sentence."
- `wrong_tool`: modify the input to explicitly mention the expected tool
- `off_tone`: prepend "Respond casually:" or "Be professional:"

## Implementation priority

1. **Phase 1 (now)**: Graceful fallback — if < 3 traces, show a message suggesting the user generate more conversations first. No synthesis.
2. **Phase 2**: Template-based variations — simple, no LLM needed, covers common labels.
3. **Phase 3**: LLM-powered generation via API route — full coverage, any label, contextual variations.

## Integration point

In `use-optimization.ts`, after trace collection:

```typescript
if (traceIds.length < 4) {
  // Not enough traces for meaningful evaluation
  // Phase 1: suggest more conversations
  // Phase 2: generate template variations
  // Phase 3: call LLM to generate synthetic cases
}
```

The synthetic cases go into the testset alongside real traces. They should be tagged as `synthetic: true` in the testcase data so results can be filtered.
