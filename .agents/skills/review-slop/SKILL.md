---
name: review-slop
description: Review one code change for agent slop and rate it Low, Medium, or High. Slop is avoidable, low-trust work that comes from not understanding the repo, such as wrong assumptions, broken flows, duplicate systems, weak tests, comment noise, and leftover dead code. Use when asked to "review this diff for slop", "check this PR for slop", "is this change sloppy", or when a review loop runs the slop lens. Read-only; it reports findings and does not fix them.
---

# Review a change for slop

You review one change and report how much slop it adds. You do not edit code, and you do
not post anything.

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

Read `lens.md` in this skill's directory and apply it. It defines slop, what to look for, and
how to choose the rating.

## Rules

- Read-only. Do not install dependencies, and do not run builds, type checks, linters, or
  tests. Judge tests by reading them next to the code they test.
- Judge the final diff, not the commit history.
- Do not charge the change for problems in code it does not touch.
- Raise a finding only with a concrete trigger you can reach, or a clear maintenance cost.

## Output format

Write the report in plain English, in exactly this shape:

```markdown
# Slop review

Base: <base sha>
Head: <head sha>

## Findings

### 1. <one-line title>
- Severity: High | Medium | Low
- Where: <file>:<line> (more locations if needed)
- What is wrong: <the behavior or maintenance problem, and how to reach it>
- Smallest fix: <the smallest change that removes the problem>

(more findings, most severe first; write "No findings." if there are none)

## Rationale

<the two strongest reasons for the rating, as concrete behavior or architecture problems>

Rating: Low | Medium | High
```

The last line must be `Rating: <value>` with nothing after it, so a script can read it.
