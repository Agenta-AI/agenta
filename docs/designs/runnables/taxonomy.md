# Runnables — URI Taxonomy & Classification

> Status: design proposal
> Date: 2026-03-05
> Companion: [gap-analysis.md](./gap-analysis.md) (G14, G15, G16)

This document defines the clean URI taxonomy for workflows, how classification should derive from URIs, and what needs to change.

---

## 1. URI Format

```
provider:kind:key:version
```

| Component | Purpose | Current Values |
|-----------|---------|----------------|
| `provider` | Who owns/manages the handler | `agenta`, `user` |
| `kind` | Category of handler | `builtin`, `custom` |
| `key` | Unique handler identifier | e.g., `echo`, `auto_exact_match`, `module.function_name` |
| `version` | Version identifier | `v0`, `v1`, `latest` |

**Shorthand expansion** (handled by `parse_uri()`):
- 1 part: `key` → `agenta:builtin:key:latest`
- 2 parts: `kind:key` → `agenta:kind:key:latest`
- 3 parts: `provider:kind:key` → `provider:kind:key:latest`
- 4 parts: as-is

---

## 2. Current URI Patterns

### `agenta:builtin:*:v0` — Backend-Managed Builtins

Handlers that ship with the platform. Code lives in the SDK, registered in HANDLER_REGISTRY at import time.

**All current builtins:**
- **Evaluators:** `echo`, `auto_exact_match`, `auto_regex_test`, `field_match_test`, `json_multi_field_match`, `auto_webhook_test`, `auto_custom_code_run`, `auto_ai_critique`, `auto_starts_with`, `auto_ends_with`, `auto_contains`, `auto_contains_any`, `auto_contains_all`, `auto_contains_json`, `auto_json_diff`, `auto_levenshtein_distance`, `auto_similarity_match`, `auto_semantic_similarity`
- **Applications:** `completion`, `chat`
- **Utility:** `hook` (webhook passthrough)

**Characteristics:**
- Handler callable is in `HANDLER_REGISTRY["agenta"]["builtin"][key]["v0"]`
- Interface schema is in `INTERFACE_REGISTRY` (explicit JSON Schema in `interfaces.py`)
- Default configuration is in `CONFIGURATION_REGISTRY`
- Runnable in-process (no HTTP hop needed)
- `url` field: only set for `auto_webhook_test` (points to external webhook)

### `user:custom:*:latest` — User-Deployed Code

Handlers defined by users via `@ag.workflow()` / `@ag.application()` / `@ag.evaluator()` decorators.

**URI auto-generation** (when no explicit URI given):
```python
key = f"{fn.__module__}.{fn.__name__}"
uri = f"user:custom:{key}:latest"
```

**From legacy migration:**
```python
uri = f"user:custom:{app_slug}:v0"
```

**Characteristics:**
- Handler callable registered at decoration time in the SDK process
- If running as an SDK service: handler is in-process, `url` points to the service HTTP endpoint
- If running via API direct invoke: handler may not be loadable (depends on deployment model)
- `url` field: set to the SDK service's HTTP endpoint when deployed

### `agenta:custom:annotation:v0` — Agenta-Managed Custom Annotation Definitions

Simple-trace annotation definitions created through the API side. These are evaluator-backed workflow revisions, but the trace type is inferred at ingestion from links rather than authored as a runnable flag.

**Characteristics:**
- resolves to an evaluator / evaluator variant / evaluator revision
- currently used for human and custom annotation-style simple traces
- may be non-runnable while still having an explicit URI and schema
- replaces the old no-URI human evaluator state

### `agenta:custom:invocation:v0` — Agenta-Managed Custom Invocation Definitions

Simple-trace invocation definitions created through the API side. These are application-backed workflow revisions, while the produced trace type is still inferred at ingestion.

**Characteristics:**
- resolves to an application / application variant / application revision
- used for Agenta-managed custom invocation-style simple traces
- gives custom invocation definitions an explicit URI family instead of overloading `user:custom`

### No URI — Legacy / Unresolved

**Current use:** Legacy rows that were created before URI backfill and normalization.

**Characteristics:**
- `uri` is `None` on the revision data
- this should be treated as migration debt, not as a target taxonomy state
- human evaluators should move to `agenta:custom:annotation:v0`

---

## 3. Problems with Current Taxonomy

### P1. Only Two Providers, Only Two Kinds

The current taxonomy is:
- `agenta:builtin` — platform-managed
- `user:custom` — user-deployed

But there are missing cases:
- **Third-party integrations** (e.g., a handler from a marketplace or partner) — neither `agenta` nor `user`
- **User-managed builtins** (e.g., a user forks a builtin evaluator and customizes it) — `user` provider but `builtin` kind?

The `provider:kind` pair currently acts as a single discriminator (`agenta:builtin` vs `user:custom`), not two independent axes.

### P2. `custom` Is Overloaded

`custom` in `user:custom` means "user-deployed code". But in the legacy system, `CUSTOM` (`AppType.CUSTOM`) meant "custom template" — a different concept. The migration mapped:
- `AppType.CUSTOM` → `agenta:builtin:hook:v0` (NOT `user:custom`!)
- `AppType.SDK_CUSTOM` → `user:custom:{slug}:v0`

So legacy "custom" ≠ URI "custom". This is a source of confusion.

### P3. `url` vs `uri` Conflation

Two different fields, two different purposes, easily confused:

| Field | Purpose | Example |
|-------|---------|---------|
| `uri` | Handler identity in the registry taxonomy | `agenta:builtin:echo:v0` |
| `url` | HTTP endpoint for remote invocation | `https://my-service.com/api` |

They're independent axes:
- Builtins have `uri` but usually no `url` (in-process)
- Exception: `auto_webhook_test` has both `uri` AND `url` (builtin handler that calls an external webhook)
- Custom workflows have `uri` AND `url` (user code reachable via HTTP)
- Non-runnable workflows have neither

### P4. Non-Runnable Has No URI Representation

Non-runnable workflows (human evaluators) currently have `uri=None`. This means:
- You can't distinguish "intentionally non-runnable" from "URI not yet set"
- There's no formal way to express "this is a schema/form definition, not a runnable"
- Querying for non-runnable workflows means querying for `uri IS NULL`
- A user-created human evaluator with a custom schema has no URI even though it's clearly a `user:custom` entity

### P5. URI Key Doesn't Map to Git-Style Model

The current URI key is the handler name (`echo`, `module.function_name`). But the system has a git-style hierarchy: **Artifact → Variant → Revision**. The URI doesn't reflect this:
- `key` = handler name, but there's no connection to variant slug
- `version` = handler version (`v0`, `latest`), but revision versions are sequential integers (`0`, `1`, `2`)
- The URI and the git model are disconnected

### P6. Revision Versions Are Integers, URI Versions Are `vN` Strings

Revision `version` column stores sequential integers as strings: `"0"`, `"1"`, `"2"` (count of prior revisions per variant). URI versions use `v0`, `v1`, `latest`. These are different formats for the same concept.

---

## 4. Proposed Clean Taxonomy

### 4a. Fundamental Principle: URI = Identity, Not Runnability

**URI identifies the workflow definition** (who made it, which variant, which version). It says nothing about whether the workflow can be invoked. Runnability is a separate axis determined by whether there's an engine (handler in registry or reachable URL).

For the current runnable plan, this means **every workflow should have a URI** — including today's human evaluators and Agenta-managed simple-trace invocations. A human/custom annotation definition created through the API side should be identified as `agenta:custom:annotation:v0`. A custom invocation definition created through the same simple-trace path should be identified as `agenta:custom:invocation:v0`.

Possible future extensions such as configuration-only objects with no URI are outside the scope of this runnable plan and should be treated as an open taxonomy question, not as the target contract for this design set.

### 4b. URI Maps to Git-Style Model

The URI components should align with the artifact/variant/revision hierarchy:

```
provider:kind:variant_slug:revision_version
```

| Component | Maps To | Meaning |
|-----------|---------|---------|
| `provider` | — | Who owns the definition: `agenta` (platform) or `user` |
| `kind` | — | Category: `builtin` (ships with platform) or `custom` (user-created) |
| `key` | **Variant slug** | Identifies the variant within the artifact |
| `version` | **Revision version** | Identifies the specific revision: `v0`, `v1`, ... `latest` |

This creates a natural alignment:
- Artifact = the workflow entity (identified by its own slug/ID)
- Variant = `provider:kind:variant_slug` (the first three URI components)
- Revision = the full URI `provider:kind:variant_slug:vN` (pinned) or `:latest` (floating)

**Version format:** Use `vN` in URIs (e.g., `v0`, `v3`). The git-style revision `version` column currently stores bare integers as strings (`"0"`, `"1"`, `"2"` — count of prior revisions). These map as `"3"` → `v3` in URI space.

### 4c. Runnability Rules

Runnability depends on the URI provider:

```
agenta:* URIs → ALWAYS RUNNABLE
  The platform guarantees handlers for its own URIs.
  They are registered at import time and always available.

user:* URIs → RUNNABLE ONLY IF there's a handler OR a URL
  User code needs to be reachable. The URI identifies the definition,
  but someone still needs to deploy/serve the code.
  - Has handler in SDK process → runnable in-process
  - Has URL → runnable remotely
  - Neither → NOT runnable (definition exists, no engine)

No URI → LEGACY / UNRESOLVED
  Current state: a bug — human evaluators should have URIs but don't (backfill needed).
  Target state for this plan: eliminate this case by backfilling URIs.
```

This is NOT "two fully independent axes". The provider constrains runnability:
- `agenta:*` → runnable (platform guarantee)
- `user:*` → runnable only with handler/URL
- No URI → not runnable during migration, then eliminated by backfill

### 4d. Workflow Purpose Spectrum

Not all workflows are about running code. A workflow can serve different purposes depending on what it has:

| What It Has | URI? | Purpose | Example |
|-------------|------|---------|---------|
| **Interface only** (schemas) | Has URI | Defines expected input/output shape, no engine | Human annotation definition (`agenta:custom:annotation:v0`) |
| **Interface + configuration** | Has URI | Full definition, but no engine yet | A workflow waiting to be deployed |
| **Interface + configuration + engine** (handler/URL) | Has URI | Full runnable | A deployed app or evaluator that can be invoked |

The relationship between URI and purpose:

- **No URI** = legacy / unresolved. In the current plan this should be backfilled, not preserved as a target state.
- **Has URI** = has an identity. May or may not have an interface, configuration, or engine.

The interface defines what a workflow accepts and produces (schemas for inputs, outputs, parameters). The configuration provides the actual parameter values. The engine (handler/URL) makes it executable.

Non-runnable workflows with URIs are still useful:
- **Interface-only:** Defines what annotations look like (human evaluators), or what a workflow will eventually accept when deployed
- **Interface + configuration:** Full definition ready to be deployed — just needs an engine

### 4e. Derived Properties

| Property | Derivation |
|----------|-----------|
| `is_custom` | `is_user_custom_uri(uri)` — `provider == "user" and kind == "custom"` |
| `is_builtin` | URI starts with `agenta:` |
| `is_runnable` | `agenta:*` URI → always true. `user:*` URI → true if has handler or URL. No URI → false during migration, then eliminated by backfill. |
| `has_interface` | `schemas is not None` (has input/output definitions) |
| `has_configuration` | `parameters is not None` (has configuration values) |

### 4f. What Replaces `is_human`

`is_human` should not survive as an authored flag. For the current migration path it is better modeled as URI-family-derived classification for the Agenta-managed custom annotation family, with any remaining runnability decision handled separately.

The derivation:
- `agenta:*` URI → runnable (always)
- `user:*` URI → runnable only if handler or URL present
- No URI → not runnable (legacy state to backfill)

An Agenta-managed human/custom annotation definition should be represented as `agenta:custom:annotation:v0` — it has a URI, it has an interface, and it may or may not have an engine. A simple custom invocation definition should be represented as `agenta:custom:invocation:v0`.

Non-runnable workflows:
- Have a URI (identity — who made them, which variant, which version)
- May have an interface schema (defines expected output shape / annotation format)
- May have configuration (parameter values)
- Have no invoke endpoint (nothing to invoke)
- Can receive external input (human annotation, external API callback, etc.)

---

## 5. Current URI Inventory (What Exists in DB)

Based on migration code and defaults:

| Source | URI Pattern | URL | Runnable | How Created |
|--------|------------|-----|----------|-------------|
| Builtin evaluators | `agenta:builtin:{key}:v0` | None (except webhook) | Yes (handler) | `build_evaluator_data()` |
| Legacy COMPLETION apps | `agenta:builtin:completion:v0` | None | Yes (handler) | Data migration |
| Legacy CHAT apps | `agenta:builtin:chat:v0` | None | Yes (handler) | Data migration |
| Legacy CUSTOM apps | `agenta:builtin:hook:v0` | None | Yes (handler) | Data migration (NOT `user:custom`!) |
| Legacy SDK_CUSTOM apps | `user:custom:{slug}:v0` | SDK endpoint | Yes (URL) | Data migration |
| SDK-deployed workflows | `user:custom:{module}.{name}:latest` | SDK endpoint | Yes (URL) | `register_handler()` |
| Human evaluators | **`None`** (no URI) | None | No | `defaults.py` — only `service.format` |

### Historical URI Format Change

- Old: `agenta:built-in:*` (with hyphen)
- New: `agenta:builtin:*` (no hyphen)
- Migrated via SQL: `workflow_uri.py` data migration

---

## 6. What Needs to Change

### 6a. Give Human Evaluators URIs

Today's human evaluators have `uri=None`. They should get proper URIs:
- Default human evaluator: `agenta:builtin:human:v0` (platform-provided, non-runnable)
- User-created human evaluators: `user:custom:{variant_slug}:v{N}` (user-defined schema, non-runnable)

This makes URI universal — every workflow has one. Runnability is determined separately.

### 6b. Align `user:custom` URI Key with Variant Slug, Version with Revision Version

Currently:
- Builtin URIs use handler names as keys (`echo`, `auto_exact_match`)
- Custom URIs use `module.function_name` or app slug
- Neither maps to variant slugs

Proposed:
- For backend-defined `user:custom` cases, URI key = variant slug
- For backend-defined `user:custom` cases, URI version = `v{revision_version}` (where revision_version is the integer from the DB)
- `latest` resolves to highest version

This gives a natural mapping: `user:custom:my-app-variant:v3` → variant slug `my-app-variant`, revision version 3.

For builtins, the third URI field remains the builtin handler/catalog key, and the version remains the builtin version rather than the backend revision version.

### 6c. Stop Storing `is_custom` and `is_human` as Flags

Both are derivable:
- `is_custom` → `is_user_custom_uri(uri)` (already exists)
- `is_human`-style classification → derive from the Agenta custom annotation URI family during this migration

**Migration path:**
1. Backfill: give all human evaluators proper URIs
2. Add computed properties to DTOs that derive from URI + URL/handler
3. Keep stored flags for backward compat during transition
4. Stop writing the flags in new code
5. Drop stored flags

### 6d. Fix Legacy CUSTOM → `hook:v0` Mapping

The migration mapped `AppType.CUSTOM` → `agenta:builtin:hook:v0`. This is technically correct (the legacy "custom template" was a builtin hook template, not user-deployed code). But it's confusing because "custom" in legacy doesn't mean "custom" in URI terms.

**Action:** Document this mapping clearly. No data change needed — the URIs are correct.

### 6e. Frontend Must Stop Inferring `isCustom` from Schema Shape

The frontend has a fragile three-way OR:
```typescript
const isCustomFinal = Boolean(isCustom) || isCustomBySchema || isCustomByAppType
```

The `isCustomBySchema` path (no `inputs` or `messages` property → must be custom) is wrong — it's guessing based on schema shape. The API should provide the derived `is_custom` / `is_runnable` values explicitly.

**Action:** API returns derived classification in responses. Frontend uses it directly.

### 6f. Clarify `url` Purpose

`url` is not just "webhook URL". It's the HTTP endpoint for remote invocation of any workflow:
- Custom SDK workflows: `url` = SDK service endpoint
- Webhook evaluators: `url` = external webhook endpoint
- Builtins (in-process): `url` = None
- Non-runnable: `url` = None

`url` should be renamed or documented as "invocation endpoint" to avoid confusion with webhooks.

---

## 7. Summary: Clean State After Migration

```
Every workflow has:
  uri: str               — identity (provider:kind:variant_slug:version)
  url: Optional[str]     — invocation endpoint (HTTP), if remotely invocable

URI components map to git model:
  provider:kind           — ownership (agenta:builtin or user:custom)
  variant_slug            — which variant
  version                 — which revision (vN or latest)

Runnability rules:
  agenta:* URI            → always runnable (platform guarantees handlers)
  user:* URI + handler/URL → runnable
  user:* URI, no handler/URL → not runnable (definition only — has interface, no engine)
  no URI                  → legacy / unresolved state to backfill

Workflow purpose (what it has):
  configuration only      → configuration/settings store
  interface only          → schema definition (e.g., human evaluator)
  interface + configuration → full definition, no engine yet
  interface + configuration + engine → full runnable

Derived from uri:
  is_custom  = uri starts with "user:"
  is_builtin = uri starts with "agenta:"

Derived from uri + url + handler:
  is_runnable = agenta:* → true
                user:* → has handler OR has url
                no uri → false

No longer stored as flags:
  is_custom  — derive from uri
  is_human   — derive from not is_runnable
```
