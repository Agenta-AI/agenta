# Auto-Generating Evaluators from Prompt Constraints

> If a prompt has rules, those rules are evaluatable. This doc explores automating evaluator creation.

---

## Core Idea

Every prompt module contains implicit and explicit constraints. An "agenta agent" should read a prompt and produce evaluator configurations automatically.

## Constraint Taxonomy

### Type 1: Structural Constraints (deterministic, no LLM needed)

These can be checked with simple code:

| Prompt Rule | Evaluator Type | Implementation |
|---|---|---|
| "Max 2 sentences per response" | `sentence_count_check` | Split on `.!?`, count ≤ 2 |
| "Never list structured data" | `no_lists_check` | Regex for `- `, `1.`, `* `, `\n- ` patterns |
| "STOP after each step" | `single_response_check` | Verify agent doesn't continue unprompted |
| "Ask only ONE question" | `question_count_check` | Count `?` occurrences = 1 |

**SDK approach**: These become custom evaluators registered in Agenta:

```typescript
// Auto-generated from prompt analysis
const sentenceCountEvaluator = {
  slug: "rh-onboarding-sentence-count",
  name: "Sentence Count ≤ 2",
  type: "code",
  script: `
    const sentences = output.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return { score: sentences.length <= 2 ? 1.0 : 0.0, success: sentences.length <= 2 };
  `
};
```

### Type 2: Behavioral Constraints (need tool call inspection)

These check what the agent *did*, not just what it *said*:

| Prompt Rule | What to Check |
|---|---|
| "Call getUserContext FIRST" | First tool call in trace is getUserContext |
| "Call detectStore with their URL" | detectStore called with URL argument matching user input |
| "Call savePreference for store_platform, store_name, store_url, currency" | Exactly 4 savePreference calls with correct keys |

**SDK approach**: These evaluators need access to the trace (tool calls), not just the text output. This maps to Agenta's `{{trace}}` template variable in LLM-as-a-Judge, or custom evaluators that receive the full trace.

**Open question for agenta agent**: Can custom code evaluators access the trace/span data? Or only the final text output? If only text, we need to serialize tool calls into the output for evaluation.

### Type 3: Semantic Constraints (LLM-as-a-Judge)

These require judgment:

| Prompt Rule | LLM Judge Prompt |
|---|---|
| "Respond casually" | "Does this response use a casual, conversational tone? Not formal, not robotic." |
| "No filler language" | "Does this response contain filler phrases like 'feel free to', 'I'm here to help', 'don't hesitate'?" |
| "Suggest ONE specific action based on what you know" | "Is exactly one concrete action suggested? Not vague, not multiple options." |
| "Never offer menu of options" | "Does this response present a list of choices or options for the user to pick from?" |

**SDK approach**: Auto-generate LLM-as-a-Judge configurations:

```typescript
const toneEvaluator = {
  slug: "rh-onboarding-tone",
  name: "Casual Tone Check",
  type: "llm-as-a-judge",
  config: {
    model: "gpt-5.4",
    prompt: [
      { role: "system", content: "You evaluate whether AI assistant responses use a casual, conversational tone appropriate for a quick chat with a business owner. Score 1.0 for casual and natural, 0.0 for formal, robotic, or overly enthusiastic." },
      { role: "user", content: "User said: {{inputs.user_message}}\n\nAssistant responded: {{outputs}}\n\nIs the tone casual and natural?" }
    ],
    output_schema: "binary"  // pass/fail
  }
};
```

## The Generation Pipeline

```
[1] Parse prompt module text
    ↓
[2] Extract rules (regex for patterns like "never", "always", "max N", "only", "must")
    ↓
[3] Classify each rule → structural / behavioral / semantic
    ↓
[4] Generate evaluator config for each rule
    ↓
[5] Register evaluators in Agenta via SDK
    ↓
[6] Return evaluator IDs for use in evaluation runs
```

### Step 1-2: Rule Extraction

This is itself an LLM task. Given a prompt, extract structured rules:

```typescript
interface ExtractedRule {
  text: string;           // Original rule text from prompt
  type: 'structural' | 'behavioral' | 'semantic';
  constraint: string;     // Machine-readable constraint
  severity: 'must' | 'should' | 'prefer';  // How strict
}

// Example output for rh-onboarding:
[
  { text: "Max 2 sentences per response", type: "structural", constraint: "sentence_count <= 2", severity: "must" },
  { text: "Call getUserContext FIRST", type: "behavioral", constraint: "first_tool_call == 'getUserContext'", severity: "must" },
  { text: "Respond casually", type: "semantic", constraint: "tone == casual", severity: "should" },
]
```

### Step 3-4: Evaluator Generation

Each rule type has a different generation strategy:
- **Structural** → deterministic code evaluator (template-based, no LLM needed)
- **Behavioral** → trace-inspecting evaluator (needs tool call data)
- **Semantic** → LLM-as-a-Judge config with tailored prompt

### Step 5-6: Registration

Use the SDK's evaluator and workflow managers to:
1. Create evaluator workflows in Agenta
2. Commit revisions with the evaluator logic
3. Return references for use in evaluation runs

## Proposed SDK Addition

```typescript
// High-level: analyze prompt, create evaluators, return references
async function createEvaluatorsFromPrompt(
  agenta: Agenta,
  promptText: string,
  options?: {
    applicationSlug: string;    // tie evaluators to this app
    model?: string;             // LLM for rule extraction and judge evaluators
    includeTypes?: ('structural' | 'behavioral' | 'semantic')[];
  }
): Promise<{
  rules: ExtractedRule[];
  evaluators: Array<{ rule: ExtractedRule; evaluatorId: string; slug: string }>;
}>
```

---

## Open Questions (for agenta agent)

1. What evaluator types does Agenta support natively? Code, LLM-as-a-Judge, webhook — anything else?
2. Can code evaluators access trace data (tool calls, intermediate steps), or only final output?
3. Is there a standard schema for LLM-as-a-Judge configuration in the API? The Python SDK uses `auto_ai_critique` — what's the REST equivalent?
4. Can evaluators be scoped to specific applications, or are they global?
5. For behavioral evaluators that check tool calls — should we model these as custom code evaluators that parse the trace, or is there a first-class "tool call assertion" evaluator type?
6. What's the evaluator revision model? If we auto-generate an evaluator and later the prompt changes, should we version the evaluator alongside the prompt?
