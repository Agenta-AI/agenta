# Workflow Migration

This note isolates the migration-design discussion from the broader investigation log.

Its purpose is to answer, field by field:

- what the target flat contract is
- how each current legacy storage shape migrates into that target
- which parts are already decided
- which parts still require explicit decisions

## Current Framing

The migration program now has two separate workstreams:

1. Data migration work
- migrate stored workflow/evaluator/application revision data into the target flat shape
- understand migration behavior per field and per current legacy row shape

2. Codebase removal work
- remove all runtime dependence on nested legacy fields
- make flat fields the only execution, validation, and discovery truth

This document focuses on the first workstream, while also calling out the code-removal implications where they affect migration design.

## Confirmed Baseline

### Legacy nested read state

Current code search shows:

- `data.service` is still read in a small number of places
- direct runtime reads of `data.configuration` were not found

Remaining `data.service` reads are concentrated in:

- annotation validation
- evaluation metrics fallback
- evaluator normalization
- DTO validation

Implication:

- `data.configuration` is already close to dead as revision runtime state
- `data.service` still needs a final removal pass after flat-field backfill is complete

### Hook classification

Confirmed:

- `hook` is an Agenta builtin runnable, not `user:custom`
- `auto_webhook_test` is also an Agenta builtin runnable
- legacy `AppType.CUSTOM` maps to the builtin hook template rather than to `user:custom`

References:

- `agenta:builtin:hook:v0`
- `agenta:builtin:auto_webhook_test:v0`

Implication:

- “Agenta custom” is ambiguous and must be split into:
  - builtin hook/template-based runnables
  - true user-owned custom runnables (`user:custom:*`)

### Current persisted schema baseline after cleanup

The current stored data is now materially simpler:

- most Agenta builtin evaluator-style families persist only `schemas.outputs`
- hook, chat, and completion currently persist no flat schema members
- `user:custom:*` rows currently persist no flat schema members in practice
- no currently observed URI family persists `schemas.inputs` or `schemas.parameters`

Representative examples:

- outputs builtin families:
  - `agenta:builtin:auto_exact_match:v0`
  - `agenta:builtin:auto_contains_json:v0`
  - `agenta:builtin:auto_ai_critique:v0`
  - `agenta:builtin:auto_custom_code_run:v0`
  - `agenta:builtin:auto_webhook_test:v0`
  - `agenta:builtin:code:v0`
  - `agenta:builtin:auto_human:v0`
- no-flat-schema builtin families:
  - `agenta:builtin:hook:v0`
  - `agenta:builtin:chat:v0`
  - `agenta:builtin:completion:v0`
- no-flat-schema custom families:
  - effectively all observed `user:custom:*`

Implication:

- the schema migration is not mainly about preserving already-flat `inputs` / `parameters`
- it is mainly about:
  - preserving or deriving `schemas.outputs`
  - later backfilling richer builtin schema members from runtime/interface truth where desired

### No-URI population classification

The no-URI population is not one thing. It breaks into several distinct buckets.

#### 1. Human evaluator no-URI rows

Dominant bucket:

- flags:
  - `is_human=true`
  - `is_evaluator=true`
- count:
  - `1526`
- shape:
  - no flat schemas
  - legacy `service` only
  - no `url`
  - no `parameters`

Secondary bucket:

- flags:
  - `is_human=true`
  - `is_evaluator=true`
- count:
  - `64`
- shape:
  - flat schemas present
  - legacy `service` also present
  - `script`, `url`, and `parameters` present

Interpretation:

- the dominant current human-evaluator state is still legacy nested `service` without URI
- there is also an older mixed no-URI human bucket with both flat and legacy fields
- this requires both code repair and data repair

#### 2. No-URI non-evaluator builtin/application rows

Flags:

- `is_chat=false`
- `is_human=false`
- `is_custom=false`
- `is_evaluator=false`

Observed states:

- `1041` rows:
  - `url + parameters`
  - no schemas
- `414` rows:
  - `parameters` only
  - no `url`
  - no schemas
- `410` rows:
  - `url` only
  - no `parameters`
  - no schemas
- `131` rows:
  - full flat schema triplet
  - `url`
  - `parameters`

Interpretation:

- these are several partial-migration states, not one uniform bug
- sampled rows resolve cleanly to the builtin `completion` family
- rows with persisted `url` overwhelmingly point at:
  - `https://eu.cloud.agenta.ai/services/completion`
  - `https://cloud.agenta.ai/services/completion`
- the `414`-row no-`url` tail is still structurally completion-shaped:
  - prompt-template payloads
  - `parameters.prompt.messages`
  - `llm_config`
  - no webhook-specific fields
- the `131`-row subset is clearly “flat fields backfilled, URI still missing”

Target family:

- `agenta:builtin:completion:v0`

#### 3. No-URI chat rows

Flags:

- `is_chat=true`
- `is_human=false`
- `is_custom=false`
- `is_evaluator=false`

Observed states:

- `455` rows:
  - `url + parameters`
  - no schemas
- `321` rows:
  - `url` only
  - no schemas
- `35` rows:
  - full flat schema triplet
  - `url + parameters`
- `25` rows:
  - `parameters` only
  - no `url`
  - no schemas

Interpretation:

- same partial-migration ladder as the non-chat application bucket
- sampled rows resolve cleanly to the builtin `chat` family
- rows with persisted `url` overwhelmingly point at:
  - `https://eu.cloud.agenta.ai/services/chat`
  - `https://cloud.agenta.ai/services/chat`
- the no-`url` tail is still chat-shaped rather than generic completion:
  - `is_chat=true`
  - conversational assistant personas
  - prompt definitions for multi-turn chat behavior

Target family:

- `agenta:builtin:chat:v0`

#### 4. No-URI custom non-evaluator rows

Flags:

- `is_custom=true`
- `is_evaluator=false`

Observed states:

- `11` rows:
  - `url + parameters`
- `8` rows:
  - `url` only
- `2` rows:
  - `parameters` only
  - no `url`

Interpretation:

- this bucket is now split into:
  - remote hook-style app rows
  - a tiny local exception bucket
- the `19` rows with persisted `url` are hook-style app rows:
  - `https://dorthey-synovial-hortensia.ngrok-free.dev`
  - `http://localhost:8000`
  - `https://mock-api.getfez.ai/analytics_v1`
  - `https://api.getfez.ai/mock/v20250328`
- the `2` rows with no `url` are a separate local/config-only exception bucket:
  - custom parameter keys
  - no webhook target URL persisted
  - no builtin completion/chat routing markers

Target families:

- remote hook-style rows:
  - `agenta:builtin:hook:v0`
- local/config-only exception rows:
  - `user:custom:local:latest`

#### 5. No-URI custom evaluator rows

Flags:

- `is_custom=true`
- `is_evaluator=true`

Observed states:

- `6` rows:
  - legacy `service` only
- `3` rows:
  - `schemas.outputs + service`
- `1` row:
  - mixed row with schemas, service, script, url, and parameters

Interpretation:

- these are evaluator-writer cases rather than application cases
- sampled rows resolve cleanly to true custom evaluators:
  - mostly legacy `service.format`-only storage
  - some rows also have `schemas.outputs`
  - no builtin evaluator URI family markers

Target family:

- `user:custom:annotator:v0`

#### Migration consequence

The no-URI problem is not a single migration step. It has at least three categories:

1. active writer bugs
  - human/default/custom evaluator creation still producing no-URI rows
2. application/legacy-adapter write paths
  - producing flat-but-no-URI builtin application rows
  - completion and chat are the dominant confirmed families
3. historical partial migration state
  - rows that already have flat fields and sometimes full schemas, but still lack URI

This means:

- code repair must stop creating new no-URI rows
- data migration can now backfill most no-URI rows directly by family:
  - builtin non-chat/non-custom/non-evaluator -> `agenta:builtin:completion:v0`
  - builtin chat -> `agenta:builtin:chat:v0`
  - custom non-evaluator with remote hook semantics -> `agenta:builtin:hook:v0`
  - custom non-evaluator local/config-only exception -> `user:custom:local:latest`
  - custom evaluator -> `user:custom:annotator:v0`
- the main remaining no-URI design question is the exact target URI naming and normalization rule for human evaluators

## Migration Classification Matrix

Use this as the canonical classifier for current workflow revision rows.

Interpretation note:

- this matrix is now a migration-time materialization matrix, not the authored external runnable contract
- stream/batch, chat/verbose, and evaluate command semantics are moving out of primary flags and into:
  - HTTP content negotiation
  - schema / OpenAPI inference
  - URI / registry-derived metadata
- any target flags shown below should therefore be read as migration-time materialized metadata only

Precedence:

1. if `uri` is present and meaningful, classify by `uri` first
2. otherwise, if `url` is present and meaningful, classify by `url`
3. only if both `uri` and `url` are absent do flags become the primary classifier

Values:

- `flags` uses an explicit object with `true`, `false`, or `any`
- `url` uses:
  - `null`
  - exact URL or URL family
- `uri` uses:
  - `null`
  - exact URI or URI family
- `schemas` uses:
  - `none`
  - `outputs`
  - `full`
  - `X`

| **#** | **Current URI** | **Current URL** | **Current Flags** | **Current Schemas** | **Target URI** | **Target URL** | **Target Flags** | **Target Outputs Schema** | **Target Headers** | **Target Parameters** | **Target Script** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | **`agenta:builtin:chat:v0`** | **`X`** | **`X`** | **`X`** | **`agenta:builtin:chat:v0`** | **`null`** | **`{"is_chat":true,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`null`** | **`null`** | **`preserve`** | **`null`** |
| **2** | **`agenta:builtin:completion:v0`** | **`X`** | **`X`** | **`X`** | **`agenta:builtin:completion:v0`** | **`null`** | **`{"is_chat":false,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`null`** | **`null`** | **`preserve`** | **`null`** |
| **3** | **`agenta:builtin:code:v0`** | **`X`** | **`X`** | **`X`** | **`agenta:builtin:code:v0`** | **`null`** | **`{"is_chat":false,"is_evaluator":false,"can_stream":false,"can_evaluate":true}`** | **`preserve`** | **`null`** | **`preserve`** | **`preserve`** |
| **4** | **`agenta:builtin:hook:v0`** | **`X`** | **`X`** | **`X`** | **`agenta:builtin:webhook:v0`** | **`preserve`** | **`{"is_chat":false,"is_evaluator":false,"can_stream":false,"can_evaluate":true}`** | **`preserve`** | **`preserve`** | **`preserve`** | **`null`** |
| **5** | **`null`** | **`<url>`** | **`{"is_chat":X,"is_human":X,"is_custom":true,"is_evaluator":false}`** | **`X`** | **`agenta:builtin:webhook:v0`** | **`preserve`** | **`{"is_chat":false,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`preserve`** | **`preserve`** | **`preserve`** | **`null`** |
| **6** | **`null`** | **`null`** | **`{"is_chat":false,"is_human":true,"is_custom":false,"is_evaluator":true}`** | **`X`** | **`agenta:custom:feedback:v0`** | **`null`** | **`{"is_chat":false,"is_evaluator":true,"can_stream":false,"can_evaluate":false}`** | **`backfill`** | **`null`** | **`null`** | **`null`** |
| **7** | **`null`** | **`null`** | **`{"is_chat":false,"is_human":false,"is_custom":true,"is_evaluator":true}`** | **`X`** | **`agenta:custom:feedback:v0`** | **`null`** | **`{"is_chat":false,"is_evaluator":true,"can_stream":false,"can_evaluate":false}`** | **`preserve`** | **`null`** | **`null`** | **`null`** |
| **8** | **`<hook-variant-uri>`** | **`null`** | **`{"is_chat":false,"is_human":false,"is_custom":false,"is_evaluator":true}`** | **`X`** | **`<hook-variant-uri>`** | **`preserve`** | **`{"is_chat":false,"is_evaluator":true,"can_stream":false,"can_evaluate":false}`** | **`backfill`** | **`preserve`** | **`preserve`** | **`null`** |
| **9** | **`<code-variant-uri>`** | **`null`** | **`{"is_chat":false,"is_human":false,"is_custom":false,"is_evaluator":true}`** | **`X`** | **`<code-variant-uri>`** | **`null`** | **`{"is_chat":false,"is_evaluator":true,"can_stream":false,"can_evaluate":false}`** | **`backfill`** | **`null`** | **`preserve`** | **`preserve`** |
| **10** | **`<other-builtin-uri>`** | **`null`** | **`{"is_chat":false,"is_human":false,"is_custom":false,"is_evaluator":true}`** | **`X`** | **`<other-builtin-uri>`** | **`null`** | **`{"is_chat":false,"is_evaluator":true,"can_stream":false,"can_evaluate":false}`** | **`backfill`** | **`null`** | **`preserve`** | **`null`** |
| **11** | **`null`** | **`null`** | **`{"is_chat":true,"is_human":X,"is_custom":X,"is_evaluator":false}`** | **`X`** | **`agenta:builtin:chat:v0`** | **`null`** | **`{"is_chat":true,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`null`** | **`null`** | **`preserve`** | **`null`** |
| **12** | **`null`** | **`null`** | **`{"is_chat":false,"is_human":X,"is_custom":X,"is_evaluator":false}`** | **`X`** | **`agenta:builtin:completion:v0`** | **`null`** | **`{"is_chat":false,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`null`** | **`null`** | **`preserve`** | **`null`** |
| **13** | **`null`** | **`null`** | **`{"is_chat":false,"is_human":X,"is_custom":true,"is_evaluator":false}`** | **`X`** | **`user:custom:local:latest`** | **`null`** | **`{"is_chat":false,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`null`** | **`null`** | **`preserve`** | **`preserve`** |
| **14** | **`<user-custom-uri>`** | **`null`** | **`{"is_chat":false,"is_human":false,"is_custom":true,"is_evaluator":false}`** | **`X`** | **`<user-custom-uri>`** | **`null`** | **`{"is_chat":false,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`preserve`** | **`null`** | **`preserve`** | **`preserve`** |
| **15** | **`null`** | **`<<url>>`** | **`{"is_chat":true,"is_human":false,"is_custom":false,"is_evaluator":false}`** | **`X`** | **`agenta:builtin:chat:v0`** | **`null`** | **`{"is_chat":true,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`null`** | **`null`** | **`preserve`** | **`null`** |
| **16** | **`null`** | **`<<url>>`** | **`{"is_chat":false,"is_human":false,"is_custom":false,"is_evaluator":false}`** | **`X`** | **`agenta:builtin:completion:v0`** | **`null`** | **`{"is_chat":false,"is_evaluator":false,"can_stream":false,"can_evaluate":false}`** | **`null`** | **`null`** | **`preserve`** | **`null`** |

Legacy-field note:

- unless stated otherwise elsewhere in this document:
  - legacy `service` is kept temporarily during expand/normalize
  - legacy `configuration` is kept temporarily during expand/normalize
  - flat fields win when flat and legacy differ
  - both legacy fields are removed together in the final contract phase

Schema note:

- target `schemas.inputs` is always `null`
- target `schemas.parameters` is always `null`
- the matrix only tracks target `schemas.outputs`
- target `schemas.outputs` only uses:
  - `preserve`
  - `backfill`
  - `null`

Preserve note:

- `preserve` means: preserve if present, else `null`

Flags note:

- omitted keys in `Current Flags` and `Target Flags` mean `X`, not `false`
- a key only appears when that row is constraining it to a concrete boolean value
- `is_human` and `is_custom` are legacy identity flags, omitted from `Target Flags`
  - they are preserved as-is during migration (same treatment as legacy `service` and `configuration`)
  - they will be dropped in a later phase together with other legacy fields
  - the long-term identity contract uses only `is_chat` and `is_evaluator` plus the URI family

### Matrix Validation SQL

For each row below:

- `membership` query: returns the candidate rows for that matrix row
- `shape` query: surfaces the fields a human needs to verify the row is semantically uniform
- `coverage` query: proves the row participates in the full partition and helps detect gaps or overlaps

Shared conventions:

- replace `workflow_revisions` if you are validating against a different revision table
- all queries below assume `data` is `json` and therefore use `data::jsonb`
- each `membership` query is the authoritative row predicate for that matrix row
- after running all membership queries, the union of their counts should equal the total covered population

#### Coverage Baseline

Use this baseline before and after the row checks:

```sql
SELECT COUNT(*) AS total_rows
FROM workflow_revisions;
```

```sql
SELECT COUNT(*) AS total_non_null_data_rows
FROM workflow_revisions
WHERE data IS NOT NULL;
```

For covered-population accounting:

```sql
SELECT COUNT(*) AS total_classifiable_rows
FROM workflow_revisions
WHERE data IS NOT NULL;
```

Success criterion:

- the sum of all row-level `membership` counts equals `total_classifiable_rows`
- no row-level overlap query returns any rows unless the overlap is intentionally allowed and documented

#### Row 1: Current URI = `agenta:builtin:chat:v0`

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0';
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb ->> 'url' AS url,
  data::jsonb -> 'schemas' AS schemas,
  data::jsonb -> 'parameters' AS parameters
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0'
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- sampled rows are recognizably chat-family rows
- no sampled row obviously belongs to completion/hook/evaluator instead

#### Row 2: Current URI = `agenta:builtin:completion:v0`

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0';
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb ->> 'url' AS url,
  data::jsonb -> 'schemas' AS schemas,
  data::jsonb -> 'parameters' AS parameters
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0'
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- sampled rows are prompt/completion-family rows
- sampled rows do not read like hook/chat/evaluator rows

#### Row 3: Current URI = `agenta:builtin:code:v0`

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:code:v0';
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb -> 'script' AS script,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'schemas' AS schemas
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:code:v0'
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- sampled rows show code-family execution state
- `script` and/or code-related parameter payloads make sense for the target

#### Row 4: Current URI = `agenta:builtin:hook:v0`

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0';
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb ->> 'url' AS url,
  data::jsonb -> 'headers' AS headers,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'schemas' AS schemas
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0'
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- sampled rows are remote webhook-style app rows
- persisted `url` is meaningful and user-owned

#### Row 5: No URI, URL present, custom non-evaluator

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false';
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb ->> 'url' AS url,
  data::jsonb -> 'headers' AS headers,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'schemas' AS schemas
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
ORDER BY created_at DESC
LIMIT 50;
```

Coverage refinement:

```sql
SELECT
  data::jsonb ->> 'url' AS url,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
GROUP BY data::jsonb ->> 'url'
ORDER BY count DESC, url;
```

Success criterion:

- URLs are predominantly remote hook/webhook-style app targets
- this bucket is semantically uniform enough to map to builtin webhook

#### Row 6: No URI, no URL, human non-custom evaluator

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb;
```

```sql
SELECT
  id,
  version,
  created_at,
  data::jsonb -> 'schemas' AS schemas,
  data::jsonb -> 'service' AS service
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- rows are human feedback/annotation evaluator shapes
- service-only or outputs-schema shapes are coherent with annotator migration

#### Row 7: No URI, no URL, non-human custom evaluator

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb;
```

```sql
SELECT
  id,
  version,
  created_at,
  data::jsonb -> 'schemas' AS schemas,
  data::jsonb -> 'service' AS service
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- rows look like custom annotator/evaluator definitions
- they do not look like builtin webhook/code evaluator families

#### Row 8: Hook-variant builtin evaluator URI

```sql
SELECT
  data::jsonb ->> 'uri' AS uri,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' IN (
    'agenta:builtin:auto_webhook_test:v0'
  )
GROUP BY data::jsonb ->> 'uri'
ORDER BY count DESC;
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb ->> 'url' AS url,
  data::jsonb -> 'headers' AS headers,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'schemas' AS schemas
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' IN (
    'agenta:builtin:auto_webhook_test:v0'
  )
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- URL/headers remain meaningful
- rows are webhook evaluator-family rows

#### Row 9: Code-variant builtin evaluator URI

```sql
SELECT
  data::jsonb ->> 'uri' AS uri,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' IN (
    'agenta:builtin:auto_custom_code_run:v0'
  )
GROUP BY data::jsonb ->> 'uri'
ORDER BY count DESC;
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb -> 'script' AS script,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'schemas' AS schemas
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' IN (
    'agenta:builtin:auto_custom_code_run:v0'
  )
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- rows carry code-runner semantics
- preserving `script` is clearly correct

#### Row 10: Other builtin evaluator URI

```sql
SELECT
  data::jsonb ->> 'uri' AS uri,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' NOT IN (
    'agenta:builtin:chat:v0',
    'agenta:builtin:completion:v0',
    'agenta:builtin:code:v0',
    'agenta:builtin:hook:v0',
    'agenta:builtin:auto_webhook_test:v0',
    'agenta:builtin:auto_custom_code_run:v0'
  )
  AND flags->>'is_evaluator' = 'true'
GROUP BY data::jsonb ->> 'uri'
ORDER BY count DESC, uri;
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb -> 'schemas' AS schemas,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'service' AS service,
  data::jsonb -> 'configuration' AS configuration
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' NOT IN (
    'agenta:builtin:chat:v0',
    'agenta:builtin:completion:v0',
    'agenta:builtin:code:v0',
    'agenta:builtin:hook:v0',
    'agenta:builtin:auto_webhook_test:v0',
    'agenta:builtin:auto_custom_code_run:v0'
  )
  AND flags->>'is_evaluator' = 'true'
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- the remaining builtin evaluator URIs are semantically coherent as the generic evaluator bucket

#### Row 11: No URI, no URL, chat fallback

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_evaluator' = 'false';
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'schemas' AS schemas
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_evaluator' = 'false'
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- rows are still recognizably chat-family rows despite lacking URI and URL

#### Row 12: No URI, no URL, completion fallback

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_evaluator' = 'false'
  AND flags->>'is_custom' = 'false';
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'schemas' AS schemas
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_evaluator' = 'false'
  AND flags->>'is_custom' = 'false'
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- rows are completion-family rows, not custom local exceptions

#### Row 13: No URI, no URL, custom non-evaluator local exception

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
  AND (
    NOT (data::jsonb ? 'schemas')
    OR jsonb_typeof(data::jsonb -> 'schemas') = 'null'
  );
```

```sql
SELECT
  id,
  version,
  created_at,
  flags,
  data::jsonb -> 'parameters' AS parameters,
  data::jsonb -> 'script' AS script,
  data::jsonb -> 'schemas' AS schemas
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'true'
  AND flags->>'is_evaluator' = 'false'
  AND (
    NOT (data::jsonb ? 'schemas')
    OR jsonb_typeof(data::jsonb -> 'schemas') = 'null'
  )
ORDER BY created_at DESC
LIMIT 50;
```

Success criterion:

- rows are the known local/config-only custom exceptions
- rows do not look like hidden completion/chat rows

#### Row 14: user:custom URI, no URL, non-evaluator app

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'user:custom:%'
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_evaluator' = 'false';
```

```sql
SELECT
  data::jsonb ->> 'uri' AS uri,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND data::jsonb ->> 'uri' LIKE 'user:custom:%'
  AND (
    NOT (data::jsonb ? 'url')
    OR data::jsonb ->> 'url' IS NULL
  )
  AND flags->>'is_evaluator' = 'false'
GROUP BY data::jsonb ->> 'uri'
ORDER BY count DESC;
```

Success criterion:

- all rows are SDK-deployed application variants with existing user:custom URIs
- URI key patterns follow `user:custom:<module>.<function>:latest` or `user:custom:<slug>:v0`
- no row looks like a misclassified evaluator or builtin

#### Row 15: No URI, Agenta service URL, chat

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false';
```

```sql
SELECT
  data::jsonb ->> 'url' AS url,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'true'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false'
GROUP BY data::jsonb ->> 'url'
ORDER BY count DESC;
```

Success criterion:

- all URLs are Agenta-owned service endpoints (`/services/chat`)
- no user-owned URLs appear in this bucket

#### Row 16: No URI, Agenta service URL, completion

```sql
SELECT COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false';
```

```sql
SELECT
  data::jsonb ->> 'url' AS url,
  COUNT(*) AS count
FROM workflow_revisions
WHERE data IS NOT NULL
  AND (
    NOT (data::jsonb ? 'uri')
    OR data::jsonb ->> 'uri' IS NULL
  )
  AND data::jsonb ->> 'url' IS NOT NULL
  AND flags->>'is_chat' = 'false'
  AND flags->>'is_custom' = 'false'
  AND flags->>'is_evaluator' = 'false'
GROUP BY data::jsonb ->> 'url'
ORDER BY count DESC;
```

Success criterion:

- all URLs are Agenta-owned service endpoints (`/services/completion`)
- no user-owned URLs appear in this bucket

#### Partition Coverage Check

After validating the rows individually, use this query to confirm that every non-null-data row falls into one and only one matrix bucket:

```sql
WITH classified AS (
  SELECT
    id,
    CASE
      WHEN data IS NULL THEN 'unclassified:null-data'
      WHEN data::jsonb ->> 'uri' = 'agenta:builtin:chat:v0' THEN 'row-1'
      WHEN data::jsonb ->> 'uri' = 'agenta:builtin:completion:v0' THEN 'row-2'
      WHEN data::jsonb ->> 'uri' = 'agenta:builtin:code:v0' THEN 'row-3'
      WHEN data::jsonb ->> 'uri' = 'agenta:builtin:hook:v0' THEN 'row-4'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND data::jsonb ->> 'url' IS NOT NULL AND flags->>'is_custom' = 'true' AND flags->>'is_evaluator' = 'false' THEN 'row-5'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb THEN 'row-6'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb THEN 'row-7'
      WHEN data::jsonb ->> 'uri' IN ('agenta:builtin:auto_webhook_test:v0') THEN 'row-8'
      WHEN data::jsonb ->> 'uri' IN ('agenta:builtin:auto_custom_code_run:v0') THEN 'row-9'
      WHEN data::jsonb ->> 'uri' IS NOT NULL AND flags->>'is_evaluator' = 'true' THEN 'row-10'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags->>'is_chat' = 'true' AND flags->>'is_evaluator' = 'false' THEN 'row-11'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags->>'is_chat' = 'false' AND flags->>'is_evaluator' = 'false' AND flags->>'is_custom' = 'false' THEN 'row-12'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags->>'is_chat' = 'false' AND flags->>'is_custom' = 'true' AND flags->>'is_evaluator' = 'false' THEN 'row-13'
      WHEN data::jsonb ->> 'uri' LIKE 'user:custom:%' AND (
        NOT (data::jsonb ? 'url')
        OR data::jsonb ->> 'url' IS NULL
      ) AND flags->>'is_evaluator' = 'false' THEN 'row-14'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND data::jsonb ->> 'url' IS NOT NULL
        AND flags->>'is_chat' = 'true'
        AND flags->>'is_custom' = 'false'
        AND flags->>'is_evaluator' = 'false' THEN 'row-15'
      WHEN (
        NOT (data::jsonb ? 'uri')
        OR data::jsonb ->> 'uri' IS NULL
      ) AND data::jsonb ->> 'url' IS NOT NULL
        AND flags->>'is_chat' = 'false'
        AND flags->>'is_custom' = 'false'
        AND flags->>'is_evaluator' = 'false' THEN 'row-16'
      ELSE 'unclassified'
    END AS bucket
  FROM workflow_revisions
)
SELECT bucket, COUNT(*) AS count
FROM classified
GROUP BY bucket
ORDER BY bucket;
```

Success criterion:

- `unclassified` returns `0`
- `unclassified:null-data` count matches the separately understood `data IS NULL` historical bucket
- the row counts line up with the sum of the individual membership queries

#### Unclassified Diagnostics

If `unclassified` is non-zero, use the query below to assign each unclassified row to a named gap. The exclusion conditions use `IS DISTINCT FROM` for URI equality — `NOT (col = 'value')` evaluates to `NULL` when `col IS NULL`, silently dropping all null-URI rows before they reach any later conditions.

```sql
-- Use IS DISTINCT FROM for URI equality checks. NOT (col = 'value') evaluates to
-- AND NULL when col IS NULL, silently dropping all null-URI rows. IS DISTINCT FROM
-- treats NULL as a known value: (NULL IS DISTINCT FROM 'chat') = true.
WITH unclassified AS (
  SELECT id, flags, data::jsonb ->> 'uri' AS uri, data::jsonb ->> 'url' AS url
  FROM workflow_revisions
  WHERE data IS NOT NULL
    AND (data::jsonb ->> 'uri' IS DISTINCT FROM 'agenta:builtin:chat:v0')
    AND (data::jsonb ->> 'uri' IS DISTINCT FROM 'agenta:builtin:completion:v0')
    AND (data::jsonb ->> 'uri' IS DISTINCT FROM 'agenta:builtin:code:v0')
    AND (data::jsonb ->> 'uri' IS DISTINCT FROM 'agenta:builtin:hook:v0')
    AND NOT (
      (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
      AND data::jsonb ->> 'url' IS NOT NULL
      AND flags->>'is_custom' = 'true' AND flags->>'is_evaluator' = 'false'
    )
    AND NOT (
      (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
      AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
      AND flags = '{"is_chat": false, "is_human": true, "is_custom": false, "is_evaluator": true}'::jsonb
    )
    AND NOT (
      (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
      AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
      AND flags = '{"is_chat": false, "is_human": false, "is_custom": true, "is_evaluator": true}'::jsonb
    )
    AND (data::jsonb ->> 'uri' IS DISTINCT FROM 'agenta:builtin:auto_webhook_test:v0')
    AND (data::jsonb ->> 'uri' IS DISTINCT FROM 'agenta:builtin:auto_custom_code_run:v0')
    AND NOT (data::jsonb ->> 'uri' IS NOT NULL AND flags->>'is_evaluator' = 'true')
    AND NOT (
      (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
      AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
      AND flags->>'is_chat' = 'true' AND flags->>'is_evaluator' = 'false'
    )
    AND NOT (
      (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
      AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
      AND flags->>'is_chat' = 'false' AND flags->>'is_evaluator' = 'false' AND flags->>'is_custom' = 'false'
    )
    AND NOT (
      (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
      AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
      AND flags->>'is_chat' = 'false' AND flags->>'is_custom' = 'true' AND flags->>'is_evaluator' = 'false'
    )
    AND NOT (
      data::jsonb ->> 'uri' LIKE 'user:custom:%'
      AND (NOT (data::jsonb ? 'url') OR data::jsonb ->> 'url' IS NULL)
      AND flags->>'is_evaluator' = 'false'
    )
    AND NOT (
      (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
      AND data::jsonb ->> 'url' IS NOT NULL
      AND flags->>'is_chat' = 'true'
      AND flags->>'is_custom' = 'false' AND flags->>'is_evaluator' = 'false'
    )
    AND NOT (
      (NOT (data::jsonb ? 'uri') OR data::jsonb ->> 'uri' IS NULL)
      AND data::jsonb ->> 'url' IS NOT NULL
      AND flags->>'is_chat' = 'false'
      AND flags->>'is_custom' = 'false' AND flags->>'is_evaluator' = 'false'
    )
),
gaps AS (
  SELECT
    CASE
      -- null URI + URL present + not row-5
      WHEN uri IS NULL AND url IS NOT NULL
        THEN 'gap-1: null-uri + url-present + not-row-5'
      -- null URI + null URL + is_evaluator=true + not rows 6/7
      WHEN uri IS NULL AND url IS NULL AND flags->>'is_evaluator' = 'true'
        THEN 'gap-2: null-uri + null-url + evaluator + flags-mismatch'
      -- null URI + null URL + is_evaluator=false + flags not matching rows 11/12/13
      WHEN uri IS NULL AND url IS NULL AND flags->>'is_evaluator' = 'false'
        THEN 'gap-3: null-uri + null-url + non-evaluator + flags-mismatch'
      -- non-null URI + is_evaluator=false + not a known builtin or user:custom
      WHEN uri IS NOT NULL AND flags->>'is_evaluator' = 'false'
        THEN 'gap-4: non-null-uri + non-evaluator + unknown-uri'
      ELSE 'gap-unknown'
    END AS gap,
    flags,
    uri,
    url
  FROM unclassified
)
SELECT gap, flags, uri, url, COUNT(*) AS count
FROM gaps
GROUP BY gap, flags, uri, url
ORDER BY gap, count DESC
LIMIT 100;
```

### Normalization rules

Apply after family classification:

- if flat and legacy differ, flat wins
- legacy `service` and `configuration` are retained temporarily during migration
- final contract phase removes legacy `service` and `configuration`
- for builtin `chat` and `completion`, this pass only backfills `uri`, not schemas
- for `user:custom:annotator:v0`, require only `schemas.outputs`
- for `agenta:builtin:hook:v0`, keep persisted `url` and `headers`
- for non-hook builtins, `url` and `headers` are derived, not persisted

## Migration Categories

We need explicit migration rules for these flat field groups.

### Identity / interface / discovery fields

- `uri`
- `url`
- `headers`
- `schemas`
  - `schemas.inputs`
  - `schemas.parameters`
  - `schemas.outputs`

### Execution / configuration fields

- `script`
- `parameters`

### Classification / flags

- legacy identity flags
- any target capability or derived classification fields

## Current Legacy Row Shapes

The migration needs to account for these current storage shapes:

1. `data IS NULL`
2. flat-only rows
3. nested-only rows
4. mixed flat+nested rows where values match
5. mixed flat+nested rows where nested values are stale or divergent

And these current workflow families:

1. Agenta builtins
2. builtin hook
3. builtin webhook evaluator
4. builtin code evaluator
5. default human evaluators
6. user-created human/custom evaluators
7. true `user:custom:*` workflows
8. legacy custom non-evaluator workflows/apps

## Current Leaning By Field

These are the working assumptions from the current discussion, not yet all fully finalized.

### `uri`

Leaning:

- every target runnable should have a URI
- URI family depends on workflow kind

Resolved direction:

- legacy builtin evaluator URIs remain stable for as long as those legacy workflows remain supported
- new consolidated builtin families can be introduced under new keys without rewriting legacy URIs in place
- deprecating a legacy builtin URI is tied to deprecating the corresponding underlying workflow family, not to silently remapping the URI

Implication:

- `agenta:builtin:auto_webhook_test:v0`
  - remains a valid legacy builtin URI
- `agenta:builtin:auto_custom_code_run:v0`
  - remains a valid legacy builtin URI
- the same compatibility rule applies to other legacy builtin evaluator keys that remain supported
- new consolidated families such as:
  - `agenta:builtin:hook:vN`
  - `agenta:builtin:code:vN`
  - are added as new builtin keys rather than replacing old legacy keys in place

### `url`

Leaning:

- persist `url` for builtin webhook families
- persist `url` for true `user:custom`
- do not persist `url` for non-webhook Agenta builtins
- if present on true user custom rows, keep it

Resolved direction:

- all Agenta builtins derive `url` from runtime/registry truth and do not treat persisted `url` as authoritative
- exception: webhook/hook-style builtin families persist `url` as user-owned data
- all `user:custom:*` rows persist `url` as user-owned data

Implementation note:

- webhook/hook-style families should be controlled by an explicit allowlist of builtin URI keys or URI prefixes
- that allowlist must cover at least the currently known legacy and consolidated hook/webhook families
- future webhook-style builtin keys can be added to the allowlist without changing the core migration rule

### `headers`

Leaning:

- persist `headers` for builtin webhook families
- persist `headers` for true `user:custom`
- do not persist `headers` for non-webhook Agenta builtins

Resolved direction:

- `headers` follows exactly the same persistence policy as `url`
- all non-hook Agenta builtins derive `headers` and do not treat persisted values as authoritative
- webhook/hook-style builtin families persist `headers` as user-owned data
- all `user:custom:*` rows persist `headers` as user-owned data

Normalization rule:

- empty `headers` should normalize to `null`, not to `{}`
- this allows `exclude_none`-style serialization to drop absent headers cleanly

### `schemas`

Leaning:

- flat `schemas` is the target contract
- if only nested legacy schema exists, migrate it into flat `schemas`
- if flat and nested both exist, flat wins
- nested schema should eventually be dropped

Resolved direction:

- partial `schemas` are allowed in persisted data
- `schemas.outputs` is the most important required member where it is knowable
- if only nested legacy schema exists, migrate the known parts into flat `schemas`
- if flat and nested both exist, flat wins
- nested schema should eventually be dropped

Family-specific schema expectations:

- human evaluators (`user:custom:annotator:v0` as the migration target family)
  - must have `schemas.outputs`
  - `schemas.inputs` may be absent
  - `schemas.parameters` may be absent
- normal Agenta builtin families
  - completion/chat currently do not get schema backfill during this migration
  - no flat schema members are required for completion/chat in this pass
- hook/webhook builtin families
  - must have `schemas.inputs`
  - must have `schemas.outputs`
  - `schemas.parameters` is optional
- code builtin families
  - must have `schemas.inputs`
  - must have `schemas.outputs`
  - `schemas.parameters` is optional
- `user:custom:*` non-human families
  - keep whatever schema members are actually defined
  - but `schemas.outputs` should exist at least where it is already defined or safely derivable

Migration-specific exceptions:

- builtin `completion` and `chat`
  - backfill `uri`
  - do not backfill schemas in this migration pass
- custom evaluators
  - target requires `schemas.outputs` only
  - other schema members may remain absent
  - migration target URI is:
    - `user:custom:annotator:v0`

Important non-goal:

- for hook/code families, there is no best-effort requirement to backfill `schemas.parameters`
- if those families do not have a meaningful persisted parameter schema, leaving `schemas.parameters` absent is acceptable

### `script`

Leaning:

- keep flat `script` for builtin code evaluators
- keep flat `script` for true `user:custom`
- do not persist `script` for non-code Agenta builtins

Resolved direction:

- `script` follows the same persisted-vs-derived pattern as `url`/`headers`, but for code families
- code-style builtin families persist `script`
- `user:custom:*` rows persist `script`
- all other Agenta builtins should have no persisted `script`; the derived value is effectively `None`

Implementation note:

- code-style families should also be controlled by an explicit allowlist of builtin URI keys or URI prefixes
- that allowlist must cover at least the current legacy and consolidated code families

### `parameters`

Leaning:

- flat `parameters` is canonical
- if only nested configuration exists, migrate relevant config payload into flat `parameters`
- if both flat and nested exist, flat wins
- nested configuration should eventually be dropped

Resolved direction:

- flat `parameters` is canonical
- if only nested configuration exists, migrate the relevant config payload into flat `parameters`
- if flat `parameters` and nested configuration both exist, flat wins
- nested configuration is retained temporarily for compatibility during expand
- nested configuration is removed together with `service` in the final contract phase

### flags

Leaning:

- flags may require migration separately from data fields
- some classification should eventually be derived from URI/family rather than treated as independent truth

Still needs explicit decisions on:

- whether we only preserve legacy identity flags
- whether we backfill target capability/static flags
- which flags remain persisted versus derived

## Special Families That Still Need Care

### builtin hook

Current understanding:

- builtin, not `user:custom`
- should likely carry `uri`
- likely needs persisted `url` / `headers`

Resolved direction:

- `hook` is the consolidated builtin webhook-family key for new behavior
- legacy evaluator-style webhook keys such as `auto_webhook_test` remain as separate legacy builtin URIs while supported
- legacy custom app/workflow rows that are really hook-template based migrate to the builtin hook family rather than to `user:custom:*`
- the old hook workflow is the effective legacy/baseline `hook` behavior during migration

### builtin webhook evaluator

Current understanding:

- builtin, not `user:custom`
- should likely carry `uri`
- likely needs persisted `url` / `headers`
- schemas should still be flat

Still open:

- exact persistence and refresh policy for `url`, `headers`, and schemas

Resolved direction:

- legacy builtin webhook evaluators keep their legacy builtin keys and URIs
- they are not rewritten in storage to the newer consolidated `hook` family
- any future migration away from them is a real deprecation/removal event, not an in-place URI rewrite

### builtin code evaluator

Current understanding:

- special because both `script` and `parameters` matter
- mixed rows already show stale nested-vs-flat drift

Still open:

- exact split of what belongs in `script`
- exact split of what belongs in `parameters`
- how to migrate nested code/config rows into that split

Resolved direction:

- `code` is the consolidated builtin code-family key for new behavior
- legacy evaluator-style code keys such as `auto_custom_code_run` remain as separate legacy builtin URIs while supported
- future improved code-style builtins can ship under new builtin keys without changing old URIs in place

### default human evaluators

Current understanding:

- should get a real URI in target state
- should primarily rely on flat `schemas.outputs`
- should not need `url`, `headers`, `script`, or `parameters`

Resolved direction:

- default human evaluators should use the same `user:custom:*` URI family as user-created human evaluators
- default human evaluators are not a special Agenta-owned URI family
- migration target URI is:
  - `user:custom:annotator:v0`
- target flat shape requires:
  - `schemas.outputs`
  - `url = null`
  - `headers = null`
  - `script = null`
  - `parameters = null`
- legacy `service` is retained temporarily and dropped later in the same contract phase as legacy `configuration`

### user-created human/custom evaluators

Current understanding:

- should also get a real URI in target state
- many historical rows currently store only nested `service.format`

Resolved direction:

- user-created human/custom evaluators should use the same migration target family as default human evaluators
- migration target URI is:
  - `user:custom:annotator:v0`
- target flat shape requires:
  - `schemas.outputs`
  - `url = null`
  - `headers = null`
  - `script = null`
  - `parameters = null`
- legacy `service` is retained temporarily and dropped later in the same contract phase as legacy `configuration`

## Remaining Discussion Topics

These are the parts that still require explicit decisions.

1. `user:custom:*` naming mechanics
- exact slug derivation for remote custom rows
- exact slug derivation for local/config-only custom rows
- whether `annotator` remains the long-term canonical third segment or is only a migration placeholder

2. `user:custom:*` versioning mechanics
- whether `v0` is purely a migration landing version
- whether later versions track contract evolution independently from revision history

3. expand/contract sequencing details
- exact migration ordering across:
  - URI backfill
  - flat output-schema backfill
  - legacy read removal
  - final `service` / `configuration` removal
- which families persist it
- which families derive/refresh it
- which families must not persist it

Resolved direction:

- all Agenta builtins derive `url`, except allowlisted hook/webhook-style builtin families
- allowlisted hook/webhook-style builtin families persist `url`
- all `user:custom:*` rows persist `url`

3. `headers` persistence policy
- same matrix as `url`

Resolved direction:

- `headers` uses the exact same matrix as `url`
- empty headers normalize to `null`

4. `schemas` target completeness
- whether target rows must include:
  - `schemas.inputs`
  - `schemas.parameters`
  - `schemas.outputs`
- what happens when only one or two are knowable

Resolved direction:

- target persisted schemas may be partial
- the required members depend on workflow family
- `schemas.parameters` is intentionally optional for hook/code families

5. Builtin schema refresh boundaries
- which schema members are runtime-owned
- which schema members are user-owned
- what may be refreshed from registry/inspect

Partially resolved:

- normal Agenta builtin families should refresh toward full `inputs` / `parameters` / `outputs`
- hook/code families do not require best-effort population of `schemas.parameters`
- further refresh policy still needs to distinguish runtime-owned builtin schemas from user-owned custom schemas

6. `script` migration rules
- especially for builtin code evaluators and true user custom rows

Partially resolved:

- allowlisted code-style builtin families persist `script`
- all `user:custom:*` rows persist `script`
- all other Agenta builtins should have no persisted `script`

7. `parameters` extraction rules
- especially for rows where nested configuration exists without flat parameters
- and for mismatched hybrid rows

8. builtin code evaluator split
- how `script` and `parameters` divide responsibility
- how legacy nested code/config maps to that split

9. human evaluator target shape
- required URI
- required schema members
- whether anything besides `schemas.outputs` should persist

Partially resolved:

- human evaluators use `user:custom:*`
- the minimum required schema member is `schemas.outputs`
- `schemas.inputs` and `schemas.parameters` may remain absent

10. flags migration scope
- whether only legacy flags remain
- or whether target flags/capabilities are backfilled

11. removal sequencing
- when to eliminate the final `data.service` reads
- whether legacy-field removal happens only after migrations are complete

Resolved direction:

- use expand/contract
- expand phase:
  - populate and normalize all target flat fields
  - preserve legacy nested fields and any temporarily duplicated fields needed for compatibility
- contract phase:
  - remove stale non-authoritative flat fields where they should not exist
    - e.g. `url`, `headers`, `script` on families that should not persist them
  - remove nested `service` and `configuration`
- deletion of stale derived fields should happen only after the flat contract and URI normalization are complete and trusted

## Suggested Next Step

The next useful step is to convert the open discussion into a field-by-field migration matrix:

- rows:
  - current legacy row shapes and workflow families
- columns:
  - `uri`
  - `url`
  - `headers`
  - `schemas.inputs`
  - `schemas.parameters`
  - `schemas.outputs`
  - `script`
  - `parameters`
  - `flags`
- value in each cell:
  - keep
  - derive
  - refresh
  - drop
  - open question

That should let us resolve the migration design point by point.
