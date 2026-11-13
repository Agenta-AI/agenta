---
name: review-simplify
description: Review one code change, or one design (an OpenSpec change or an architecture doc), for needless complexity and rate it Low, Medium, or High. Looks for scope that could be narrower, edge cases that do not deserve machinery, state kept in several places, boundaries that only forward, and code or design parts whose reason to exist is gone. Use when asked to "simplify this diff", "is this overbuilt", "review this PR for simplicity", "review this spec or design for simplicity", or when a review loop runs the simplify lens. Read-only; it reports findings and does not fix them.
---

# Review a change or a design for simplicity

You review one target and report what could be removed or made simpler, and how much it
matters.

Follow `../shared/references/review-contract.md` for the targets, the inputs, the shared
rules, and the report shape. This lens accepts code targets and design targets. A design
target is an OpenSpec change folder (`openspec/changes/<name>/`: proposal, design, specs,
tasks) or one architecture doc.

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

## Rating

- **Low:** nothing to simplify, or only optional suggestions that the owner can take or leave.
- **Medium:** at least one simplification that removes a real obligation, such as a copy of
  state to keep in sync, a mode or route nobody needs, or a duplicate of an existing system.
  The change is still sound without it.
- **High:** the core approach carries complexity that much of the change should not have,
  or the complexity hides a correctness or reliability problem with a reachable trigger.

## Lens rules

- Keep a design when it is already the simplest one that meets the need, and say so.

## Report

- Title: `# Simplify review`.
- What is wrong: what could disappear, and why the result is easier to reason about.
- Smallest fix: also say what behavior or tradeoff it changes.
- Order findings most important first. Severity Low means a suggestion the owner may decline.
- Closing section: `## What to keep` (optional), with the parts of the design that are
  already simple and should stay.
