---
name: scan-codebase
description: Perform a fresh-context scan of code and docs that turns verification observations and missing-test gaps into findings. Accept optional `path` and `depth` parameters and default to `path=infer`, `depth=deep`. Confirm effective variables before starting.
---

# Scan Codebase

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Role

Run a fresh review pass from code and docs into findings.

- This skill is verification-oriented.
- It may surface missing tests or coverage gaps as findings.
- It does not rely on existing findings as the starting point.
- It does not replace `test-codebase`; if runtime validation is needed, hand off there.

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

2. Start from fresh context.
   Read current code, docs, tests-as-code, routes, schemas, migrations, and adjacent design material before looking at existing findings.

3. Produce findings from review.
   Surface correctness, consistency, completeness, soundness, functionality, security, performance, compatibility, migration, and missing-test findings when supported by evidence.

4. Update the active findings record.
   Use `path/findings.md`.

5. Hand off when execution is needed.
   Use `triage-findings` for discussion and planning, `test-codebase` for validation, and `resolve-findings` for implementation.

## Rules

- Bias toward deep inspection, not prior-thread anchoring.
- Do not silently preload old findings into the initial reasoning path.
- Do not present test execution as completed if you only inferred missing coverage from code.
