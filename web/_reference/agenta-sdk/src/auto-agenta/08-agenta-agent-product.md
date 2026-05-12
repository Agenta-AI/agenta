# The Agenta Agent: Product Concept

> Reframing auto-agenta as a user-facing agent product, not internal tooling.

---

## What Is It?

An AI agent that lives inside Agenta (or connects to it) and handles the full prompt optimization lifecycle on behalf of the user. The user's interface is a conversation:

```
User: "I just created the rh-onboarding prompt. Help me optimize it."

Agenta Agent: "I've read rh-onboarding. It's a 3-step onboarding flow that asks for
a store URL, detects the platform, and suggests a first action. I found 12 testable
constraints (sentence limits, tool call requirements, tone rules).

I'd like to:
1. Generate ~30 test cases covering happy paths, edge cases, and adversarial inputs
2. Create 8 evaluators matching your prompt's rules
3. Run a baseline evaluation

Want me to proceed, or should we adjust the test strategy first?"
```

## Why It Matters

The current Agenta workflow requires the user to:
1. Manually write test cases
2. Manually configure evaluators
3. Manually trigger evaluation runs
4. Manually interpret results
5. Manually create prompt variants
6. Manually compare and decide

Each step requires understanding Agenta's concepts (testsets, evaluators, scenarios, runs, metrics). The agent collapses this into a conversation where the user provides intent and the agent handles execution.

## User Personas

### Persona A: Prompt Engineer (power user)
- Knows evaluation concepts
- Wants the agent to handle tedious work (test case generation, evaluator wiring)
- Wants control over strategy decisions (which variants to try, when to deploy)
- Interaction: collaborative, agent proposes → user approves/adjusts

### Persona B: Developer (pragmatic user)
- Wrote a prompt, wants it to work well
- Doesn't want to learn evaluation frameworks
- Wants to say "make this better" and get results
- Interaction: delegative, agent handles everything, user reviews final outcome

### Persona C: Team Lead (oversight user)
- Has multiple prompts across a team
- Wants continuous quality monitoring
- Wants alerts when prompts degrade
- Interaction: strategic, sets policies, agent executes and reports

## Core Capabilities

### 1. Prompt Understanding
- Read any prompt (from Agenta app revision or raw text)
- Extract testable constraints, implied scenarios, tool references
- Identify multi-turn structure if present
- Understand the prompt's domain and purpose

### 2. Test Set Lifecycle
- **Generate** synthetic test cases from prompt analysis
- **Bootstrap** test sets from existing traces
- **Grow** test sets by converting high-quality production traces
- **Curate** test sets by flagging low-quality or redundant cases
- **Annotate** test cases using auto (structural), LLM judge, and human review

### 3. Evaluator Management
- **Auto-create** evaluators from prompt constraints
- **Select** appropriate built-in evaluators
- **Configure** LLM-as-a-Judge with tailored prompts
- **Version** evaluators alongside prompt changes

### 4. Evaluation Orchestration
- Run offline evaluations (prompt version × test set × evaluators)
- Set up online evaluations (continuous on live traces)
- Compare results across variants
- Present results in digestible format (not raw numbers)

### 5. Prompt Variant Generation
- Identify weak areas from evaluation results
- Propose targeted changes (not random rewrites)
- Explain the reasoning behind each variant
- Support user-guided variant creation too

### 6. Deployment & Monitoring
- Promote winning variants to environments
- Set up regression monitoring
- Alert on quality degradation
- Feed new traces back into the optimization loop

## The Conversation Protocol

The agent should follow a predictable interaction pattern:

### Phase 1: Onboarding (first time with a prompt)
```
Agent: "I've analyzed [prompt]. Here's what I found: [summary].
        I recommend starting with [strategy]. Should I proceed?"
User:  "Yes" / "Actually, focus on [specific aspect]"
```

### Phase 2: Setup (test cases + evaluators)
```
Agent: "Generated [N] test cases in [M] categories.
        Created [K] evaluators covering [types].
        Here are a few examples: [samples].
        Anything to adjust before I run the baseline?"
User:  "Add a test for [edge case]" / "Looks good, run it"
```

### Phase 3: Evaluation
```
Agent: "Baseline results:
        - Structural compliance: 100% (all rules followed)
        - Tone: 0.85 (slightly formal in step 2)
        - Tool usage: 95% (missed getUserContext in 1 edge case)
        - Completion potential: 67% (step 3 suggestions too vague)

        Biggest opportunity: completion. Want me to create variants targeting that?"
User:  "Yes" / "Also work on the tone issue"
```

### Phase 4: Iteration
```
Agent: "Tested 3 variants:
        [table comparing scores]
        Variant B improved completion by 22% with acceptable trade-offs.
        Should I deploy it, or iterate further?"
User:  "Deploy B" / "Try combining B's step 3 with A's tone"
```

### Phase 5: Monitoring
```
Agent: "rh-onboarding has been in production for 3 days.
        Online evaluation (10% sampling):
        - Tone: 0.91 (↑ from 0.85)
        - Completion: 0.82 (↑ from 0.67)
        - 2 new edge cases detected → added to test set.
        No action needed."
```

## The Hard Product Decisions

### How opinionated should the agent be?

**Maximally opinionated with escape hatches.** The agent should have strong defaults:
- Default test generation strategy
- Default evaluator selection
- Default number of variants to try
- Default promotion criteria

But every decision should be overridable. "I'd recommend X. Want me to proceed, or do something different?"

### How much should the agent explain?

**Enough to build trust, not so much it overwhelms.** The agent should:
- Always show what it's about to do before doing it
- Summarize results, not dump raw data
- Explain reasoning behind recommendations
- Link to detailed results in Agenta UI for users who want to dig deeper

### When should the agent stop and ask vs. proceed?

**Ask before irreversible or expensive actions:**
- Deploying to production → always ask
- Creating variants (LLM calls, costs money) → ask first time, then remember preference
- Running evaluations → proceed automatically (can always re-run)
- Adding to test sets → proceed automatically (can always edit)

### What about multi-prompt optimization?

Many apps have multiple prompt modules that interact. Optimizing one might regress another. The agent should:
- Be aware of related prompts (e.g., MODULE_ORDER in Rheono)
- Run regression checks on dependent prompts when one changes
- Flag cross-prompt interactions

---

## Technical Architecture

### Where does the agent run?

**Option A: Inside Agenta's platform**
- Agenta hosts the agent
- Users interact via Agenta's UI (chat panel?)
- Agent has direct access to all Agenta APIs
- Pro: tightest integration, no auth complexity
- Con: Agenta needs to build/maintain an agent runtime

**Option B: External agent using Agenta SDK**
- Agent runs anywhere (user's app, separate service, Claude Code, etc.)
- Uses the TS/Python SDK to interact with Agenta
- Pro: flexible deployment, SDK-first approach
- Con: more setup for the user

**Option C: Hybrid — Agenta provides the agent, SDK enables custom agents**
- Agenta ships a default "Agenta Agent" in the platform
- The SDK enables power users to build custom optimization agents
- Pro: works for both personas (quick start + customizable)
- Con: two things to maintain

### What LLM does the agent use?

The agent itself needs an LLM for:
- Prompt analysis (extracting rules, inferring scenarios)
- Test case generation (synthetic inputs)
- Variant generation (rewriting prompts)
- Result interpretation (summarizing for user)
- LLM-as-a-Judge evaluators

Should this be configurable? Probably yes — users may want to use the same provider they're optimizing for, or a different one.

### State management

The agent needs to remember:
- What prompts it's optimizing
- Current test sets and evaluators
- Evaluation history and results
- User preferences (how involved they want to be)
- The current phase of optimization for each prompt

This maps naturally to Agenta's own data model — everything is stored as artifacts in Agenta.

---

## SDK Implications

If the agent is a product, the SDK needs to support building agents like it:

### Must-have SDK additions
1. **Test Sets CRUD** — P0, already identified
2. **Evaluator templates** — list available built-in evaluators, create from templates
3. **Evaluation comparison** — compare two evaluation runs, return delta
4. **Environment/deployment** — promote revisions
5. **Trace-to-testset utilities** — convenience methods for the common flow

### Nice-to-have SDK additions
6. **Prompt analysis utilities** — extract constraints, infer test scenarios
7. **Annotation queue management** — push cases to review, check status
8. **Online evaluation config** — create/manage live evaluations

### NOT in the SDK (agent-side logic)
- Prompt variant generation
- Decision making (when to deploy, when to iterate)
- User interaction management
- Result interpretation and summarization

---

## Open Questions (for both agents + Arda)

1. **Is this agent an Agenta product, or a reference implementation?** Big difference in scope and commitment.
2. **What's the MVP?** Probably: analyze prompt → generate test cases → create evaluators → run baseline → show results. No variant generation, no deployment, no monitoring yet.
3. **Does Agenta want to own the agent UX?** Chat panel in the Agenta dashboard? Or is this a headless agent that integrates into user's existing tools?
4. **Pricing model?** The agent makes LLM calls (test generation, evaluation, variant creation). Who pays? Agenta absorbs it? User provides their own LLM key?
5. **How does this relate to Agenta's existing UI workflows?** Complement or replace? The agent should probably be an accelerator — do the same things the UI does, but faster and with less manual work.
