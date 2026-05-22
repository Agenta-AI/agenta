# Annotation Queues Demo Data

Scripts that populate an Agenta project with the data needed to record the
"annotation queues" changelog video.

## What gets created

| Asset | Slug | Purpose |
|---|---|---|
| Application | `agenta-docs-bot` | Doc Q&A prompt with two template variables (`documentation`, `question`) |
| Test set | `agenta-faq` | 15 questions about Agenta, no ground truth column |
| Human evaluator | `reference-answer` | Single free-text field (used for Demo 1) |
| Human evaluator | `trace-correctness` | yes/no + free-text correct answer (used for Demo 2) |
| Production traces | (auto) | ~30 invocations of the bot with mixed correct and unrelated doc snippets as context |

No annotation queues are created. Those are built on camera.

## Setup

1. Write your credentials to `~/.agenta-linkflow.env`:

   ```
   AGENTA_API_KEY=...
   AGENTA_HOST=https://eu.cloud.agenta.ai
   OPENAI_API_KEY=...
   ```

   Mode 600.

2. Run all four scripts:

   ```bash
   ./setup.sh
   ```

   Each script is idempotent. If an app / test set / evaluator already exists,
   the script unarchives it (if needed) and commits a fresh revision instead
   of erroring out on the slug conflict.

   Re-running adds 30 new traces each time. If you only want the latest batch,
   delete the project from the Agenta UI between recordings.

## Files

```
data.py                       — 15 test-set questions, ~30 trace questions, 10 doc snippets, question→doc mapping
lib.py                        — HTTP client, env loader, shared slugs
01_create_app.py              — creates / refreshes the doc Q&A application
02_create_testset.py          — creates / refreshes the question-only test set
03_create_evaluators.py       — creates / refreshes the two human evaluators
04_generate_traces.py         — invokes the app ~30 times to populate observability
setup.sh                      — runs 01..04 in order
```

## How the "wrong context" trick works

Each invocation of the bot passes two inputs: a `documentation` snippet and a
`question`. For 60% of invocations the snippet matches the question (the bot
answers correctly). For 40% the snippet is from an unrelated doc page. The
model is told to use only the snippet, so the result is either a graceful
"the documentation does not cover this" or a confidently-wrong answer rooted
in the wrong context. Both failure modes are useful in the demo: reviewers
catch them and provide the correct answer.

The 60/40 split is controlled by `WRONG_CONTEXT_RATE` in `04_generate_traces.py`.
The seed is fixed so re-runs produce the same shuffle.

## Recording flow

The data populates the two-demo video:

- **Demo 1** uses `agenta-faq` (test set) + `reference-answer` evaluator.
  Mahmoud annotates 2–3 rows on camera; fast-forwards the rest in post.
- **Demo 2** uses the observability traces + `trace-correctness` evaluator.
  Annotates 2–3 traces on camera; exports the queue as a labeled test set.
