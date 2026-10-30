---
name: review-simplify
description: Review one code change, or one design (an OpenSpec change or an architecture doc), for needless complexity and rate it Low, Medium, or High. Looks for scope that could be narrower, edge cases that do not deserve machinery, state kept in several places, boundaries that only forward, and code or design parts whose reason to exist is gone. Use when asked to "simplify this diff", "is this overbuilt", "review this PR for simplicity", "review this spec or design for simplicity", or when a review loop runs the simplify lens. Read-only; it reports findings and does not fix them.
---

# Review a change or a design for simplicity

You review one target and report what could be removed or made simpler, and how much it
matters. You do not edit code or documents, and you do not post anything.

## Targets

The caller names one target.

- **Code (default).** A diff between two commits.
- **Design.** An OpenSpec change folder (`openspec/changes/<name>/`: proposal, design,
  specs, tasks) or one architecture doc. No code exists yet, or the code is not the subject.

## Inputs

The caller gives you these. If the caller leaves one out, work it out and say what you used.

For a code target:

- **Checkout path.** A checkout of the repo at the head commit. Read code there.
- **Base.** The commit the change starts from. For a PR, use the merge base of the PR head
  and its base branch, never the current tip of the base branch.
- **Head.** The last commit of the change.

Read the change with `git -C <checkout> diff <base> <head>`. Add `-- <path>` to read one file.

For a design target:

- **Checkout path.** A checkout of the repo the design applies to. Read today's code there,
  so you can check what the design claims about today and what it would add.
- **Design path.** The spec folder or the doc. Read every file in it.
- **Version.** The commit or date of the design, so the report names what you read.

For both:

- **Context file (optional).** Decisions that are already settled: findings that were fixed,
  rejected with a reason, or deferred, and product rules from the owner. Do not raise a
  settled point again unless the fix is wrong or incomplete. Then say why.

## What to look for

Read `lens.md` in this skill's directory and apply it. It explains how to judge scope, edge
cases, coordination, and the shape of the code.

For a design target, apply the lens to what the design would build:

- Scope. Compare the user outcome in the proposal with the mechanism in the design. Name a
  narrower contract that meets the same outcome.
- Requirements and scenarios that add machinery for a rare case. Ask whether a documented
  limit or a refusal is enough.
- New stores, flags, services, queues, settings, or routes. Ask whether existing state or an
  existing component can do the job.
- Interfaces. Fields that copy each other, or a boundary that only forwards.
- Tasks. Work whose only purpose is to support a part you suggest removing.

## Rules

- Read-only. Do not install dependencies, and do not run builds, type checks, linters, or
  tests.
- Review the target, not the code around it. Existing code counts only where the target adds
  to it or depends on it.
- Prefer a few substantial findings to a list of style nits.
- Keep a design when it is already the simplest one that meets the need, and say so.

## Rating

- **Low:** nothing to simplify, or only optional suggestions that the owner can take or leave.
- **Medium:** at least one simplification that removes a real obligation, such as a copy of
  state to keep in sync, a mode or route nobody needs, or a duplicate of an existing system.
  The change is still sound without it.
- **High:** the core approach carries complexity that much of the change should not have,
  or the complexity hides a correctness or reliability problem with a reachable trigger.

## Output format

Write the report in plain English, in exactly this shape:

```markdown
# Simplify review

Base: <base sha, or "design" for a design target>
Head: <head sha, or "<design path> at <commit or date>" for a design target>

## Findings

### 1. <one-line title>
- Severity: High | Medium | Low
- Where: <file>:<line> (more locations if needed; for a design, the spec file and heading)
- What is wrong: <what could disappear, and why the result is easier to reason about>
- Smallest fix: <the smallest change, and what behavior or tradeoff it changes>

(more findings, most important first; write "No findings." if there are none)

## What to keep

<parts of the design that are already simple and should stay; optional>

Rating: Low | Medium | High
```

Severity Low means a suggestion the owner may decline. The last line must be
`Rating: <value>` with nothing after it, so a script can read it.
