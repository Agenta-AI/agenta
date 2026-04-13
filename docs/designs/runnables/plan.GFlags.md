# Plan: GFlags — Flag Semantics, URI Classification, and Frontend Consumption

> Status: draft
> Date: 2026-03-17
> Gaps addressed: G4, G11, G14, G15, G16, G17
> Companion: [gap.GFlags.md](./gap.GFlags.md), [taxonomy.md](./taxonomy.md), [plan.g5.md](./plan.g5.md)

---

## 1. Problem Statement

Six gaps share one root cause: flags are authored rather than derived.

- **G16** — `is_custom` and `is_feedback` are stored flags; they should derive from URI family and handler/URL presence
- **G14** — `is_custom` is detected three independent ways; controls request format, caching, and annotation origin — wrong concerns
- **G15** — `is_feedback` means "not runnable"; human evaluators have no URIs
- **G4** — `can_*` capability flags must not be added; capability derives from schema/HTTP/URI
- **G11** — Frontend reads flags from legacy `/openapi.json` `x-agenta.flags`; new system not consumed
- **G17** — Playground has no per-invocation mode toggles and no streaming response handling

Execution order: G16 → G14/G15 → G4 → G11 → G17.

---

## 2. Key Files

| File | Role |
|------|------|
| `sdk/agenta/sdk/models/workflows.py` | `WorkflowFlags` model definition |
| `sdk/agenta/sdk/engines/running/utils.py` | `is_user_custom_uri()`, `parse_uri()` |
| `sdk/agenta/sdk/decorators/running.py` | `@workflow`, `@evaluator`, flag injection, `annotate` param |
| `api/oss/src/core/workflows/dtos.py` | API-side `WorkflowFlags`, `WorkflowQueryFlags` |
| `api/oss/src/core/evaluators/defaults.py` | Default human evaluator seed (`is_feedback=True`, `uri=None`) |
| `api/oss/src/core/annotations/service.py` | `AnnotationOrigin` derivation from flags |
| `api/oss/src/services/legacy_adapter.py` | `_template_key_to_flags()`, `_flags_to_app_type()` |
| `api/oss/src/dbs/postgres/workflows/dbes.py` | Stored `flags` column on workflow revision DBE |
| `web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts` | `isChatVariant` — reads `x-agenta.flags` from legacy OpenAPI |
| `web/packages/agenta-entities/src/runnable/bridge.ts` | Runnable bridge — uses `isChatVariant` for execution mode |
| `web/oss/src/lib/shared/variant/transformer/transformToRequestBody.ts` | `isCustomFinal` — three-way OR, fragile schema inference |
| `web/oss/src/services/workflows/invoke.ts` | `invokeApplication()`, `invokeEvaluator()` — batch-only, no Accept |

---

## 3. Phase 1 — URI Backfill and Computed Classification (G16 + G15)

This is the foundation. All downstream work depends on URIs being present and classification being derivable.

### S1. DB migration — backfill URIs for human evaluators

Human evaluators currently have `uri=NULL` in workflow revision data. They need URIs before `is_feedback` can be derived from URI presence.

**Target mappings:**
- Default platform human evaluator (`is_feedback=True`, no variant slug / standard seed) → `agenta:builtin:human:v0`
- User-created human evaluators (`is_feedback=True`, has variant slug) → `user:custom:{variant_slug}:v{revision_version}`

**Migration logic:**
```sql
-- Default platform human evaluator
UPDATE workflow_revisions
SET data = jsonb_set(data, '{uri}', '"agenta:builtin:human:v0"')
WHERE data->>'uri' IS NULL
  AND data->'flags'->>'is_feedback' = 'true'
  AND <is_default_seed_condition>;

-- User-created human evaluators
UPDATE workflow_revisions wr
JOIN variants v ON wr.variant_id = v.id
SET wr.data = jsonb_set(
    wr.data,
    '{uri}',
    CONCAT('"user:custom:', v.slug, ':v', wr.version, '"')::jsonb
)
WHERE wr.data->>'uri' IS NULL
  AND wr.data->'flags'->>'is_feedback' = 'true';
```

**File:** new migration file in `api/oss/src/dbs/postgres/migrations/`

---

### S2. Add computed properties to API DTOs (G16)

**File:** `api/oss/src/core/workflows/dtos.py`

Add computed (read-only) fields to `WorkflowRevisionData` or `WorkflowFlags`:

```python
from agenta.sdk.engines.running.utils import is_user_custom_uri, parse_uri

class WorkflowFlags(BaseModel):
    is_custom: bool = False
    is_evaluator: bool = False
    is_feedback: bool = False
    is_chat: bool = False

class WorkflowDerivedFlags(BaseModel):
    """Computed at read time from URI + handler/URL presence. Not stored."""
    is_custom: bool
    is_runnable: bool

def derive_flags(uri: Optional[str], url: Optional[str]) -> WorkflowDerivedFlags:
    """
    is_custom  ← URI family user:custom:*
    is_runnable ← agenta:* always True
                  user:* only if url present (no in-process handler check at API layer)
                  no URI → False
    """
    if uri is None:
        return WorkflowDerivedFlags(is_custom=False, is_runnable=False)
    provider, kind, _, _ = parse_uri(uri)
    _is_custom = provider == "user" and kind == "custom"
    if provider == "agenta":
        _is_runnable = True
    elif provider == "user":
        _is_runnable = bool(url)
    else:
        _is_runnable = False
    return WorkflowDerivedFlags(is_custom=_is_custom, is_runnable=_is_runnable)
```

Expose `derived` on query/revision responses so API consumers can use it without recomputing.

---

### S3. Update `AnnotationOrigin` derivation (G16)

**File:** `api/oss/src/core/annotations/service.py`

Replace flag-based derivation (lines 214-219) with URI + runnability:

```python
# Before
origin = (
    AnnotationOrigin.CUSTOM if annotation_flags.is_custom
    else AnnotationOrigin.HUMAN if annotation_flags.is_feedback
    else AnnotationOrigin.AUTO
)

# After
from agenta.sdk.engines.running.utils import is_user_custom_uri, parse_uri

def _derive_annotation_origin(uri: Optional[str], is_runnable: bool) -> AnnotationOrigin:
    if not is_runnable:
        return AnnotationOrigin.HUMAN
    if uri and is_user_custom_uri(uri):
        return AnnotationOrigin.CUSTOM
    return AnnotationOrigin.AUTO
```

Update both call sites (lines ~88, ~184) to use `_derive_annotation_origin`.

---

### S4. `user:custom` URI key alignment (G16b)

**File:** `api/oss/src/core/workflows/service.py` (and evaluators/applications service)

When creating or committing a workflow revision for user-deployed code, generate the URI:

```python
def _build_user_custom_uri(variant_slug: str, revision_version: int) -> str:
    return f"user:custom:{variant_slug}:v{revision_version}"
```

Ensure new revisions get a URI at creation time rather than inheriting `None`.

---

## 4. Phase 2 — `is_custom` Cleanup (G14)

Depends on Phase 1 (URIs must be present before stored flag can be removed).

### S5. Stop storing `is_custom` — derive at read time

**File:** `api/oss/src/dbs/postgres/workflows/mappings.py`

At DBE → DTO mapping time, compute `is_custom` from URI instead of reading the stored flag:

```python
def _map_flags(dbe_data: dict) -> WorkflowFlags:
    uri = dbe_data.get("uri")
    stored_flags = dbe_data.get("flags", {})
    derived = derive_flags(uri, dbe_data.get("url"))
    return WorkflowFlags(
        is_custom=derived.is_custom,          # from URI, ignore stored value
        is_evaluator=stored_flags.get("is_evaluator", False),
        is_feedback=not derived.is_runnable,     # from runnability, ignore stored value
        is_chat=stored_flags.get("is_chat", False),  # still stored for now
    )
```

Stop writing `is_custom` to new revision data (write path).

---

### S6. Separate request wire format from `is_custom` (G14 frontend)

**File:** `web/oss/src/lib/shared/variant/transformer/transformToRequestBody.ts`

Replace the three-way `isCustomFinal` OR with schema-driven detection:

```typescript
// Before — fragile
const isCustomBySchema = Boolean(spec) && !hasInputsProperty && !hasMessagesProperty && !(isChat ?? variant?.isChat)
const isCustomByAppType = (appType || "").toLowerCase() === "custom"
const isCustomFinal = Boolean(isCustom) || isCustomBySchema || isCustomByAppType

// After — schema-driven
// Use interface schema to determine input wrapping:
// If schema has an explicit "inputs" property → wrap inputs under "inputs" key
// If schema has "messages" property → chat format
// Otherwise → flat (keys at top level)
const hasExplicitInputsWrapper = Boolean(spec?.properties?.inputs)
const useWrappedInputs = hasExplicitInputsWrapper
const useChatFormat = hasMessagesProperty || (isChat ?? variant?.isChat)
```

The `isCustom` flag should no longer control request format. Only use `isCustom` for informational display.

---

### S7. Separate caching/refresh policy from `is_custom` (G14 frontend)

**File:** Wherever `staleTime` and spec-refresh interval are set for variants

Replace `isCustom`-keyed policy with URL-presence-keyed policy:

```typescript
// Before
staleTime: isCustom ? undefined : 5 * 60 * 1000
specRefreshInterval: isCustom ? 60_000 : undefined

// After
const hasRemoteUrl = Boolean(variant?.url)
staleTime: hasRemoteUrl ? undefined : 5 * 60 * 1000
specRefreshInterval: hasRemoteUrl ? 60_000 : undefined
```

---

## 5. Phase 3 — Stop Authoring Capability Flags (G4)

This phase is primarily about not adding new flags, plus cleanup of `annotate`.

### S8. Remove `annotate` from `@workflow` decorator

**File:** `sdk/agenta/sdk/decorators/running.py`

Remove the `annotate` param from `workflow.__init__()`. Trace type (annotation vs invocation) should be determined by the trace ingestion layer based on links and context, not authored as a decorator flag.

**Files:**
- `sdk/agenta/sdk/decorators/running.py` — remove `annotate` param, remove `running_ctx.annotate = self.annotate`
- `sdk/agenta/sdk/contexts/running.py` — remove `annotate` field from `RunningContext`

---

### S9. Derive `is_chat` from schema at materialization time

**File:** `api/oss/src/dbs/postgres/workflows/mappings.py`

When materializing flags during workflow revision creation (inspect result → stored revision), set `is_chat` from the schema:

```python
def _derive_is_chat(schemas: Optional[dict]) -> bool:
    """True if the workflow's inputs schema has a 'messages' property."""
    inputs_schema = (schemas or {}).get("inputs", {})
    properties = inputs_schema.get("properties", {})
    return "messages" in properties
```

This makes `is_chat` a materialized derived flag, not an authored one.

---

### S10. Document: do not add `can_*` flags

Add a comment in `sdk/agenta/sdk/models/workflows.py` and `api/oss/src/core/workflows/dtos.py`:

```python
class WorkflowFlags(BaseModel):
    # Identity flags — these are materialized from URI and schema at write time.
    # DO NOT add can_stream, can_chat, can_evaluate, can_verbose here.
    # Streaming capability derives from HTTP Accept negotiation (see plan.g5.md).
    # Chat capability derives from schema having a 'messages' input field.
    # Evaluate behavior derives from trace ingestion routing.
    is_custom: bool = False
    is_evaluator: bool = False
    is_feedback: bool = False   # deprecated: use is_runnable (derived)
    is_chat: bool = False
```

---

## 6. Phase 4 — Frontend Flag Source Migration (G11)

Depends on the new system exposing flags in a stable form via API revision/query responses (S11 below).

Per-route `openapi.json` is dropped — flags are not embedded there.

### S11. Add `flags` and `derived` to API revision responses

**File:** `api/oss/src/apis/fastapi/workflows/models.py` (and applications, evaluators)

Include `WorkflowFlags` and `WorkflowDerivedFlags` in revision query responses:

```python
class WorkflowRevisionResponse(BaseModel):
    ...
    flags: WorkflowFlags
    derived: WorkflowDerivedFlags   # is_custom, is_runnable — computed, not stored
    schemas: Optional[WorkflowSchemas]
```

This gives the frontend a single clean source for flag reading.

---

### S12. Migrate frontend flag reading to API response

**File:** `web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts`

Replace legacy source reading with API-provided flags:

```typescript
// Before — reads from legacy /openapi.json x-agenta.flags
const isChatVariant = readFromLegacyOpenApi(spec)

// After — reads from API revision response
const isChatVariant = revisionResponse.flags?.is_chat ?? false
const isRunnable = revisionResponse.derived?.is_runnable ?? false
const isCustom = revisionResponse.derived?.is_custom ?? false
```

Keep the legacy path as a fallback behind a feature flag until all deployments have the new API version.

---

### S13. Remove heuristic `messages` property fallback

**File:** `web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts:375`

Once API-provided flags are in place, remove:
```typescript
// Remove this fallback entirely
return Object.values(endpoints).some(
    (ep) => !!ep?.messagesSchema || ep?.requestProperties?.includes("messages"),
)
```

---

## 7. Phase 5 — Playground Toggles and Response Modes (G17)

Depends on: G5 (streaming backend), G11 (new flag source).

### S14. Streaming response handling in playground

**File:** `web/oss/src/services/workflows/invoke.ts`

Add SSE response handling:

```typescript
async function invokeApplicationStreaming(
    params: InvokeParams,
    onChunk: (chunk: unknown) => void,
    signal?: AbortSignal,
): Promise<void> {
    const response = await fetch(invokeUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
        body: JSON.stringify(params),
        signal,
    })
    if (!response.ok) throw new InvokeError(response)
    const reader = response.body!.getReader()
    // parse SSE chunks and call onChunk
    await readSSEStream(reader, onChunk)
}
```

**Playground UI** — add stream toggle (shown only when `is_runnable=true` and workflow supports streaming, detected from inspect response):

```tsx
{canStream && (
    <Toggle
        checked={streamMode}
        onChange={setStreamMode}
        label="Stream"
    />
)}
```

---

### S15. Chat/completion mode toggle

Show mode toggle only when `is_chat` is true AND the workflow's schema supports both modes (both `inputs` and `messages` paths).

**File:** Playground mode selector component

```tsx
{isChat && supportsCompletionMode && (
    <SegmentedControl
        value={mode}
        onChange={setMode}
        options={[
            { label: "Chat", value: "chat" },
            { label: "Completion", value: "completion" },
        ]}
    />
)}
```

---

### S16. Verbose/concise response toggle

Show toggle only when `is_chat=true` and `is_verbose=false` (concise mode available).

```tsx
{isChat && !isVerbose && (
    <Toggle
        checked={verboseMode}
        onChange={setVerboseMode}
        label="Verbose"
    />
)}
```

Response rendering:
- Concise: extract last assistant message from response
- Verbose: render full structured payload

---

### S17. Disable toggles for unsupported capabilities

Any toggle that is shown when the capability is not available should be hidden or disabled, not just non-functional.

**Rule:** if the inspect/API response does not confirm a capability, the toggle does not render. Attempting to use an unsupported mode should produce a clear error state, not a silent failure.

---

## 8. Affected Files Summary

| File | Change | Phase |
|------|--------|-------|
| `api/oss/src/dbs/postgres/migrations/` | New migration: backfill URIs for human evaluators | Phase 1 |
| `api/oss/src/core/workflows/dtos.py` | Add `WorkflowDerivedFlags`, `derive_flags()` | Phase 1 |
| `api/oss/src/core/annotations/service.py` | Replace flag-based `AnnotationOrigin` with URI + runnability | Phase 1 |
| `api/oss/src/core/workflows/service.py` | Generate `user:custom:{slug}:v{N}` URI at revision creation | Phase 1 |
| `api/oss/src/dbs/postgres/workflows/mappings.py` | Compute `is_custom`/`is_feedback` from URI at read time | Phase 2 |
| `web/oss/src/lib/shared/variant/transformer/transformToRequestBody.ts` | Replace `isCustomFinal` with schema-driven format detection | Phase 2 |
| Variant cache/refresh config | Replace `isCustom`-keyed policy with URL-presence-keyed | Phase 2 |
| `sdk/agenta/sdk/decorators/running.py` | Remove `annotate` param from `@workflow` | Phase 3 |
| `sdk/agenta/sdk/contexts/running.py` | Remove `annotate` field from `RunningContext` | Phase 3 |
| `api/oss/src/dbs/postgres/workflows/mappings.py` | Derive `is_chat` from schema during materialization | Phase 3 |
| `sdk/agenta/sdk/models/workflows.py` | Add no-`can_*` comment guard | Phase 3 |
| `api/oss/src/apis/fastapi/workflows/models.py` | Add `derived: WorkflowDerivedFlags` to revision responses | Phase 4 |
| `web/packages/agenta-entities/src/legacyAppRevision/api/schemaUtils.ts` | Migrate flag reading to API response | Phase 4 |
| `web/oss/src/services/workflows/invoke.ts` | Add SSE streaming invoke path | Phase 5 |
| Playground mode/stream/verbose toggle components | Add per-invocation toggles | Phase 5 |

---

## 9. Tests

### Phase 1 — URI backfill and derived flags

- Migration: human evaluators with `uri=NULL` get correct URIs after migration
- Migration: custom workflows already with `uri=user:custom:*` are not changed
- `derive_flags(uri=None, url=None)` → `is_custom=False, is_runnable=False`
- `derive_flags(uri="agenta:builtin:echo:v0", url=None)` → `is_custom=False, is_runnable=True`
- `derive_flags(uri="user:custom:my-app:v3", url=None)` → `is_custom=True, is_runnable=False`
- `derive_flags(uri="user:custom:my-app:v3", url="http://...")` → `is_custom=True, is_runnable=True`
- `AnnotationOrigin` derivation: `is_runnable=False` → `HUMAN`; `is_runnable=True + custom URI` → `CUSTOM`; `is_runnable=True + builtin URI` → `AUTO`

### Phase 2 — `is_custom` cleanup

- DBE → DTO mapping: `is_custom` reads from URI, ignores stored flag
- `transformToRequestBody`: builtin workflow with explicit `inputs` schema → wrapped format
- `transformToRequestBody`: custom workflow with flat schema → flat format
- `transformToRequestBody`: no fragile `!hasInputsProperty` inference
- Cache config: workflow with URL → aggressive refresh; workflow without URL → stable cache

### Phase 3 — capability flag authoring

- `@workflow` decorator: no `annotate` param accepted (signature test)
- `RunningContext`: no `annotate` field
- `is_chat` materialization: workflow with `messages` input schema → `is_chat=True` in stored flags

### Phase 4 — frontend flag source

- API revision response includes `flags.is_chat` and `derived.is_runnable`, `derived.is_custom`
- Frontend reads `isChatVariant` from `revisionResponse.flags.is_chat`
- No `x-agenta.flags` read path in `schemaUtils.ts` (legacy code removed)
- No heuristic `messages` property fallback

### Phase 5 — playground

- Stream toggle visible when inspect confirms streaming capability; hidden otherwise
- SSE invoke: chunks arrive incrementally, abort cancels stream
- Chat mode toggle visible when `is_chat=true`; hidden otherwise
- Verbose toggle visible when `is_chat=true` and `is_verbose=false`
- Toggle for unsupported capability: does not render

---

## 10. Non-Goals

- Removing the legacy serving system (G1) — separate effort
- Route isolation for `/invoke` and `/inspect` (G13) — separate plan
- G5 streaming backend changes — handled in `plan.g5.md`; G17 frontend work consumes G5 output
- Removing `is_chat` from the flag model entirely — it stays as materialized metadata; only authoring is removed
- Removing `is_evaluator` from stored flags — it does not derive cleanly from URI today; leave as authored for now

---

## Appendix A — Flag Inference Rules (`infer_flags_from_data`)

> Status: draft (iterable — update this appendix as rules change)
> Last updated: 2026-03-18

Flags are **inferred at commit/write time** in the core service layer, not at read time. When a workflow revision is about to be saved, call `infer_flags_from_data(uri, schemas)` to compute the full flag set and store it. The stored flags are the canonical source — no inference at read time.

### Inputs

| Parameter | Source | Inference |
|-----------|--------|-----------|
| `uri` | `WorkflowRevisionData.uri` | drives all URI-derived flags |
| `schemas` | `WorkflowRevisionData.schemas` | drives schema-derived flags |
| `is_evaluator` | caller-provided (creation / edit payload) | caller wins if provided; table default otherwise |
| `is_application` | caller-provided (creation / edit payload) | caller wins if provided; table default otherwise |

---

### URI-Derived Flags

URI components (from `parse_uri(uri)`): `provider : kind : key : version`

**Identity / topology:**

| Flag | Rule | Examples |
|------|------|---------|
| `is_custom` | `kind == "custom"` | `agenta:custom:feedback:v0` → T, `user:custom:my-app:v3` → T, `agenta:builtin:echo:v0` → F |
| `is_managed` | `provider == "agenta"` | `agenta:*` → T, `user:custom:*` → F |

Dropped as redundant: `is_builtin` (`not is_custom`), `is_internal` (`not is_managed`).

Dropped as redundant: `is_feedback` (`is_managed and is_custom and is_feedback`).

**Key-based type flags** (derived from the `key` component, regardless of provider):

| Flag | Rule | Examples |
|------|------|---------|
| `is_llm` | `key == "llm"` | `agenta:builtin:llm:v0` → T |
| `is_hook` | `key == "hook"` | `agenta:custom:hook:v0` → T |
| `is_code` | `key == "code"` | `agenta:custom:code:v0` → T |
| `is_feedback` | `key == "trace"` | `agenta:custom:feedback:v0` → T |
| `is_match` | `key == "match"` | `agenta:builtin:match:v0` → T |

---

### Schema-Derived Flags

| Flag | Schema Location | Rule |
|------|-----------------|------|
| `is_chat` | `schemas.outputs` | `schemas.outputs` has `x-ag-message(s)` somewhere |
| `is_structured` | `schemas.outputs` | `schemas.outputs` is valid JSON schema |

---

### Interface-Derived Flags

A workflow is runnable if it has either a URL (remote endpoint) or a handler (local in-process function). The URL is always present for `agenta:builtin:*` (inferred by the platform). For `*:custom:*` families, both URL and handler may be absent.

| URI family | URL source | Handler source |
|------------|------------|----------------|
| `agenta:builtin:*` | Inferred by platform — always present | n/a |
| `agenta:custom:feedback:*` | None — not invocable | None |
| `agenta:custom:{code,hook}:*` | User-defined — may be absent | SDK registration — may be absent |
| `user:custom:*` | User-defined — may be absent | SDK registration — may be absent |

| Flag | Rule | Available |
|------|------|-----------|
| `has_url` | `bool(url)` | API + SDK |
| `has_handler` | `bool(handler)` | SDK only — resolved via `HANDLER_REGISTRY` |
| `has_script` | `bool(script)` | API + SDK — from `WorkflowServiceConfiguration.script` |

`handler` is only resolvable in the SDK. At the API layer `has_handler` is always `False`.

Dropped as redundant: `is_runnable` (`has_url or has_handler`).

---

### User-Defined Flags

Provided by the caller at creation or edit time. The lookup table defines default values when the caller omits them; the caller's value always wins when present.

| Flag | Default lookup table (by URI) |
|------|-------------------------------|
| `is_evaluator` | see table below |
| `is_application` | see table below |

| URI Pattern | `is_evaluator` default | `is_application` default |
|-------------|------------------------|--------------------------|
| `agenta:custom:code:*` | T | T |
| `agenta:custom:hook:*` | T | T |
| `agenta:custom:feedback:*` | T | T |
| `agenta:builtin:chat:*` | F | T |
| `agenta:builtin:completion:*` | F | T |
| `agenta:builtin:match:*` | T | F |
| `agenta:builtin:llm:*` | T | T |
| `agenta:builtin:*` (all others) | T | F |
| `none` | ? | ? |

The table is **positively exhaustive** for `agenta:*` — unknown keys raise an error. For `user:custom:*` and `none`, defaults fall through to `(True, False)` unless caller overrides.

---

### Python Pseudocode

```python
# Positively exhaustive lookup: agenta:* URIs → (is_evaluator, is_application)
# Every known agenta URI key must appear here.
# agenta:builtin:chat and agenta:builtin:completion are the ONLY application-only builtins.
# All other agenta:builtin:* are evaluator-only.
_AGENTA_ROLE_TABLE: Dict[Tuple[str, str], Tuple[bool, bool]] = {
    # (kind, key):               (is_evaluator, is_application)
    ("custom",  "code"):         (True,  True),
    ("custom",  "hook"):         (True,  True),
    ("custom",  "trace"):        (True,  True),
    ("builtin", "chat"):         (False, True),
    ("builtin", "completion"):   (False, True),
    ("builtin", "match"):        (True,  False),
    ("builtin", "llm"):          (True,  True),
    # add new agenta builtin/custom keys here as they are introduced
}
# No default — unknown agenta URI keys raise an error to force explicit classification


def infer_flags_from_data(
    *,
    uri: Optional[str],
    url: Optional[str],
    script: Optional[str] = None,        # from WorkflowServiceConfiguration.script
    handler: Optional[Callable] = None,  # SDK only — from HANDLER_REGISTRY lookup
    schemas: Optional[JsonSchemas] = None,
    caller_is_evaluator: Optional[bool] = None,
    caller_is_application: Optional[bool] = None,
) -> WorkflowFlags:
    provider, kind, key, version = parse_uri(uri) if uri else (None, None, None, None)

    # Identity / topology
    is_custom   = kind == "custom"
    is_managed  = provider == "agenta"

    # Key-based type flags
    is_llm   = key == "llm"
    is_hook  = key == "hook"
    is_code  = key == "code"
    is_feedback = key == "trace"
    is_match = key == "match"

    # Interface-derived
    has_url     = bool(url)
    has_handler = bool(handler)
    has_script  = bool(script)

    # Role flags — table provides defaults, caller overrides for any URI
    if kind and key:
        if is_managed and (kind, key) not in _AGENTA_ROLE_TABLE:
            raise ValueError(
                f"Unknown agenta URI key ({kind!r}, {key!r}). "
                "Add it to _AGENTA_ROLE_TABLE with explicit is_evaluator / is_application."
            )
        default_evaluator, default_application = _AGENTA_ROLE_TABLE.get((kind, key), (False, False))
    else:
        default_evaluator, default_application = True, False  # none: evaluator by default

    # Caller-provided values win over table defaults (creation and edit time)
    is_evaluator   = caller_is_evaluator   if caller_is_evaluator   is not None else default_evaluator
    is_application = caller_is_application if caller_is_application is not None else default_application

    # Schema-derived
    outputs_schema = schemas.outputs if schemas and schemas.outputs else None
    inputs_schema  = schemas.inputs  if schemas and schemas.inputs  else None

    is_structured = bool(outputs_schema)

    def _has_ag_message(schema: Optional[dict]) -> bool:
        props = (schema or {}).get("properties", {})
        return any(
            prop.get("x-ag-message") or prop.get("x-ag-messages")
            for prop in props.values()
            if isinstance(prop, dict)
        )

    is_chat = _has_ag_message(inputs_schema) or _has_ag_message(outputs_schema)

    return WorkflowFlags(
        # topology
        is_custom=is_custom,
        is_managed=is_managed,
        # Interface
        has_url=has_url,
        has_handler=has_handler,
        has_script=has_script,
        # key-based type
        is_llm=is_llm,
        is_hook=is_hook,
        is_code=is_code,
        is_feedback=is_feedback,
        is_match=is_match,
        # role
        is_evaluator=is_evaluator,
        is_application=is_application,
        # schema-derived
        is_chat=is_chat,
        is_structured=is_structured,
    )
```

---

### Flag Matrix by URI Family

| URI Pattern | `is_custom` | `is_managed` | `is_llm` | `is_hook` | `is_code` | `is_feedback` | `is_match` | `has_url` | `has_handler` | `has_script` | `is_evaluator` | `is_application` |
|-------------|-------------|--------------|----------|-----------|-----------|------------|------------|-----------|---------------|--------------|----------------|-----------------|
| `agenta:builtin:chat:*` | F | T | F | F | F | F | F | T | F | F | F | T |
| `agenta:builtin:completion:*` | F | T | F | F | F | F | F | T | F | F | F | T |
| `agenta:builtin:match:*` | F | T | F | F | F | F | T | T | F | F | T | F |
| `agenta:builtin:llm:*` | F | T | T | F | F | F | F | T | F | F | T | T |
| `agenta:builtin:*` (all others) | F | T | F | F | F | F | F | T | F | F | T | F |
| `agenta:custom:code:*` | T | T | F | F | T | F | F | ? | ? | ? | T | T |
| `agenta:custom:hook:*` | T | T | F | T | F | F | F | ? | ? | ? | T | T |
| `agenta:custom:feedback:*` | T | T | F | F | F | T | F | F | F | F | T | T |
| `user:custom:*` | T | F | F | F | F | F | F | ? | ? | ? | T | F |
| `None` | F | F | F | F | F | F | F | F | F | F | T | F |

---

### Notes for Iteration

- `is_feedback` and `is_match` are key-based type flags (`key == "trace"`, `key == "match"`). `is_feedback` is dropped — it was redundant with `is_managed and is_custom and is_feedback`.
- `is_evaluator` and `is_application` for `agenta:*` URIs use the lookup table `_AGENTA_ROLE_TABLE` — it is **positively exhaustive**: every known key is listed, unknown keys raise. `agenta:builtin:chat` and `agenta:builtin:completion` are the only application-only builtins; all other builtins are evaluator-only. Update the table whenever a new agenta URI key is introduced.
- `is_evaluator` and `is_application` for `user:custom:*` are caller-provided at creation and edit time. If omitted by caller, they default to `False`. Do NOT infer them from URI for external workflows.
- `is_structured` is a lightweight flag — it does not validate the schema, only checks presence. Schema validity is enforced by `WorkflowServiceInterface` model validator at parse time.
- `WorkflowFlags` model must be extended with: `is_managed`, `is_feedback`, `is_match`, `has_url`, `has_handler`, `has_script`, `is_llm`, `is_hook`, `is_code`, `is_application`, `is_structured` before `infer_flags_from_data` can be implemented. Drop `is_builtin`, `is_external`, `is_internal`, `is_feedback` — all redundant composites of the remaining flags.
- Call site: `api/oss/src/core/workflows/service.py` during `commit_revision` — replace manual flag construction with `infer_flags_from_data(...)`.
- `AnnotationOrigin` derivation (S3) reads `flags.has_url`, `flags.has_handler`, and `flags.is_custom` from stored flags — no URI re-parse needed at annotation time.
