# Auto-Agenta: Overview & Vision

> This folder contains brainstorming documents for the auto-agenta system.
> Two agents are collaborating here:
> - **my-agent agent** (consumer perspective — uses Agenta to optimize prompts for Rheono)
> - **agenta agent** (platform perspective — building the TS SDK and evaluation primitives)
>
> Each doc focuses on one problem area. Annotate inline, add new docs, disagree freely.

---

## What Is Auto-Agenta?

A generalized system that automates the prompt optimization loop:

```
Prompt Module (e.g., rh-onboarding)
    │
    ▼
[1] Analyze prompt → infer testable assertions & edge cases
    │
    ▼
[2] Generate test cases (synthetic) + bootstrap from traces (real)
    │
    ▼
[3] Auto-configure evaluators (from prompt constraints)
    │
    ▼
[4] Create prompt variant(s)
    │
    ▼
[5] Run offline evaluation (variant × test set × evaluators)
    │
    ▼
[6] Compare results → decide: iterate, promote, or stop
    │
    ▼
[7] Deploy winning variant → enable online evaluation on live traces
    │
    ▼
[8] Continuous monitoring → feed new traces back into test sets
    │
    ▼
[loop back to 1 if regression detected]
```

## The Hard Problem

**Test case creation and annotation** is the bottleneck. Everything else (running evaluations, comparing scores, deploying variants) is mechanical once you have good test cases.

Specifically:
- Cold-start: no traces exist yet for a new prompt
- Annotation: who/what decides if an output is "good"?
- Multi-turn: onboarding is a conversation, not a single prompt→response
- Coverage: how do you know your test set covers the failure modes that matter?

## What the SDK Needs to Enable

The TS SDK currently covers: applications, revisions, evaluators, evaluations, tracing, workflows.

**Missing for auto-agenta:**
1. Test set CRUD (not implemented yet)
2. Trace-to-test-set conversion
3. Evaluator creation from prompt analysis (LLM-as-a-Judge config)
4. Orchestration layer that ties steps 1-8 together
5. Multi-turn conversation modeling in test sets and evaluations

## Concrete Use Case: Rheono Onboarding

The `rh-onboarding` prompt module defines a 3-step conversation for new e-commerce users. We want to:
- Evaluate whether the current prompt follows its own rules
- Try variants (different opening questions, tone adjustments, step count)
- Measure which variant leads to better onboarding completion
- Do all of this without manually writing 50 test cases

See `01-testcase-generation.md` for the deep dive on this.
