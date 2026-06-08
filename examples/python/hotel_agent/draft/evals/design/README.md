# LangGraph evals: design and issue log

This is a working doc for the evaluation suite under `examples/python/hotel_agent/draft/evals/`.
It is temporary. We use it to track what we built and to work through the issues we found,
one by one.

## Why this exists

The real goal is not the hotel use case. The goal is to:

1. Build a tutorial for running evaluations in Agenta from the SDK.
2. Debug the experience along the way: the SDK, the UX, the docs, and the tracing.

The hotel agent is only the example we evaluate. What matters is every place where a
normal user, following the docs, would stumble. We record each of those in `status.md`.

A note on method. The first pass added workarounds to force the suite to pass. That was a
mistake for this goal, because a workaround hides the exact friction we want to surface.
This doc walks back each workaround and names the underlying issue, so we can decide the
right fix for each one (an SDK issue and patch, a docs change, a UX change, or a fix in
our own example code).

## Files

- `README.md` is this overview.
- `status.md` is the issue log. It lists the seven issues we found. Each entry describes
  the problem, the research behind it, the source, and what we did so far.

The code under evaluation lives one level up, in `evals/`:

- `testset.py` holds twelve test cases. Each case is one question plus the assertions we
  make about the answer.
- `application.py` wraps the LangGraph agent as an Agenta application.
- `evaluators.py` holds the three evaluators and their reusable core functions.
- `tracing_capture.py` holds the tracing setup and the in-process span capture. Most of it
  is workaround scaffolding that we want to remove.
- `run.py` runs the suite through `aevaluate` and records a run in Agenta.
- `run_local.py` runs the same logic without `aevaluate`, so it does not consume the
  platform evaluation quota.
- `summarize.py` reads a finished platform run back into a table.

## How the evals work

The Agenta SDK evaluation flow has three parts that feed one call.

An **application** is a function wrapped with `@ag.application`. It receives fields from a
test case as named arguments and returns the output we want to score. Our application takes
`message` and `persona`, runs the LangGraph agent, and returns the answer.

An **evaluator** is a function wrapped with `@ag.evaluator`. It receives the application
output and any test case fields it names, and returns a dictionary. The keys `score` and
`success` carry special meaning. We have three evaluators:

1. `rubric_correctness` asks an LLM judge whether the answer satisfies each rubric in the
   test case.
2. `tool_usage` checks that the agent called the expected tools and avoided the forbidden
   ones.
3. `faithful_pricing` checks that every price in the answer comes from a tool result or
   from a fee that the system prompt states.

A **test set** is a list of test cases, created with `ag.testsets.aupsert`. Each case is a
flat dictionary: `message`, `persona`, `rubrics`, `expected_tools`, and `forbidden_tools`.

The driver `run.py` calls `aevaluate(testsets=..., applications=..., evaluators=...)`. The
SDK runs each case through the application, then runs every evaluator on the result, and
stores everything as a run you can open in the Agenta UI.

## How a test case reads

A single case carries the question and the full list of assertions about the answer.

```python
{
    "message": "How long before check-in can I cancel my booking for free?",
    "persona": "guest_grace",                 # a seeded Standard-tier guest
    "rubrics": [
        "States the Standard-tier cancellation cutoff is 24 hours before check-in",
        "Does not claim to have cancelled or changed any booking",
    ],
    "expected_tools": [],
    "forbidden_tools": ["cancel_reservation", "create_reservation", "modify_reservation"],
}
```

## Current status

The suite runs end to end and produces differentiated results. The last local run scored
rubric correctness 7 of 12, tool usage 10 of 12, and faithful pricing 12 of 12. The failures
are real findings about the agent, such as the agent passing a room display name to a tool
that expects the room code.

The open work is not about the scores. It is about the seven issues in `status.md`. We will
go through them one at a time and decide the correct fix for each.
