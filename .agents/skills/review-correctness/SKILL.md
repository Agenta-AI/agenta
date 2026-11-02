---
name: review-correctness
description: Review one code change for correctness and rate it Low, Medium, or High. Looks for bugs, regressions in existing behavior, broken flows, concurrency and retry problems, and migrations that can fail or lose data. Use when asked to "review this PR for bugs", "check this diff for regressions", "is this change correct", or when a review loop runs the correctness lens. Read-only; it reports findings and does not fix them.
---

# Review a change for correctness

You review one change and report what it breaks or can break, and how much it matters. You
do not edit code, and you do not post anything.

## Inputs

The caller gives you these. If the caller leaves one out, work it out and say what you used.

- **Checkout path.** A checkout of the repo at the head commit. Read code there.
- **Base.** The commit the change starts from. For a PR, use the merge base of the PR head
  and its base branch, never the current tip of the base branch.
- **Head.** The last commit of the change.
- **Context file (optional).** Decisions that are already settled: findings that were fixed,
  rejected with a reason, or deferred, and product rules from the owner. Do not raise a
  settled point again unless the fix is wrong or incomplete. Then say why.

Read the change with `git -C <checkout> diff <base> <head>`. Add `-- <path>` to read one file.

## What to look for

Read `lens.md` in this skill's directory and apply it.

## Rules

- Read-only. Do not install dependencies, and do not run builds, type checks, linters, or
  tests. Judge tests by reading them next to the code they test.
- Judge the final diff, not the commit history.
- Do not charge the change for problems in code it does not touch, unless the change makes
  an existing problem reachable.
- Raise a finding only with a concrete trigger you can reach. Say which input, state, or
  timing reaches it. Mark a finding you could not confirm as a hypothesis, and say what
  would confirm it.

## Output format

Write the report in plain English, in exactly this shape:

```markdown
# Correctness review

Base: <base sha>
Head: <head sha>

## Findings

### 1. <one-line title>
- Severity: High | Medium | Low
- Where: <file>:<line> (more locations if needed)
- What is wrong: <the wrong behavior, the trigger that reaches it, and who sees it>
- Smallest fix: <the smallest change that removes the problem>

(more findings, most severe first; write "No findings." if there are none)

## Rationale

<the two strongest reasons for the rating, as concrete behavior problems>

Rating: Low | Medium | High
```

The last line must be `Rating: <value>` with nothing after it, so a script can read it.
