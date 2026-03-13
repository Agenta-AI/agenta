# Workflows Investigation

## Purpose

Capture production-data findings for workflow revisions while validating the runnable design and migration assumptions.

## Scope

- Table under investigation: `workflow_revisions`
- Main columns investigated so far:
  - `flags`
  - `data`
  - `version`

## Findings

### Flags are fully populated and legacy-shaped

Query outcome:

- `flags IS NULL` or `flags = '{}'::jsonb`: `0`
- Capability flags present:
  - `can_stream`: `0`
  - `can_evaluate`: `0`
  - `can_chat`: `0`
  - `can_verbose`: `0`

Legacy flag shapes observed after data patch:

- `{"is_chat": false, "is_human": false, "is_custom": false, "is_evaluator": true}`: `79604`
- `{"is_chat": false, "is_human": false, "is_custom": false, "is_evaluator": false}`: `36294`
- `{"is_chat": true, "is_human": false, "is_custom": false, "is_evaluator": false}`: `13614`
- `{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}`: `3106`
- `{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": false}`: `1852`
- `{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}`: `903`

Interpretation:

- Production flags are fully populated.
- Production flags are still entirely legacy identity flags.
- Capability flags are not yet present in stored production data.

### Revision data is mixed across flat, nested, and null states

Field presence counts in `data`:

- `uri`: `90977`
- `url`: `52555`
- `headers`: `1704`
- `schemas`: `41674`
- `script`: `2007`
- `parameters`: `74365`
- `service`: `43019`
- `configuration`: `23709`

Important result:

- `data IS NULL`: `40017`

Interpretation:

- Production is not all-flat and not all-nested.
- Flat normalized fields already exist at significant scale.
- Legacy nested `service` / `configuration` also still exist at significant scale.
- `data IS NULL` is a material migration bucket.

### Sampled row patterns confirm real coexistence

Observed sample categories:

- Flat and nested coexist:
  - rows with `uri` + `schemas` + `parameters`
  - plus nested `service.format`
  - plus nested `configuration`
- Nested-only or mostly nested:
  - rows with only nested `service`
  - and flat fields null or absent
- Flat-only:
  - rows with `uri` + `url` + `parameters`
  - and no nested `service` / `configuration`

Interpretation:

- Flat fields are already real production truth for many revisions.
- Nested fields still matter for many revisions.
- Migration cannot assume a single current storage shape.

### Null data is tied to version `0`

Hypothesis tested:

- `data IS NULL` rows where `version = '0'`: `40017`
- `data IS NULL` rows where `version <> '0'`: `0`

Interpretation:

- All currently observed null-data rows are version `0`.
- So `data IS NULL => version = '0'`.

### Version `0` does not imply null data

Follow-up test:

- all rows with `version = '0'`: `54416`
- rows with `version = '0'` and `data IS NOT NULL`: `14399`

Interpretation:

- `version = '0'` is necessary for the null-data bucket, but not sufficient.
- So the null-data bucket is a subset of the version-`0` bucket.

### Most version `0` rows are null, and most non-null ones are flat-only

Split within version `0`:

- `data_null`: `40017`
- `data_present`: `14399`

Dominant storage shapes among `version = '0'` rows with non-null data:

- `has_uri=true, has_url=true, has_schemas=false, has_parameters=true, has_service=false, has_configuration=false`: `13412`
- `has_uri=false, has_url=true, has_schemas=false, has_parameters=false, has_service=false, has_configuration=false`: `738`
- `has_uri=true, has_url=true, has_schemas=true, has_parameters=true, has_service=true, has_configuration=true`: `119`
- `has_uri=true, has_url=false, has_schemas=false, has_parameters=true, has_service=false, has_configuration=false`: `88`
- `has_uri=false, has_url=false, has_schemas=false, has_parameters=true, has_service=false, has_configuration=false`: `42`

Interpretation:

- Version `0` is largely a legacy bucket, but not a purely empty one.
- The non-null portion of version `0` is overwhelmingly flat-only, especially:
  - `uri`
  - `url`
  - `parameters`
  - without nested `service` / `configuration`
- Only a very small fraction of version-`0` rows show full flat+nested coexistence.
- This suggests version `0` spans at least two populations:
  - older null-data legacy rows
  - flat-populated pre-revision or compatibility rows

### There is no simple historical cutoff for null data

Created-at range for null-data rows:

- first `created_at`: `2025-05-15 09:24:48.373084+00`
- last `created_at`: `2026-03-13 11:27:39.362602+00`

Created-at range for `version = '0'` rows with non-null data:

- first `created_at`: `2024-01-31 09:37:43.321+00`
- last `created_at`: `2026-03-13 12:39:21.179796+00`

Interpretation:

- Null-data rows are not confined to an old historical window.
- Null-data rows were still being created as of `2026-03-13`.
- The non-null version-`0` population starts earlier, but both populations overlap into the present.
- So the issue is not explained by a simple date cutoff alone.

### Null-data rows are overwhelmingly evaluator-shaped

Flag breakdown for `data IS NULL`:

- `{"is_chat": false, "is_human": false, "is_custom": false, "is_evaluator": true}`: `38380`
- `{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}`: `1517`
- `{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}`: `106`
- `{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": false}`: `12`
- `{"is_chat": false, "is_human": false, "is_custom": false, "is_evaluator": false}`: `2`

Interpretation:

- The null-data bucket is overwhelmingly evaluator-shaped.
- Most null-data rows are builtin evaluators.
- Human evaluators also contribute, but at much smaller scale.
- Non-evaluator null-data rows are almost nonexistent.

### Rare non-evaluator null-data rows are initial custom workflow commits

Full-row inspection of the non-evaluator `data IS NULL` cases shows:

- almost all are `is_custom=true, is_evaluator=false`
- a tiny remainder are `is_custom=false, is_evaluator=false`
- all observed rows have:
  - `version = '0'`
  - `message = 'Initial commit'`
  - `data IS NULL`

Representative examples include user-created workflows such as:

- `RAG Trace Eval Demo`
- `RAG QA Chatbot`
- `Capital Finder`
- `my_application`

Interpretation:

- The rare non-evaluator null-data rows do not look random.
- They look like initial workflow creation records written without populated revision `data`.
- This is likely a workflow/application creation path issue, distinct from the dominant evaluator-related null-data path.

Follow-up confirmation:

- non-evaluator `data IS NULL` rows grouped by `message`:
  - `Initial commit`: `14`

Interpretation:

- All currently observed non-evaluator null-data rows are initial commits.
- So the non-evaluator null-data population is not heterogeneous.
- It is a small, specific creation-path pattern.

## Code Findings

### Generic revision creation omits `data`

The low-level Git DAO `create_revision(...)` path constructs a `Revision` with `message="Initial commit"` and does not assign `data`.

Reference:

- [dao.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/dbs/postgres/git/dao.py#L837)

Implication:

- Any flow that uses `create_revision(...)` instead of `commit_revision(...)` will create an initial revision with null `data`.

### Workflow/application/evaluator `create_*_revision(...)` routes hit the null-data path

These service methods convert domain-specific `*RevisionCreate` payloads into `WorkflowRevisionCreate`, then call `workflows_service.create_workflow_revision(...)`, which delegates into the low-level `create_revision(...)` path above.

References:

- [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/workflows/service.py#L467)
- [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/applications/service.py#L495)
- [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/service.py#L489)

Implication:

- Any caller that uses the `create_*_revision(...)` API family will produce an initial revision with null `data`.

### Simple application and simple evaluator create flows explicitly commit null `data` first

The newer simple create flows do not rely on the low-level create path. They explicitly perform an initial commit with `data=None`, then perform a second commit with populated data.

References:

- Application initial empty commit:
  - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/applications/service.py#L941)
- Application follow-up populated commit:
  - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/applications/service.py#L962)
- Evaluator initial empty commit:
  - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/service.py#L1025)
- Evaluator follow-up populated commit:
  - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/service.py#L1056)

Implication:

- The dominant evaluator-shaped null-data population is directly explained in code.
- The small non-evaluator initial-commit null-data population is also consistent with the application/workflow creation patterns.

### Legacy adapter paths can create `Initial commit` revisions with non-null `data`

The legacy adapter has creation paths that commit populated revision data in a single `Initial commit`.

References:

- Create variant from parameters with `message=commit_message or "Initial commit"` and populated `data`:
  - [legacy_adapter.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/services/legacy_adapter.py#L360)
- Create variant from URL with `message=commit_message or "Initial commit"` and populated `data`:
  - [legacy_adapter.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/services/legacy_adapter.py#L840)
- Variant creation path that explicitly creates `v0` with non-null URL-only data, then `v1` with parameters:
  - [legacy_adapter.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/services/legacy_adapter.py#L1120)

Implication:

- The observed version-`0` rows with non-null flat data are plausibly explained by legacy adapter flows.
- Not all `Initial commit` rows imply null `data`; some legacy creation paths intentionally commit populated `data` at `v0`.

### Legacy adapter creation paths were aligned to null-data `Initial commit`

The legacy adapter has now been changed so its creation paths match the newer simple create flows:

- v0 always writes:
  - `message = "Initial commit"`
  - `data = None`
- the follow-up populated revision writes:
  - actual `data`
  - caller-provided `commit_message` when present

Updated implementation references:

- [legacy_adapter.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/services/legacy_adapter.py#L373)
- [legacy_adapter.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/services/legacy_adapter.py#L398)
- [legacy_adapter.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/services/legacy_adapter.py#L885)
- [legacy_adapter.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/services/legacy_adapter.py#L911)

Implication:

- Going forward, the legacy adapter should stop producing populated `Initial commit` workflow revisions in those paths.
- Existing production rows still reflect the pre-fix mixed behavior.

### Null-data revisions are not the latest revision for affected artifacts

Query result for artifacts that have at least one null-data revision:

- `latest_is_not_null`: `40017`

Interpretation:

- Every artifact with a null-data revision currently has a newer latest revision with non-null data.
- The null-data revisions are therefore historical lineage entries, not current discovery truth.
- This substantially lowers the risk of read-time breakage for latest-revision flows, while still leaving migration and historical-query consistency concerns.

### Nested `service` can exist without flat `uri`

Query result for rows where nested `service` exists and flat `uri` is missing:

- count: `1534`
- first `created_at`: `2025-05-15 09:24:48.458103+00`
- last `created_at`: `2026-03-13 11:27:39.386216+00`

Sampled rows show a recurring pattern:

- `version = '1'`
- `data.service.agenta = 'v0.1.0'`
- `data.service.format.properties.outputs` contains an output schema
- no flat `uri`

Representative sampled output shape:

- `outputs.approved: boolean`

Interpretation:

- There is a live population where `service` is carrying runtime/schema information without flat `uri`.
- These are not only old rows; they continue up to the present.
- This strengthens the case that nested `service` cannot yet be dropped blindly.

### Most `service`-only rows are default human evaluators; the remainder is still evaluator-shaped

Within the `service` present + no `uri` + no `schemas` population (`1531` rows):

- `1367` match the default human evaluator `approved: boolean` shape
- `164` do not match that exact shape

The non-default remainder is still overwhelmingly evaluator-shaped:

- `{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}`: `158`
- `{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}`: `6`

Sampled non-default rows show custom output schemas still stored only under `service.format.properties.outputs`, for example:

- `result: string`
- `feedbackname: integer`
- `decision: enum`
- `quality + note`
- multi-field rubric-like outputs

Interpretation:

- The dominant source is the default human evaluator seeding path.
- The smaller remainder is still human/custom evaluator creation or update logic using the old `service.format`-only storage style.
- This is not an application/workflow storage problem; it is concentrated in evaluator-related code paths.

### Evaluator normalization was updated to always populate flat `schemas.outputs`

Code changes applied:

- Added shared helpers to:
  - build the legacy `service.format` wrapper from an outputs schema
  - extract an outputs schema from legacy `service.format`
  - References:
    - [utils.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/utils.py#L21)
    - [utils.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/utils.py#L36)
- Broadened evaluator data normalization so create/edit flows derive `schemas.outputs` from `service.format` even when no builtin `uri` is present:
  - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/service.py#L887)
  - applied on create:
    - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/service.py#L1031)
  - applied on edit:
    - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/service.py#L1321)
- Updated default human evaluator seeding to write `version` + `schemas.outputs` in addition to compatibility `service`:
  - [defaults.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/evaluators/defaults.py#L138)
- Updated annotation-driven evaluator auto-create/edit paths to write `version` + `schemas.outputs` and normalized compatibility `service`:
  - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/annotations/service.py#L105)
  - [service.py](/Users/junaway/Agenta/github/vibes.worktrees/feat-extend-runnables/api/oss/src/core/annotations/service.py#L298)

Implication:

- New evaluator writes should no longer persist `service`-only payloads in these paths.
- Existing historical rows still reflect the older mixed storage behavior.

### Null-data creation is ongoing and bursty

Recent daily counts for `data IS NULL` show continued creation through `2026-03-13`, with visible spikes such as:

- `2026-02-13`: `641`
- `2026-02-24`: `656`
- `2026-03-06`: `371`
- `2026-03-10`: `382`

Interpretation:

- Null-data rows are still being written by active code paths.
- Creation is bursty rather than smooth, suggesting specific flows, jobs, or repeated workflow populations.
- Combined with the flag split, this points most strongly to evaluator-related creation paths.

## Current Migration Read

Current evidence supports this migration rule:

- treat flat normalized fields as canonical when present
- backfill flat fields from nested legacy fields when flat fields are absent
- do not drop nested `service` / `configuration` yet
- treat `data IS NULL` as a distinct migration case
- treat version `0` as a strong legacy marker, but not the whole story

## Current Read Dependencies

Code search shows that legacy nested fields are now read in only a small number of places.

Active reads of `data.service`:

- `api/oss/src/core/annotations/service.py`
  - uses `evaluator_revision.data.service["format"]` for annotation payload validation
- `api/oss/src/core/evaluations/service.py`
  - uses `evaluator_revision.data.service["format"]` as a fallback for metrics-key inference when `schemas.outputs` is absent
- `api/oss/src/core/evaluators/service.py`
  - uses legacy `service.format` to derive flat `schemas.outputs` during normalization
- `api/oss/src/core/workflows/dtos.py`
  - validates legacy `service.format` and `service.url` in the revision DTO validator

Direct runtime reads of `data.configuration` were not found.

The remaining `configuration` reads in the codebase are compatibility or request-shape handling, not revision-data reads:

- `api/oss/src/core/embeds/service.py`
  - normalizes between top-level `parameters` and nested `configuration.parameters`
- `api/oss/src/core/tracing/utils/attributes.py`
  - migrates tracing `meta.configuration` into `data.parameters`
- SDK request models and runners
  - use request-time `configuration`, not persisted revision `data.configuration`

Interpretation:

- `data.service` is no longer broadly depended on, but it is still part of a small set of real runtime and validation paths.
- `data.configuration` has effectively already been displaced by flat `parameters` / `script` in revision-data reads.

## Required Workstreams

Current evidence now points to two separate categories of work.

### 1. Data migration work

We need a migration plan for:

- flags, if target identity/capability flags differ from stored legacy flags
- every flat interface/discovery field:
  - `uri`
  - `url`
  - `headers`
  - `schemas`
- every flat configuration/execution field:
  - `script`
  - `parameters`
- any remaining related normalized fields that participate in the target contract

This migration work needs to be understood field by field against each current legacy storage shape:

- `data IS NULL`
- flat-only rows
- nested-only rows
- mixed flat+nested rows where values match
- mixed flat+nested rows where nested values are stale or divergent
- builtin evaluator rows
- human evaluator rows
- custom evaluator rows
- custom non-evaluator rows

The key migration question is not just whether a row has `service` / `configuration`, but which target flat fields are already present, which are missing, and which can be derived safely.

### 2. Codebase removal work

Separately, we need code changes that fully remove the codebase's dependence on `data.service` and `data.configuration`.

Target state:

- all runtime logic reads only flat fields
- all validation logic reads only flat fields
- all discovery and metrics inference logic reads only flat fields
- nested `service` / `configuration` are no longer used as execution truth

Practical meaning:

- every remaining `data.service` read needs to be rewritten to use flat fields
- any lingering compatibility handling of revision `data.configuration` should be removed once migrations guarantee flat data
- nested fields should become migration input only, not application runtime state

This means the overall program is:

- first understand and implement the necessary data migrations by field and by legacy row shape
- then finish the codebase conversion so all reads rely exclusively on flat fields
- only after both are complete can `data.service` / `data.configuration` be removed safely

## Open Questions

- Which flag shapes dominate the `data IS NULL` bucket?
- Are null-data rows mostly historical, or still being created recently?
- Among `version = '0'` rows with non-null data, what storage shapes dominate?
- Are null-data rows mostly latest revisions or mostly historical revisions?
- Are recent null-data spikes concentrated in a small set of workflow IDs?
- Are all non-evaluator null-data rows specifically initial commits?
