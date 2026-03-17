# Gap Analysis: GFlags — Flag Semantics, URI Classification, and Frontend Consumption

> Status: gap analysis (consolidated)
> Date: 2026-03-17
> Gaps covered: G4, G11, G14, G15, G16, G17
> Companion: [gap-analysis.md](./gap-analysis.md), [taxonomy.md](./taxonomy.md), [plan.GFlags.md](./plan.GFlags.md)

---

## Overview

These six gaps share a root cause: **flags are used as the primary authoring contract for what are actually derived, negotiated, or schema-driven properties.** Identity, capability, and request semantics are authored as boolean flags rather than derived from URIs, schemas, and HTTP standards. The result is inconsistency across layers, fragile frontend inference, and a frontend that cannot adapt to per-invocation behavior.

Dependency chain:

```
G16 (URI-derived classification)
  ├─→ G14 (is_custom from URI, not schema inference)
  ├─→ G15 (is_runnable from handler/URL, not is_human flag)
  └─→ G4  (is_chat from schema; stop authoring can_* flags)
        └─→ G11 (frontend reads from /inspect or API, not legacy x-agenta.flags)
              └─→ G17 (playground toggles keyed on derived capabilities)
```

G16 is the foundation. The rest become cleanup or become implementable once URIs are canonical.

---

## G4 — Primary Flag-Centric Contract Should Be Removed

### What

The current `WorkflowFlags` model (SDK: `sdk/agenta/sdk/models/workflows.py:66-70`, API: `api/oss/src/core/workflows/dtos.py:94-106`) contains only identity flags:

```python
class WorkflowFlags(BaseModel):
    is_custom: bool = False
    is_evaluator: bool = False
    is_human: bool = False
    is_chat: bool = False
```

Capability flags (`can_stream`, `can_evaluate`, `can_chat`, `can_verbose`) **do not exist**. The prior design direction expected these to be authored — the updated direction in gap-analysis.md G4 reverses that: **stop expanding this flag surface**.

At runtime, `Metadata.flags` in `sdk/agenta/sdk/models/workflows.py` is an open dict (`Flags = Dict[str, LabelJson]`), not the typed model above. Flags are merged at invoke time (`running.py:301-313`): `_flags = {**(self.flags or {}), **(request.flags or {})}`. This allows arbitrary extension with no schema contract.

The `annotate` param on `@workflow` stores an annotation-vs-invocation signal in `RunningContext`. It influences trace type but is not connected to any public API surface — it is an internal implementation detail currently shaped like an authored flag.

### Why It Matters

Adding `can_stream`, `can_chat`, `can_evaluate`, `can_verbose` as authored flags reproduces the same problem already diagnosed in G5, G11, and G14. These properties should come from:

- **Stream/batch** → HTTP `Accept`-driven negotiation (G5, already planned in `plan.g5.md`)
- **Chat behavior** → schema-driven: explicit `messages` input schema implies chat capability
- **Evaluate mode** → trace ingestion and observability, not authored runnable flags
- **Identity** → URI family derivation (G16)

### Current State

| Flag | Where Set | What It Should Be |
|------|-----------|-------------------|
| `is_custom` | SDK URI detection, API legacy adapter, frontend schema inference | Derived from URI family (see G14, G16) |
| `is_evaluator` | SDK `evaluator` class decorator (`running.py:664`) | Could derive from URI kind `evaluator` family — for now, authored is acceptable |
| `is_human` | API `evaluators/defaults.py:144`, annotations service | Derived from runnability (see G15, G16) |
| `is_chat` | Not auto-set; set explicitly or from legacy migration | Derived from schema: `messages` input shape present |
| `can_*` | **Does not exist** | Do not add; derive from HTTP negotiation / schema / URI |

### Action

- [ ] Stop adding authored capability flags (`can_stream`, `can_evaluate`, `can_chat`, `can_verbose`)
- [ ] Remove `annotate` param from `@workflow` decorator; make trace type an internal routing decision
- [ ] Derive `is_chat` from schema at materialization time: presence of `messages` input → `is_chat=True`
- [ ] Redefine stored `WorkflowFlags` as materialized metadata only — derived at write time, not authored

---

## G11 — Frontend Flag Reading: Only Legacy Source

### What

The frontend reads `is_chat` (and all other flags) exclusively from the legacy `/openapi.json` via `x-agenta.flags`. No consumption of `/inspect` or API-provided flags exists.

**Primary read path** (`web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts:359-375`):

```typescript
const isChatVariant = (() => {
    for (const name of endpointNames) {
        const path = constructEndpointPath(routePath, name)
        const operation = spec?.paths?.[path]?.post as Record<string, unknown> | undefined
        const agentaExt = operation?.["x-agenta"] as Record<string, unknown> | undefined
        const flags = agentaExt?.flags as Record<string, unknown> | undefined
        if (flags && typeof flags.is_chat === "boolean") {
            return flags.is_chat
        }
    }
    // Fallback: heuristic — check for messages schema property
    return Object.values(endpoints).some(
        (ep) => !!ep?.messagesSchema || ep?.requestProperties?.includes("messages"),
    )
})()
```

Result stored in `RevisionSchemaState.isChatVariant` (`legacyAppRevision/api/types.ts`). The runnable bridge (`runnable/bridge.ts`) uses `isChatVariant` to pick execution mode: `"chat"` or `"completion"`.

### Why It Matters

The legacy `/openapi.json` with `x-agenta` extensions is tied to the legacy serving system (G1). The new `/inspect` endpoint returns a proprietary `WorkflowServiceRequest` format — it does not produce OpenAPI. Until the new system exposes flags + schemas in a stable form, the frontend cannot migrate.

The heuristic fallback is fragile: any workflow with a `messages` input is classified as chat whether it is or not.

### Current State

| Source | Location | What's Read | Reliability |
|--------|----------|-------------|-------------|
| `/openapi.json` `x-agenta.flags` | Legacy serving only | `is_chat` | Tied to legacy SDK serving |
| Schema heuristic | `schemaUtils.ts:375` | `messages` presence → `is_chat` | Fragile |
| `/inspect` response | Not consumed anywhere | — | Unused |
| API revision response | Not consumed for flags | — | Unused |

### Action

- [ ] Migrate flag reading to the new system: `/inspect` response, per-workflow `/openapi.json` (G13), or API-provided classification in revision/query responses
- [ ] The new source must expose at minimum: `is_chat`, `is_evaluator`, `is_custom`, `is_runnable`, and schemas
- [ ] Remove the `x-agenta.flags` reading path once the new source is stable
- [ ] Remove the heuristic `messages` property fallback — use explicit flags from the authoritative source

---

## G14 — `is_custom`: Overloaded Semantics and Fragile Detection

### What

`is_custom` nominally means "user-deployed code, not backend-managed builtin". But it is detected in three independent ways across layers, and its value controls three unrelated behaviors that have nothing to do with deployment topology.

### Three Sources of Truth

**1. SDK — URI-based** (`sdk/agenta/sdk/workflows/utils.py:320-326`):

```python
def is_custom_uri(uri):
    provider, kind, key, version = parse_uri(uri)
    return provider == "user" and kind == "custom"
```

Auto-set in `running.py:202-218`: `self.flags["is_custom"] = True` for custom URIs. Also defaults to `True` when no URI is given (custom code with no explicit URI registered).

**2. API — Legacy adapter** (`api/oss/src/services/legacy_adapter.py:1224, 1285`):
- Line 1224: returns `ApplicationFlags(is_custom=True)` when mapping legacy `AppType.CUSTOM`
- Line 1285: reads `flags.is_custom` to determine which legacy response format to produce

**3. Frontend — Schema inference** (`web/oss/src/lib/shared/variant/transformer/transformToRequestBody.ts:60-70`):

```typescript
const isCustomBySchema = Boolean(spec) && !hasInputsProperty && !hasMessagesProperty && !(isChat ?? variant?.isChat)
const isCustomByAppType = (appType || "").toLowerCase() === "custom"
const isCustomFinal = Boolean(isCustom) || isCustomBySchema || isCustomByAppType
```

A workflow that lacks an `inputs` property in its schema is assumed custom. This is fragile and incorrect.

### What `is_custom` Controls (Wrong Concerns)

| Layer | Behavior Driven By `is_custom=true` | What Should Drive It Instead |
|-------|-------------------------------------|------------------------------|
| SDK | URI namespace `user:custom:*` | Identity — correct, derivable from URI |
| API | `AnnotationOrigin.CUSTOM` (`annotations/service.py:88`) | URI + runnability (see G16) |
| API | Legacy adapter maps to `AppType.CUSTOM` | Legacy compat only — remove with adapter |
| Frontend | Input keys extracted flat, not wrapped in `inputs` container | Interface schema shape |
| Frontend | Parameters flattened to top level | Interface schema shape |
| Frontend | Cache disabled (`staleTime: undefined` vs 5 min) | Whether workflow has a remote URL |
| Frontend | OpenAPI spec polled every 1 minute | Whether workflow has a remote URL |

The request serialization behavior (flat inputs vs `inputs`-wrapped) is the biggest practical impact. This should be driven by the interface schema — whether the workflow has an explicit `inputs` field — not by an identity flag.

### Action

- [ ] Derive `is_custom` from URI: `is_custom_uri(uri)` already exists in the SDK — use it at read time, stop storing it
- [ ] Separate request format from `is_custom`: wire format (flat vs wrapped inputs) should be driven by the interface schema
- [ ] Separate caching/refresh policy from `is_custom`: key on whether the workflow has a remote `url`
- [ ] Clean up `AnnotationOrigin` derivation to not depend on `is_custom` (see G16)
- [ ] Remove the frontend schema inference path for `isCustom` — fragile and incorrect

---

## G15 — `is_human`: Misnomer for "Not Runnable"

### What

`is_human` means **not runnable** — no handler, no code, no URI to invoke. The name implies human-in-the-loop specifically, but the concept is general: any workflow definition without an executable engine.

### How It Is Set

**1. API default evaluator creation** (`api/oss/src/core/evaluators/defaults.py:141-144`):

```python
flags=SimpleEvaluatorFlags(is_custom=False, is_human=True)
```

The seeded platform human evaluator gets `is_human=True`. This is the primary creation source.

**2. API annotation origin mapping** (`api/oss/src/core/annotations/service.py:88, 184`):

```python
is_human=annotation_create.origin == AnnotationOrigin.HUMAN
```

Annotations from human origin propagate `is_human=True` back to the evaluator flags.

**3. SDK**: Never sets `is_human=True`. `WorkflowFlags.is_human` defaults to `False`. If code runs in the SDK, the workflow is runnable by definition — SDK code always has a handler.

### What It Controls

| Layer | Behavior |
|-------|----------|
| API | Query filter: `SimpleEvaluatorQueryFlags(is_human=True)` — find non-runnable evaluators |
| API | Annotation origin: `is_human → AnnotationOrigin.HUMAN` |
| Frontend | Filter evaluator lists: separate human-only from automatic tabs |
| Frontend | Annotation drawer: `queries: {is_human: true}` — show non-runnable evaluators for manual annotation |
| Frontend | Skip navigation to non-runnable evaluators (nothing to inspect) |
| Frontend | `evaluationKind.ts` — classify evaluation runs as "human" type |

### Key Observations

1. **The real semantic is runnability.** No handler + no URL = not runnable. "Human evaluator" is just the primary use case today.
2. **Current correlation.** `is_human=true` correlates with `uri=None`, but this is fragile. Non-runnability is broader than URI absence: a `user:custom:*` workflow with no reachable URL is also non-runnable.
3. **Human evaluators have no URI today.** The default human evaluator is created with `data=SimpleEvaluatorData(service={...})` and `uri=None`. All human evaluators should have URIs:
   - Default platform evaluator → `agenta:builtin:human:v0`
   - User-created human evaluators → `user:custom:{variant_slug}:v{N}`
4. **Runnability rules by URI family:**
   - `agenta:*` → always runnable (platform ships and registers handlers)
   - `user:*` AND (has handler OR has url) → runnable
   - `user:*` AND no handler AND no url → not runnable
   - no URI → legacy state, treat as not runnable (backfill needed)

### Action

- [ ] Recognize `is_human` means "not runnable", not "human-operated"
- [ ] Derive runnability from handler/URL presence — not URI presence and not a stored flag
- [ ] Give all workflows URIs including human evaluators (backfill migration)
- [ ] Add `is_runnable` as a derived/computed property (replaces `is_human` semantically)
- [ ] Non-runnable workflows should not have invoke endpoints exposed

---

## G16 — `is_human` + `is_custom` Combined: Toward URI-Derived Classification

### What

Both `is_custom` and `is_human` encode information that can be derived from the URI and handler/URL presence. Storing them as authored flags leads to drift between what the flag says and what the URI says.

### Derivation Rules

```
is_custom   ← is_custom_uri(uri)                              # URI family user:custom:*
is_runnable ← agenta:* URI                         → true    # platform guarantees handlers
              user:* AND (has handler OR has url)  → true    # user code, engine present
              user:* AND no handler AND no url     → false   # user identity, no engine
              no URI                               → false   # legacy, backfill needed
```

`is_custom_uri()` already exists in `sdk/agenta/sdk/workflows/utils.py:320-326`. The derivation is available — it just isn't used at the DTO/API layer.

### URI Key Alignment for `user:custom`

For backend-defined user workflows (G16b), the URI must map to the git-style model:
- Format: `user:custom:{variant_slug}:v{revision_version}`
- Example: `user:custom:my-app:v3` → variant slug `my-app`, revision version 3
- `latest` resolves to highest `vN`

Builtins are different: `agenta:builtin:{key}:{builtin_version}` — the key is the builtin key, version is the builtin version (not revision version).

### Migration Gaps

| Entity | Current State | Target State |
|--------|--------------|--------------|
| Default human evaluator | `uri=None`, `is_human=True` stored | `uri=agenta:builtin:human:v0`, `is_runnable=False` derived |
| User-created human evaluators | `uri=None`, `is_human=True` stored | `uri=user:custom:{variant_slug}:v{N}`, `is_runnable=False` derived |
| Custom (user) workflows | `uri=user:custom:*`, `is_custom=True` stored | `is_custom` derived from URI, not stored |
| Legacy `AppType.CUSTOM` | Legacy adapter maps → `is_custom=True` | URI `agenta:builtin:hook:v0` (legacy "custom" = hook template) |

### `AnnotationOrigin` Re-derivation

Currently (`api/oss/src/core/annotations/service.py:214-219`):

```python
AnnotationOrigin.CUSTOM if annotation_flags.is_custom
else AnnotationOrigin.HUMAN if annotation_flags.is_human
else AnnotationOrigin.AUTO
```

Target (key off URI + runnability):

```python
AnnotationOrigin.AUTO    if is_runnable and not is_custom_uri(uri)  # builtin, agenta-managed
AnnotationOrigin.CUSTOM  if is_runnable and is_custom_uri(uri)      # user-deployed code
AnnotationOrigin.HUMAN   if not is_runnable                         # no engine, external annotation
```

### Action

- [ ] Add computed properties to DTOs: `is_custom` (from URI), `is_runnable` (from handler/URL)
- [ ] Backfill URIs for human evaluators (DB migration: set `uri` where `is_human=True` and `uri IS NULL`)
- [ ] Align `user:custom` URI key with variant slug, version with revision version
- [ ] Phase out stored `is_custom` / `is_human` flags — compute at read time, deprecate writes
- [ ] Update `AnnotationOrigin` derivation to key off URI + runnability
- [ ] Update legacy adapter to produce URIs instead of flags

---

## G17 — Frontend/Playground: No Request-Flag Support

### What

The playground has no mechanism to send per-invocation request options and no handling for different response modes. Everything is static and batch-only.

### Current State

**Request layer** (`web/oss/src/services/workflows/invoke.ts`):
- No `Accept` header set on invoke requests
- No stream/evaluate/chat/verbose signals sent
- Batch-only response handling

**Playground UI:**
- Chat vs completion mode: static, determined by `is_chat` identity flag from variant via legacy `/openapi.json` source — not switchable per-invocation
- No stream toggle, no verbose/concise toggle, no evaluate mode toggle

**SDK request model** (`sdk/agenta/sdk/models/workflows.py:182-221`):
`WorkflowServiceRequest` has `Metadata.flags` (open dict) — no typed schema for per-invocation request options. `stream`, `evaluate`, `chat`, `verbose` are not defined fields.

**Runnable bridge** (`web/packages/agenta-entities/src/runnable/bridge.ts`):
Uses `isChatVariant` from the legacy flag source to pick execution mode. No per-invocation mode selection.

### Relationship to Other Gaps

G17 is a consumer of the other gaps' outputs:

| Prerequisite | Provides | Needed For |
|---|---|---|
| G5 (`plan.g5.md`) | `Accept`-based streaming on backend | Frontend sets `Accept: text/event-stream` to get SSE |
| G11 (new flag source) | `is_chat`, `is_runnable` from inspect/API | Frontend knows what modes are available |
| G16 (URI derivation) | `is_runnable` computed | Frontend shows/hides invoke button |
| G4 (schema-driven `is_chat`) | `is_chat` from schema | Chat mode toggle available |

### Missing Response Handling

| Response Type | Current | Gap |
|---|---|---|
| JSON batch | ✅ Handled | None |
| SSE stream | ❌ Not handled | No chunk accumulation, no progressive render, no abort/cancel |
| NDJSON stream | ❌ Not handled | Same |
| Verbose chat | ❌ Not handled | Full structured payload rendering path |
| Concise chat | Partially (last message) | Tied to legacy `is_chat`, not an explicit mode |
| Evaluation trace | ❌ Not handled | Different trace shape, no UI for it |

### What Each Toggle Requires

| Toggle | Backend Prerequisite | Frontend Work |
|--------|---------------------|--------------|
| **Stream** | G5 done | Set `Accept: text/event-stream`; SSE chunk accumulation; progressive render; abort |
| **Chat/Completion** | `is_chat` from new source (G11/G4) | Mode toggle; chat UI = message thread, completion UI = form |
| **Verbose/Concise** | `is_verbose` flag + response shape defined | Renderer: concise = last assistant message, verbose = full payload |
| **Evaluate** | Evaluation trace shape defined | Show evaluation trace; hide invocation trace |

### Action

- [ ] Add stream toggle to playground when workflow supports streaming (derived from handler return type via inspect)
- [ ] Implement streaming response handling: SSE chunk accumulation, progressive render, abort
- [ ] Add chat/completion mode toggle when workflow supports both modes
- [ ] Add verbose/concise toggle for chat responses
- [ ] Handle evaluation mode traces
- [ ] Disable toggles when capability not advertised
- [ ] Define fallback UX when a requested mode is not supported

---

## Cross-Gap Summary

### Root Cause

All six gaps trace to the same anti-pattern: **authoring flags rather than deriving properties**.

| Property | Should Derive From | Currently |
|----------|--------------------|-----------|
| `is_custom` | URI family (`user:custom:*`) | Stored flag + fragile schema inference |
| `is_runnable` | Handler/URL presence | `is_human` stored flag (inverted) |
| `is_chat` | Schema: `messages` input shape | Stored flag + heuristic |
| Stream capability | Handler return type | Not exposed (`can_stream` should not be authored) |
| Request wire format | Interface schema shape | `is_custom` flag |
| Annotation origin | URI + runnability | `is_custom` + `is_human` flags |
| Frontend flag source | New `/inspect` or API response | Legacy `/openapi.json` `x-agenta.flags` |

### Priority Matrix

| Gap | Severity | Effort | Blocker For | Priority |
|-----|----------|--------|-------------|----------|
| G16 — URI-derived classification | High | Medium | G14, G15, G11 | 1 — foundational |
| G14 — `is_custom` cleanup | High | Medium | G11, G17 | 2 — depends on G16 |
| G15 — `is_human` / `is_runnable` | Medium | Small | G17 | 2 — depends on G16 |
| G4 — remove capability flag authoring | High | Small | G11 | 3 — stop expanding, then clean up |
| G11 — frontend flag source migration | High | Medium | G17 | 4 — depends on G4, G16 |
| G17 — playground toggles + response modes | Medium | Large | — | 5 — depends on G5, G11 |
