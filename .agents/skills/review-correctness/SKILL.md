---
name: review-correctness
description: Review one code change for correctness and rate it Low, Medium, or High. Looks for bugs, regressions in existing behavior, broken flows, concurrency and retry problems, and migrations that can fail or lose data. Use when asked to "review this PR for bugs", "check this diff for regressions", "is this change correct", or when a review loop runs the correctness lens. Read-only; it reports findings and does not fix them.
---

# Review a change for correctness

You review one code change and report what it breaks or can break, and how much it matters.

Follow `../shared/references/review-contract.md` for the inputs, the shared rules, and the
report shape. This lens accepts code targets only.

## What to look for

Read `lens.md` in this skill's directory and apply it.

## Rating

Base the rating on severity (what the user loses), reach (how ordinary the trigger is), and
recovery (whether the user or an operator can see and fix it).

- **Low:** no reachable bug, or only small problems with easy, visible recovery.
- **Medium:** at least one reachable bug or regression in a real flow, with limited impact or
  a visible recovery path. The approach is sound and the fix is local.
- **High:** data loss or corruption, a broken core flow, a migration that can fail or lose
  data in production, or a problem the approach itself causes so the fix needs a different
  design.

## Lens rules

- Raise a finding only with a concrete trigger you can reach. Say which input, state, or
  timing reaches it.

## Report

- Title: `# Correctness review`.
- What is wrong: the wrong behavior, the trigger that reaches it, and who sees it.
- Closing section: `## Rationale`, with the two strongest reasons for the rating, as concrete
  behavior problems. For a Low rating with no findings, say why the changed behavior is sound.
