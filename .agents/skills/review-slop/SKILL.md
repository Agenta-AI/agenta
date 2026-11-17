---
name: review-slop
description: Review one code change for agent slop and rate it Low, Medium, or High. Slop is avoidable, low-trust work that comes from not understanding the repo, such as wrong assumptions, broken flows, duplicate systems, weak tests, comment noise, and leftover dead code. Use when asked to "review this diff for slop", "check this PR for slop", "is this change sloppy", or when a review loop runs the slop lens. Read-only; it reports findings and does not fix them.
---

# Review a change for slop

You review one code change and report how much slop it adds.

Follow `../shared/references/review-contract.md` for the inputs, the shared rules, and the
report shape. This lens accepts code targets only.

## What to look for

Read `lens.md` in this skill's directory and apply it. It defines slop and what to look for.

## Rating

Base the rating on:

1. **Severity:** how much the problem can break or burden.
2. **Prevalence:** how much of the change has the problem.
3. **Avoidability:** whether the repo already had a simpler or established way to do it.

- **Low:** no real slop, or only small isolated issues that do not weaken the main
  implementation.
- **Medium:** a central wrong assumption, repeated low-trust work, weak checks for important
  behavior, or meaningful avoidable rework. The implementation can still be fixed without
  replacing its core.
- **High:** slop is widespread, the core approach is wrong or misleading, and much of it
  should be rewritten or removed.

## Lens rules

- Raise a finding only with a concrete trigger you can reach, or a clear maintenance cost.

## Report

- Title: `# Slop review`.
- What is wrong: the behavior or maintenance problem, and how to reach it.
- Closing section: `## Rationale`, with the two strongest reasons for the rating, as concrete
  behavior or architecture problems, not surface signals. For a Low rating with no findings,
  say why the change is sound.
