---
name: triage-findings
description: Triage findings across both verification and validation lanes. Accept optional `path` and GitHub PR `url`; when provided, triage against both remote PR state and local state, otherwise default to local-only triage. Default to `path=infer`. Confirm effective variables before starting. Use when the agent should orchestrate independent CR and QA triage and keep `CR.findings.md` and `QA.findings.md` in sync.
---

# Triage Findings

This is the orchestration wrapper above `cr-triage-findings` and `qa-triage-findings`.

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Role

Run two independent triage passes:

- verification via `cr-triage-findings`
- validation via `qa-triage-findings`

Keep `CR.findings.md` and `QA.findings.md` separate even when both are updated in one run.

## URL Input

Accept an optional GitHub PR `url` from the prompt.

- If a PR URL is provided, do remote plus local triage in both lanes.
- If no URL is provided, do local-only triage in both lanes.

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
   - branch, PR URL if present, and any focus areas

2. Run CR triage.
   Invoke `cr-triage-findings` with the same `url` behavior.

3. Run QA triage.
   Invoke `qa-triage-findings` with the same `url` behavior.

4. Surface decisions.
   Collect `needs-user-decision` items from both lanes and present them clearly.
   If the user has already commented on those findings, turn the remaining uncertainty into explicit follow-up questions in the same turn instead of stopping at a status label.

5. Keep master files synced.
   Ensure `path/CR.findings.md` and `path/QA.findings.md` reflect current code, current local docs, and remote PR state when applicable.

## Orchestration Rules

- Prefer sub-agents when they are available.
- If sub-agents are not available, run the CR and QA triage passes sequentially.
- Do not merge CR and QA findings into one combined master document.
- This skill coordinates; the lane-specific skills own triage logic.
