# Annotation Queues Video — Voiceover Script

Target: ~110 seconds. Each take is independently re-recordable.

## T0 — Intro (≈ 10s)

> Annotation queues let you annotate two things in Agenta: test sets and
> production traces. Here's how each one works.

Visual: Annotations → Queues page (empty state).

---

## T1 — Demo 1: annotating a test set with ground truth (≈ 35s)

### T1a — Open the test set (≈ 8s)

> I have a test set of fifteen questions about Agenta, but no reference
> answers. Without ground truth, my evaluators have nothing to compare
> against.

Visual: open `agenta-faq` test set, scroll to show the missing column.

### T1b — Create the queue (≈ 10s)

> So I'll select all the rows and send them to an annotation queue. I'll
> attach a human evaluator with one field: the reference answer.

Visual: select rows → Add to queue → fill create-queue drawer → attach
`reference-answer` evaluator.

### T1c — Annotate (≈ 12s)

> Each row opens in a focused view. I write the reference answer, hit save,
> and move to the next.

Visual: annotate two rows. Speed up the rest in post.

### T1d — Result (≈ 5s)

> Now the test set has ground truth. My evaluators can compare against
> what the answer should actually be.

Visual: back on the test set, the reference answer column is populated.

---

## T2 — Demo 2: traces to a golden test set (≈ 55s)

### T2a — Open observability (≈ 10s)

> Same idea, different source. This is the same bot running in production.
> Some of these answers are correct, others are wrong, because the retrieved
> context didn't match the question.

Visual: observability, ~30 traces. Hover over a couple to show one correct,
one wrong.

### T2b — Create the queue (≈ 10s)

> I'll select these traces and send them to a new queue. This time the
> evaluator has two fields: is the answer correct, and if not, what should
> it have been.

Visual: select traces → Add to queue → attach `trace-correctness` evaluator.

### T2c — Annotate (≈ 20s)

> For correct ones, I just hit yes. For the wrong ones, I write the right
> answer. This goes faster than writing test cases from scratch because the
> question is already there.

Visual: annotate ~3 traces on camera. Mark one yes, mark two no + fill the
correct answer. Speed up the rest in post.

### T2d — Export to test set (≈ 15s)

> When the queue is done, I export it as a test set. The annotations become
> columns: is correct, correct answer. I now have a golden test set built
> from real production failures. Every change to the prompt gets validated
> against the cases I know it gets wrong.

Visual: export → name the new test set → land on the resulting test set with
columns.

---

## T3 — Outro (≈ 8s)

> Two use cases, one workflow. Annotation queues are live in Agenta.

Visual: back on the queues list, or a clean changelog screenshot.

---

## Notes for delivery

- Talk like an engineer in a one-on-one. No "in today's video", no
  "as you can see".
- Pause between sentences. Don't rush.
- If you flub a line, restart the sentence (cut in post).
- Burn captions into the final cut. Most LinkedIn / Twitter views are silent.
- The total above is ~108 seconds; budget allows ~10 seconds of breathing
  room or one extra example.
