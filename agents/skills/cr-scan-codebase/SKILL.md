---
name: cr-scan-codebase
description: Perform a full codebase inspection for verification-oriented code review. Accept optional `path` and `depth` parameters and default to `path=infer`, `depth=deep`. Confirm effective variables before starting. Use when the agent needs to scan a branch, PR, subsystem, or design implementation for correctness, contract drift, compatibility risks, migration gaps, architectural inconsistencies, or missing regression coverage before triaging or resolving findings.
---

# CR Scan Codebase

Scan the codebase as verification work. The goal is to discover likely implementation defects and review risks before they are curated into a formal findings document.

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## What This Skill Does

Perform a broad but technically grounded inspection across:

- changed code
- nearby unchanged code that defines behavior
- tests and missing tests
- design docs and rollout docs
- prior CR artifacts
- schema, routing, API, and migration surfaces

This is not a lightweight summary pass. Inspect deeply enough to form evidence-backed candidate findings.

## Fresh Context Requirement

Start from a fresh context and avoid anchoring bias.

- Do not begin by reading prior findings, PR comments, or review summaries.
- Perform an independent first-pass inspection of the code, tests, migrations, and design docs.
- Only after that first pass may you compare your candidate findings against existing CR artifacts.

## Depth

Accept an explicit or implicit `depth` parameter from the prompt:

- `shallow`: inspect changed files plus immediate neighbors and key tests
- `deep`: inspect full cross-layer flows, adjacent modules, migrations, docs, historical CR artifacts, and likely latent bug surfaces

Default:

- `depth=deep`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder for source docs and outputs.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Workflow

1. Establish review scope.
   Confirm the effective variables first:
   - `path`
   - `depth`
   - branch, base, PR, and subsystem boundaries when inferable

2. Map the changed surfaces.
   Identify touched packages, routers, services, DAOs, migrations, schemas, tests, SDKs, and docs.

3. Perform an independent first pass.
   Inspect code and tests without consulting prior review output.

4. Expand to adjacent risk surfaces.
   Read neighboring code that defines invariants, call paths, persistence, or compatibility behavior.

5. Compare implementation to intent.
   Check design docs, rollout plans, API contracts, migration notes, and prior review docs for drift.

6. Inspect across core review dimensions.
   Prioritize:
   - correctness
   - consistency
   - completeness
   - soundness
   - functionality
   - security
   - performance

   High-signal defect patterns include:
   - wrong filters or merge order
   - missing permission or scope checks
   - API/DTO/schema drift
   - persistence and migration mismatches
   - stale compatibility shims
   - latent bugs in dormant or low-coverage paths
   - design-doc contradictions
   - missing regression tests around risky behavior

7. Compare against historical review artifacts.
   Only now read:
   - `docs/design*/**/CR.md`
   - `docs/design*/**/CR.findings.md`
   - `docs/design*/**/CR.status.md`
   - `docs/design*/**/*-CR.md`
   - `docs/design*/**/PR.md`

   Use them to detect missed issues, duplicates, or already-resolved risks.

8. Verify candidate findings.
   Use code, tests, type contracts, route wiring, and targeted execution when needed. Do not keep speculative bugs as confirmed findings.

9. Hand off to triage.
   Produce candidate findings in a shape that `cr-triage-findings` can normalize directly, or write provisional entries into `CR.findings.md` when the user explicitly asks for a master findings document.

## Scanning Rules

- Read widely enough to understand invariants, not just the diff hunk.
- Prefer primary code and tests over reviewer commentary.
- Treat comments and prior reviews as leads, not proof.
- Separate code defects from process or product-scope disagreement.
- Flag missing tests when they hide real verification risk.
- Call out latent bugs even if the route or feature is currently dormant, but label the activation condition.

## Candidate Finding Shape

Capture each likely finding with:

- provisional ID
- severity
- confidence
- category
- evidence
- files
- cause
- explanation
- suggested fix
- alternatives
- status

Use `candidate` as the default status during scan. Mark uncertain items as hypotheses until verified.

## What Belongs In CR vs QA

Use this skill for verification-oriented inspection:

- implementation correctness
- compatibility and migration safety
- contract drift
- architectural coherence
- test adequacy for regressions

If the task is mainly about user-flow validation, acceptance scenarios, or environment-specific behavior, use `qa-scan-codebase` instead.
