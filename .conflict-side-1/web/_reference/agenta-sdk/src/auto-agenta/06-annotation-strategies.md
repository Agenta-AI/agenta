# The Annotation Problem

> The single hardest part of auto-agenta. This doc goes deep.

---

## Why Annotation Is Hard

A test case without a label is useless. You need to know what "good" looks like to evaluate whether you're achieving it.

For simple tasks (Q&A, classification), annotation is straightforward: the expected answer is known.

For conversational agents like onboarding, "good" is multidimensional:
- Correct tool usage ✓ (verifiable)
- Correct information extraction ✓ (verifiable against ground truth)
- Appropriate tone ✗ (subjective)
- Natural conversation flow ✗ (subjective)
- User satisfaction ✗ (requires the actual user)

## Annotation Strategies by Difficulty

### Level 1: Auto-Annotatable (no human needed)

These have objective ground truth:

| What | How to Annotate | Example |
|---|---|---|
| Tool call correctness | Compare to expected tool sequence | detectStore called? ✓/✗ |
| Preference saved correctly | Check DB state after conversation | store_platform = "shopify"? ✓/✗ |
| Structural compliance | Regex/count checks | ≤ 2 sentences? ✓/✗ |
| Response format | Pattern matching | No bullet lists? ✓/✗ |

**Automation approach**: Run the conversation, inspect traces and DB state, auto-label.

### Level 2: LLM-Annotatable (LLM judges, human validates sample)

These have fuzzy ground truth that an LLM can approximate:

| What | How to Annotate | Confidence |
|---|---|---|
| Tone appropriateness | LLM-as-Judge with rubric | High (0.85+) |
| Filler language detection | LLM-as-Judge with examples | Very high (0.95+) |
| Question relevance | LLM-as-Judge given context | Medium (0.75+) |
| Action suggestion quality | LLM-as-Judge given user profile | Medium (0.70+) |

**Automation approach**: Run LLM judge, assign scores. Periodically sample low-confidence judgments for human review.

### Level 3: Human-Required (no automation shortcut)

| What | Why Human Needed |
|---|---|
| "Does this feel natural?" | Gestalt judgment, hard to decompose |
| "Would a real user drop off here?" | Requires user empathy |
| "Is this business-appropriate?" | Domain-specific judgment |
| "Would I trust this agent with my store?" | Trust is experiential |

**Approach**: These annotations come from:
1. The developer (you) reviewing sampled conversations
2. Real user feedback (implicit: did they complete onboarding? explicit: thumbs up/down)
3. Proxy metrics (completion rate, return rate, time to complete)

## The Cold-Start Annotation Pipeline

For a brand new prompt with no traces:

```
Phase 1: Synthetic (Day 0)
├── Generate test cases from prompt analysis
├── Auto-annotate with Level 1 checks (structural, tool calls)
├── LLM-annotate with Level 2 checks (tone, relevance)
├── Result: ~30 test cases, machine-annotated
└── Confidence: Medium — good enough for baseline + initial variants

Phase 2: Early Traces (Day 1-7)
├── Deploy prompt, collect real traces
├── Auto-annotate new traces with existing evaluators
├── LLM-annotate and flag low-confidence for human review
├── Human reviews ~10 flagged traces
├── Convert high-confidence traces to test cases
├── Result: ~50 test cases, mixed annotation quality
└── Confidence: Medium-High — real data improves coverage

Phase 3: Mature (Week 2+)
├── Continuous trace collection
├── Online evaluation with sampling
├── Human reviews edge cases only
├── Test set grows organically from production traffic
├── Result: 100+ test cases, high-quality annotations
└── Confidence: High — battle-tested against real users
```

## Practical Annotation Workflow for auto-agenta Agent

When the auto-agenta agent generates a test case, it should:

1. **Always attach Level 1 annotations** — these are free and objective
2. **Always run Level 2 LLM annotations** — cheap and fast
3. **Calculate confidence** — if Level 1 and Level 2 agree, high confidence. If they disagree, flag for review
4. **Present flagged cases to developer** — "I'm unsure if this response is good or bad. What do you think?"
5. **Learn from developer feedback** — use their judgment to calibrate future LLM annotations

```typescript
interface AnnotatedTestCase {
  input: Record<string, unknown>;
  output: string;
  annotations: {
    auto: {                    // Level 1 — always present
      structural_pass: boolean;
      tool_calls_correct: boolean;
      preferences_saved: boolean;
    };
    llm_judge: {               // Level 2 — always present
      tone_score: number;
      relevance_score: number;
      overall_score: number;
      reasoning: string;
    };
    human?: {                  // Level 3 — present when reviewed
      approved: boolean;
      notes?: string;
      reviewed_by: string;
      reviewed_at: string;
    };
    confidence: number;        // 0.0 - 1.0, computed from agreement
    needs_review: boolean;     // flagged for human
  };
}
```

## Open Questions (for agenta agent)

1. Does Agenta have a native annotation model for traces/test cases? Or do we store annotations as metadata?
2. Is there a human review queue in Agenta's UI? Can we push cases to it programmatically?
3. How do online evaluation results feed back into test set annotation? Is there a link?
4. For LLM-as-a-Judge annotations during test case creation — should these run through Agenta's evaluation system, or as standalone LLM calls?
5. What's the recommended way to track annotation confidence and review status in Agenta's data model?
