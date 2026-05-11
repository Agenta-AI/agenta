---
name: triage-findings
description: Coordinate findings work with the user, decide whether scan, test, or sync should run, and turn the current findings set into a ready plan. Accept optional `path` and GitHub PR `url`; default to `path=infer`. Confirm effective variables before starting.
---

# Triage Findings

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Role

Triage is the planning and clarification layer across findings work.

- Decide whether the next step is `scan-codebase`, `test-codebase`, `sync-findings`, or `resolve-findings`.
- Read the active findings record and current code or docs as needed.
- Ask the next concrete follow-up questions instead of leaving ambiguity buried in statuses.

## URL Input

Accept an optional GitHub PR `url` from the prompt.

- If a PR URL is provided, use it when triage needs GitHub context or should invoke `sync-findings`.
- If no URL is provided, stay local-only unless the user adds remote context.

Default:

- `url=local-only`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Workflow

1. Establish triage scope.
   Confirm the effective variables first:
   - `path`
   - `url`
   - branch, PR URL if present, current findings file, and any focus areas

2. Load the active findings record.
   Use `path/findings.md`.

3. Decide what is missing.
   Determine whether the next need is:
   - more review via `scan-codebase`
   - more validation via `test-codebase`
   - findings or GitHub reconciliation via `sync-findings`
   - direct implementation via `resolve-findings`

4. Surface decisions and blockers.
   Present open questions, competing fix paths, policy ambiguity, and missing confirmations clearly.
   If the user has already started answering, ask the next concrete follow-up questions in the same turn.

5. Produce a ready plan.
   End triage with a concrete next step, not a vague status-only handoff.

## Rules

- Triage is discussion and planning, not silent execution by default.
- Do not hide ambiguity behind `open` or `needs-user-decision`.
- Do not force a CR or QA label when the user wants one shared findings workflow.
