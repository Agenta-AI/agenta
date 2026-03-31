---
name: scan-codebase
description: Perform a fresh-context codebase scan across both verification and validation lanes. Accept optional `path` and `depth` parameters and default to `path=infer`, `depth=deep`. Confirm effective variables before starting. Use when the agent should orchestrate independent CR and QA scans, preferably via sub-agents, before any triage or resolution work.
---

# Scan Codebase

This is the orchestration wrapper above `cr-scan-codebase` and `qa-scan-codebase`.

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Role

Run two independent scans:

- verification via `cr-scan-codebase`
- validation via `qa-scan-codebase`

Do not collapse them into one mixed review. Keep CR and QA outputs separate.

## Fresh Context Requirement

The CR pass and QA pass should each start from fresh context.

- Do not preload prior findings into either pass.
- Do not let CR findings bias QA findings or the reverse.
- If sub-agents are available, prefer separate sub-agents so each lane starts independently.
- If sub-agents are not available, run the CR and QA passes sequentially, but keep them mentally and structurally separate.

## Depth

Accept a `depth` parameter from the prompt:

- `shallow`
- `deep`

Default:

- `depth=deep`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Workflow

1. Establish scan scope.
   Confirm the effective variables first:
   - `path`
   - `depth`
   - branch, base, subsystem, and any requested focus areas

2. Run the CR scan.
   Invoke the `cr-scan-codebase` workflow with the same `depth`.

3. Run the QA scan.
   Invoke the `qa-scan-codebase` workflow with the same `depth`.

4. Keep findings separate.
   Report CR candidate findings and QA candidate findings as two distinct outputs.

5. Hand off to triage.
   If the user wants a synced findings set, continue with `triage-findings`, `cr-triage-findings`, or `qa-triage-findings` as appropriate.

## Orchestration Rules

- Prefer sub-agents when they are available.
- If sub-agents are not available, emulate the same separation sequentially.
- Do not add new review logic here that duplicates the CR or QA scan skills.
- This skill coordinates; the lane-specific skills own the review logic.
