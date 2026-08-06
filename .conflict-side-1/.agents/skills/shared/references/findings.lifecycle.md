# Findings Lifecycle

Use the same five-stage lifecycle across review and testing work:

1. `scan-codebase`
2. `test-codebase`
3. `sync-findings`
4. `triage-findings`
5. `resolve-findings`

## Scan

Scan starts from fresh context and reads code and docs first.

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
- Scan may surface missing tests or missing validation coverage as findings, but it does not count as running validation.
- Accept a `depth` hint from the user prompt:
  - `shallow`: focus on changed files and immediate neighbors
  - `deep`: follow cross-layer flows, adjacent modules, tests, docs, migrations, and historical review artifacts

Default:

- `depth=deep`
- `path=infer`

## Test

Test is validation work.

Before starting, confirm the effective variables.

- Required to confirm:
  - `path` to the local design or findings folder
  - `depth`
  - test environment or runtime constraints when relevant
  - branch or subsystem scope when inferable
- `path` may be explicit or inferred
- If `path` is inferred, state the inferred value before proceeding

- Run or inspect the smallest relevant validation surface first.
- Prefer targeted tests, repros, or smoke checks over whole-suite execution unless the user asks for broad coverage.
- If validation cannot run because of environment or dependency constraints, record that blocker explicitly and turn the missing validation into a finding when appropriate.

Default:

- `depth=deep`
- `path=infer`

## Sync

Sync keeps findings aligned with local artifacts and GitHub state.

Before starting, confirm the effective variables.

- Required to confirm:
  - `path` to the local design or findings folder
  - `url`
  - branch or PR scope when inferable
- `path` may be explicit or inferred
- If `path` is inferred, state the inferred value before proceeding

- Treat the active findings doc as the master record.
- Pull in open PR comments, review notes, and historical findings.
- Re-check each item against current code or current behavior.
- Keep all non-findings sections, such as `Rules`, `Notes`, and `Open Questions`, above the findings sections so context is not buried.
- When GitHub thread operations are available, resolve or close review threads that are clearly fixed and keep unresolved threads mapped to findings.
- Bias toward clarification, not silent carry-forward:
  - if the user commented on a finding but left the intended disposition, uncertainty, or fix path ambiguous, ask follow-up questions in the same turn
  - do not leave a finding merely `open` or `needs-user-decision` without first asking the concrete question that blocks the next step
  - when multiple findings are ambiguous, batch the questions clearly by finding ID instead of making the user do another discovery loop

Accept a `url` input from the user prompt:

- PR URL provided: remote plus local sync
- omitted URL: local-only sync

Default:

- `url=local-only`
- `path=infer`

## Triage

Triage is the planning and clarification stage.

Before starting, confirm the effective variables.

- Required to confirm:
  - `path` to the local design or findings folder
  - `url`
  - branch or PR scope when inferable
- `path` may be explicit or inferred
- If `path` is inferred, state the inferred value before proceeding

- Treat the active findings doc as the master record.
- Decide whether the next action is more scan work, more test work, a sync pass, or direct resolution.
- Bias toward clarification, not silent carry-forward:
  - if the user commented on a finding but left the intended disposition, uncertainty, or fix path ambiguous, ask follow-up questions in the same turn
  - do not leave a finding merely `open` or `needs-user-decision` without first asking the concrete question that blocks the next step
  - when multiple findings are ambiguous, batch the questions clearly by finding ID instead of making the user do another discovery loop
- Ask the user to resolve ambiguity when:
  - there are multiple legitimate fix paths
  - reviewer comments conflict
  - a finding looks real but the desired disposition is product or migration policy

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
  - keep all non-findings sections above `Open Findings`
  - move findings between `Open Findings` and `Closed Findings` as status changes

Accept a `priority` input from the user prompt:

- omitted priority: resolve the highest remaining priority bucket only, in order `P0`, `P1`, `P2`, `P3`
- explicit level: resolve only that bucket, for example `P2`
- `all`: resolve all remaining buckets

Default:

- `priority=next-highest`
- `path=infer`
