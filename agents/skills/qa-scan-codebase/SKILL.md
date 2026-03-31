---
name: qa-scan-codebase
description: Perform a full codebase inspection for validation-oriented QA. Accept optional `path` and `depth` parameters and default to `path=infer`, `depth=deep`. Confirm effective variables before starting. Use when the agent needs to scan a branch, feature, or release candidate for user-flow risks, acceptance-criteria gaps, rollout hazards, missing scenario coverage, or likely regressions before triaging or resolving QA findings.
---

# QA Scan Codebase

Scan the codebase as validation work. The goal is to discover where user-visible behavior, scenarios, or release readiness are most likely to fail.

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## What This Skill Does

Perform a broad inspection across:

- changed code and related feature surfaces
- QA docs and validation protocols
- tests and missing scenario coverage
- feature flags, rollout assumptions, and environment seams
- prior QA findings and validation notes

This scan should identify where validation effort should concentrate and which failures are likely enough to formalize as findings or checklist gaps.

## Fresh Context Requirement

Start from a fresh context and avoid anchoring bias.

- Do not begin with old QA findings, review comments, or prior validation summaries.
- Perform an independent pass through the code, tests, flags, async paths, and design docs first.
- Only after that pass may you compare against historical QA artifacts.

## Depth

Accept an explicit or implicit `depth` parameter from the prompt:

- `shallow`: inspect changed feature surfaces, key flows, and immediate tests
- `deep`: inspect cross-feature flows, environment seams, flags, async workers, rollout docs, historical QA artifacts, and missing scenario coverage

Default:

- `depth=deep`

## Path Input

Accept an optional `path` from the prompt.

- If `path` is provided, use it as the local design or findings folder for source docs and outputs.
- If `path` is omitted, infer it from the branch, subsystem, or matching docs and state the inferred value before starting.

Default:

- `path=infer`

## Workflow

1. Establish validation scope.
   Confirm the effective variables first:
   - `path`
   - `depth`
   - feature, branch, deployment phase, environments, and critical user journeys when inferable

2. Map user-visible surfaces.
   Identify routes, pages, API entrypoints, jobs, background processing, and feature flags that affect behavior.

3. Perform an independent first pass.
   Inspect code and tests without consulting prior QA output.

4. Inspect validation seams.
   Look for fragile boundaries such as:
   - before/after migration behavior
   - EE vs OSS differences
   - feature-flag gating
   - async flows and eventual consistency
   - environment-specific config
   - manual flows with no automation

5. Compare implementation to expected flows.
   Cross-check design docs, QA protocols, product notes, and existing acceptance steps.

6. Inspect across core review dimensions.
   Prioritize:
   - correctness
   - consistency
   - completeness
   - soundness
   - functionality
   - security
   - performance

   Translate them into validation risks such as:
   - broken user journeys
   - acceptance criteria not obviously covered
   - missing scenario coverage
   - setup or precondition ambiguity
   - rollout or upgrade hazards
   - gaps between automated tests and real workflow behavior

7. Compare against historical QA artifacts.
   Only now read:
   - `docs/design*/**/QA.md`
   - `docs/design*/**/qa.md`
   - `docs/design*/**/findings.md`
   - related design docs for expected user flows or before/after rollout procedures

   Use them to detect missed scenarios, duplicates, and already-known risks.

8. Verify whether issues are QA, CR, or both.
   Keep user-flow and validation problems in QA. Hand pure implementation verification issues to CR.

9. Hand off to triage.
   Produce candidate findings or scenario gaps in a shape that `qa-triage-findings` can normalize directly, or write provisional entries into `QA.findings.md` when the user explicitly asks for a master findings document.

## Scanning Rules

- Think in scenarios, not just files.
- Track preconditions, environment assumptions, and feature flags.
- Prefer explicit repro paths over vague concerns.
- Treat missing automation as a risk signal, not automatic proof of failure.
- Note where validation should be manual, automated, or both.
- Distinguish confirmed failures from unvalidated-but-risky scenarios.

## Candidate Output Shape

Capture each likely finding or gap with:

- provisional ID
- severity
- confidence
- status
- area
- preconditions
- steps
- expected behavior
- observed or predicted risk
- evidence
- files
- cause
- explanation
- suggested validation or fix
- alternatives

Use `candidate` as the default status during scan.

## What Belongs In QA vs CR

Use this skill for validation-oriented scanning:

- end-to-end flows
- acceptance criteria
- regression-prone scenarios
- rollout and environment behavior
- gaps in scenario coverage

If the task is primarily about static implementation correctness, API contracts, or migration verification, use `cr-scan-codebase` instead.
