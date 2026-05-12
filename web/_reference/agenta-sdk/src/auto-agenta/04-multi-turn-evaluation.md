# Multi-Turn Conversation Evaluation

> Onboarding isn't a single call. This doc addresses evaluating conversation flows.

---

## The Problem

Most evaluation frameworks model: `input → application → output → evaluate`.

Onboarding is: `input₁ → output₁ → input₂ → output₂ → input₃ → output₃ → evaluate`.

The quality of output₂ depends on what happened in turn 1. The quality of the full conversation depends on the trajectory, not individual turns.

## What We Need to Evaluate

### Per-Turn Metrics
- Did this turn follow structural rules? (sentence count, no lists, etc.)
- Did the agent call the right tools?
- Did the agent ask the right question for this step?
- Was the tone consistent?

### Trajectory Metrics
- Did the user complete all 3 steps?
- How many turns did it take? (efficiency)
- Did the agent recover from unexpected inputs?
- Did the conversation feel natural or robotic when read as a whole?
- Were preferences correctly saved by the end?

### Completion Metrics
- Store URL captured? (boolean)
- Platform detected? (boolean + correctness)
- Product category learned? (boolean)
- First action suggested? (boolean + relevance)

## Modeling Multi-Turn Test Cases

### Option A: Scripted Conversations

Pre-define the full conversation:

```typescript
const testCase = {
  turns: [
    { user: "hi", expectedBehavior: "ask for store URL" },
    { user: "mybeans.com", expectedBehavior: "call detectStore, confirm platform, ask about products" },
    { user: "we sell specialty coffee beans", expectedBehavior: "suggest one relevant action" },
  ]
};
```

Pro: Deterministic, easy to evaluate each turn
Con: Brittle — if the agent's response changes the user's next input, the script breaks

### Option B: Adaptive Simulation

Use a "user simulator" LLM that plays the user role:

```typescript
const testCase = {
  userPersona: "small Shopify coffee roaster, casual, gives short answers",
  startMessage: null,  // let agent go first (or user says "hi")
  maxTurns: 6,
  successCriteria: ["store_url saved", "platform detected", "action suggested"],
};
```

The evaluation runner:
1. Sends empty/initial message to agent
2. Agent responds
3. User simulator generates next user message based on persona + agent response
4. Repeat until maxTurns or success criteria met
5. Evaluate the full trajectory

Pro: Tests natural conversation flow, catches unexpected paths
Con: Non-deterministic, harder to reproduce failures, user simulator quality matters

### Option C: Hybrid — Scripted Inputs, Flexible Evaluation

Pre-define user inputs but evaluate outputs flexibly:

```typescript
const testCase = {
  inputs: [
    "hi",
    "mybeans.com",
    "specialty coffee, single origin beans from Ethiopia and Colombia"
  ],
  perTurnEvaluators: [
    ["asks_for_store_url", "tone_casual", "sentence_count"],
    ["calls_detect_store", "confirms_platform", "asks_about_products", "tone_casual"],
    ["suggests_one_action", "action_is_relevant", "tone_casual"]
  ],
  trajectoryEvaluators: ["all_prefs_saved", "conversation_efficiency", "natural_flow"]
};
```

Pro: Reproducible inputs, flexible output evaluation
Con: Doesn't test the agent's ability to handle unexpected inputs

**My (my-agent agent) recommendation**: Start with Option C for the baseline, add Option B for adversarial/edge-case testing. Option A is too brittle for anything beyond smoke tests.

## SDK Requirements

### Conversation Runner

```typescript
interface ConversationRunner {
  // Run a scripted conversation (Option C)
  runScripted(
    application: ApplicationRef,
    inputs: string[],
    options?: { sessionId?: string; context?: Record<string, unknown> }
  ): Promise<ConversationTrace>;

  // Run a simulated conversation (Option B)
  runSimulated(
    application: ApplicationRef,
    persona: UserPersona,
    options?: { maxTurns?: number; successCriteria?: string[] }
  ): Promise<ConversationTrace>;
}

interface ConversationTrace {
  turns: Array<{
    input: string;
    output: string;
    toolCalls: ToolCall[];
    latency: number;
    traceId: string;
  }>;
  totalTurns: number;
  completed: boolean;
  metadata: Record<string, unknown>;
}
```

### Conversation Evaluator

```typescript
interface ConversationEvaluator {
  // Evaluate a single turn within a conversation
  evaluateTurn(
    turn: ConversationTurn,
    turnIndex: number,
    evaluators: EvaluatorRef[]
  ): Promise<TurnEvaluationResult>;

  // Evaluate the full trajectory
  evaluateTrajectory(
    trace: ConversationTrace,
    evaluators: EvaluatorRef[]
  ): Promise<TrajectoryEvaluationResult>;
}
```

## Mapping to Agenta's Model

How does this map to Agenta's existing concepts?

| Multi-Turn Concept | Agenta Concept | Fit |
|---|---|---|
| Conversation test case | Test set row | Partial — needs multi-turn schema |
| Single turn | Evaluation scenario? | Maybe — one scenario per turn? |
| Turn evaluation | Evaluation result | Yes — result per evaluator per turn |
| Trajectory evaluation | Evaluation metrics | Maybe — aggregate across scenarios |
| Conversation trace | Trace with spans | Yes — each turn is a span |

**Open question for agenta agent**:
1. Can a single evaluation run handle multiple "sub-evaluations" (one per turn)?
2. Is the scenario model flexible enough to represent turns within a conversation?
3. Should we model each turn as a separate scenario in a run, or the whole conversation as one scenario with multiple results?
4. How do traces from multi-turn conversations look in Agenta? One trace with multiple spans, or multiple traces?
