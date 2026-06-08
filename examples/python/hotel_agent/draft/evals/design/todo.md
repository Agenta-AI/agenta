# TODO (human)

This file is for you, not for the agent. It collects the follow-up work that the issue log
in `status.md` points to. Each item names the issue it comes from.

## Docs and cookbooks

- [ ] Add the framework instrumentation step to the SDK evaluation docs. A user who evaluates
      an agent needs to call the framework instrumentor (for example
      `LangChainInstrumentor().instrument()`) to get a trace with tool and LLM spans.
      Today the docs under `docs/docs/evaluation/evaluation-from-sdk` do not mention it.
      Consider an info admonition on the quick start and a fuller cookbook. (Issue 3)
- [ ] Write a more complete evaluation cookbook that evaluates a real agent, including the
      instrumentation step and reading tool usage from the trace. (Issue 3)

## SDK

- [ ] Open an issue on the released SDK for the evaluator trace reuse bug, and link PR #4341
      as the fix. The released version (0.100.9) gives the wrong trace to the second and later
      evaluators. (Issue 2)
- [ ] Raise a clear error, not only a warning, when an Agenta decorator runs before
      `ag.init()`. PR #4341 adds a `RuntimeWarning`, but the raw `AttributeError` still
      follows it. (Issue 5)
- [ ] Add resilience to the evaluation run. Even with the scenario isolation in #4341, there
      is no HTTP level retry and no retry on thrown exceptions, and retry is off by default on
      the SDK path. Compare with LangSmith, Langfuse, and Braintrust, which isolate each item
      and retry backend calls. (Issue 1)
- [ ] Provide a supported way to read per-case, per-evaluator results back from a finished run.
      Today this needs hand querying `POST /api/evaluations/results/query` and joining
      annotation traces (see `summarize.py`). (Issue 4)
- [ ] Stop a single failing application from aborting the whole run. The released SDK does not
      isolate a raising application, and `metrics.arefresh` then raises `IndexError` on the
      empty metrics response (`metrics.py:35`). Guard that read and isolate the scenario.
      (Issue 8)
- [ ] The dev org plan was fixed by hand in the database (`subscriptions.plan` set to
      `cloud_v0_pro` for org `019e8df5-2a47-78e3-b925-fafc0299ae14`, cached subscription
      cleared). Check why the upgrade flow did not set the plan. (Issue 6)

## API and UX

- [ ] Consider offering a flat list of spans from the trace read endpoint, in addition to the
      nested tree. A tree is awkward to consume inside an evaluator. (Issue 3)
