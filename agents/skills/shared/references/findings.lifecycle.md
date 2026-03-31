# Review Lifecycle

Use the same three-stage lifecycle for CR and QA:

1. `scan-codebase`
2. `triage-findings`
3. `resolve-findings`

## Scan

Scan starts from fresh context.

Before starting, confirm the effective variables.

- Required to confirm:
  - `path` to the local design or findings folder
  - `depth`
  - branch or PR scope when inferable
- `path` may be explicit or inferred
- If `path` is inferred, state the inferred value before proceeding

- Do not anchor on prior findings, PR comments, or old docs before the first independent pass.
- Read code, tests, routes, schemas, migrations, and design docs first.
- Only after the independent pass should you compare against existing findings or review comments.
- Accept a `depth` hint from the user prompt:
  - `shallow`: focus on changed files and immediate neighbors
  - `deep`: follow cross-layer flows, adjacent modules, tests, docs, migrations, and historical review artifacts

Default:

- `depth=deep`
- `path=infer`

## Triage

Triage is the sync stage.

Before starting, confirm the effective variables.

- Required to confirm:
  - `path` to the local design or findings folder
  - `url`
  - branch or PR scope when inferable
- `path` may be explicit or inferred
- If `path` is inferred, state the inferred value before proceeding

- Treat existing findings docs as the master record.
- Pull in open PR comments, review notes, and historical findings.
- Re-check each item against current code or current behavior.
- Update `CR.findings.md` or `QA.findings.md` so they reflect reality now.
- Keep `Notes` and `Open Questions` above the findings sections so unresolved context is not buried.
- When GitHub thread operations are available, resolve or close review threads that are clearly fixed and keep unresolved threads mapped to findings.
- Bias toward clarification, not silent carry-forward:
  - if the user commented on a finding but left the intended disposition, uncertainty, or fix path ambiguous, ask follow-up questions in the same turn
  - do not leave a finding merely `open` or `needs-user-decision` without first asking the concrete question that blocks the next step
  - when multiple findings are ambiguous, batch the questions clearly by finding ID instead of making the user do another discovery loop
- Ask the user to resolve ambiguity when:
  - there are multiple legitimate fix paths
  - reviewer comments conflict
  - a finding looks real but the desired disposition is product or migration policy

Accept a `url` input from the user prompt:

- PR URL provided: remote plus local triage
- omitted URL: local-only triage

Default:

- `url=local-only`
- `path=infer`

## Resolve

Resolve is implementation mode.

Before starting, confirm the effective variables.

- Required to confirm:
  - `path` to the local design or findings folder
  - `priority`
  - target findings files when inferable
- `path` may be explicit or inferred
- If `path` is inferred, state the inferred value before proceeding

- Assume curated findings are confirmed and ready to act on.
- Assume the intended plan or disposition has already been chosen.
- If the plan is not clear, or the finding still needs triage, stop and ask the user before coding.
- Bias toward readiness checks:
  - when the user has already responded to findings, convert any remaining ambiguity into direct follow-up questions immediately
  - do not start implementation while the intended resolution path, mutability rule, compatibility policy, or scope boundary is still underspecified
- Implement the fix, add verification or validation coverage, and update status artifacts.
- Preserve document ordering when updating artifacts:
  - keep `Notes` and `Open Questions` above `Open Findings`
  - move findings between `Open Findings` and `Closed Findings` as status changes

Accept a `priority` input from the user prompt:

- omitted priority: resolve the highest remaining priority bucket only, in order `P0`, `P1`, `P2`, `P3`
- explicit level: resolve only that bucket, for example `P2`
- `all`: resolve all remaining buckets

Default:

- `priority=next-highest`
- `path=infer`

## CR vs QA

CR is verification of code and design:

- correctness
- consistency
- completeness
- soundness
- functionality
- security
- performance
- compatibility
- migration safety

QA is validation of behavior and readiness:

- user-visible flows
- acceptance criteria
- scenario coverage
- environment or rollout behavior
- reproducibility of failures
