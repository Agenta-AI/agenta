---
name: test-codebase
description: Run or inspect the relevant validation paths and turn failures, regressions, or missing coverage into findings. Accept optional `path` and `depth` parameters and default to `path=infer`, `depth=deep`. Confirm effective variables before starting.
---

# Test Codebase

Read these shared references when needed:

- `../shared/references/findings.schema.md`
- `../shared/references/findings.lifecycle.md`

## Role

Run validation-oriented testing work and convert the result into findings.

- Use existing tests, targeted repro steps, docs, and runtime behavior.
- Prefer the smallest test or repro surface that can validate the suspected behavior.
- If the environment prevents execution, record that limitation explicitly and turn the blocked validation gap into a finding instead of pretending the test ran.

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

1. Establish validation scope.
   Confirm the effective variables first:
   - `path`
   - `depth`
   - relevant test environment or constraints
   - branch, subsystem, and any requested focus areas

2. Choose the validation surface.
   Use existing tests first when they are relevant.
   Add targeted repro or smoke execution when that is the shortest way to validate behavior.

3. Run or inspect.
   Execute the chosen tests or repro steps when possible.
   If execution is blocked, record the blocker and its impact explicitly.

4. Turn outcomes into findings.
   Capture broken behavior, flaky behavior, missing coverage, missing assertions, environment gaps, and rollout risks in the active findings record.

5. Update the active findings record.
   Use `path/findings.md`.

6. Hand off when review or implementation is needed.
   Use `triage-findings` for follow-up questions and planning.
   Use `resolve-findings` when the intended fix path is clear.

## Rules

- This skill is validation-oriented.
- Do not treat static code reading as test execution.
- Do not overrun the whole suite when a narrow validation pass is enough.
