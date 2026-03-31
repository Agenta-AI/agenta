---
name: resolve-findings
description: Resolve findings across both verification and validation lanes. Accept optional `path` and a `priority` selector; by default resolve only the next highest remaining priority bucket, in order `P0`, `P1`, `P2`, `P3`. Also accept explicit levels or `all`. Default to `path=infer`. Confirm effective variables before starting. Use when the agent should orchestrate independent CR and QA resolution while keeping the two lanes separate.
---

# Resolve Findings

This is the orchestration wrapper above `cr-resolve-findings` and `qa-resolve-findings`.

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Role

Run two independent resolve passes:

- verification via `cr-resolve-findings`
- validation via `qa-resolve-findings`

Keep CR and QA resolution separate even when both run in the same turn.

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

   Use the requested `priority`, or the next highest unresolved bucket across `CR.findings.md` and `QA.findings.md`.

2. Run CR resolution for that bucket when CR findings exist in it.

3. Run QA resolution for that bucket when QA findings exist in it.

4. Coordinate execution safely.
   Run in parallel only when the write scopes are disjoint and sub-agents are available. Otherwise sequence the two passes.

5. Update both master files.
   Keep `CR.findings.md` and `QA.findings.md` accurate after resolution.

6. Surface unresolved decisions before coding.
   If either lane still has findings whose intended resolution is not implementation-ready, ask those follow-up questions before starting the corresponding lane.

## Orchestration Rules

- Prefer sub-agents when they are available.
- If sub-agents are not available, run the two passes sequentially.
- Do not let one lane silently absorb the other.
- This skill coordinates; the lane-specific skills own resolution logic.
- Do not hide ambiguity behind `open` or `needs-user-decision` when the user already started answering. Ask the next concrete question.
