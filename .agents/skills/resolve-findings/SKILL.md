---
name: resolve-findings
description: Resolve findings by implementing the chosen fix path in code, tests, or docs. Accept optional `path` and a `priority` selector; by default resolve only the next highest remaining priority bucket, in order `P0`, `P1`, `P2`, `P3`. Also accept explicit levels or `all`. Default to `path=infer`. Confirm effective variables before starting.
---

# Resolve Findings

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Role

Resolve is execution mode from findings back into code, tests, and docs.

- It may change production code for verification findings.
- It may change tests or test harnesses for validation findings.
- It should update the active findings record after implementation and rerun targeted checks when feasible.

## Priority Input

Accept a `priority` parameter from the prompt:

- omitted priority: resolve the next highest remaining bucket only
- explicit level: `P0`, `P1`, `P2`, or `P3`
- `all`: resolve all remaining buckets

Default:

- `priority=next-highest`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Workflow

1. Determine the selected bucket.
   Confirm the effective variables first:
   - `path`
   - `priority`
   - target findings files when inferable

   Use the requested `priority`, or the next highest unresolved bucket in the active findings record.

2. Load the active findings record.
   Use `path/findings.md`.

3. Check readiness before coding.
   If the intended resolution path, policy boundary, or data contract is still ambiguous, ask the next follow-up question before editing.

4. Implement the selected fixes.
   Make the smallest coherent set of code, test, and doc changes needed for the selected findings bucket.

5. Re-run targeted checks.
   Use the narrowest useful verification or validation pass that demonstrates the fix.

6. Update the findings record.
   Move findings between open and closed sections, preserve notes and open questions ordering, and record what was fixed or what remains blocked.

## Rules

- Do not hide ambiguity behind `open` or `needs-user-decision` when the user already started answering. Ask the next concrete question.
- Do not silently widen scope from the selected priority bucket unless the fix is tightly coupled.
