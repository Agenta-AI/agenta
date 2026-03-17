# Plan: GFlags — Flag Semantics, URI Classification, and Frontend Consumption

> Status: draft
> Date: 2026-03-17
> Gaps addressed: G4, G11, G14, G15, G16, G17
> Companion: [gap.GFlags.md](./gap.GFlags.md), [taxonomy.md](./taxonomy.md), [plan.g5.md](./plan.g5.md)

---

## 1. Problem Statement

Six gaps share one root cause: flags are authored rather than derived.

- **G16** — `is_custom` and `is_human` are stored flags; they should derive from URI family and handler/URL presence
- **G14** — `is_custom` is detected three independent ways; controls request format, caching, and annotation origin — wrong concerns
- **G15** — `is_human` means "not runnable"; human evaluators have no URIs
- **G4** — `can_*` capability flags must not be added; capability derives from schema/HTTP/URI
- **G11** — Frontend reads flags from legacy `/openapi.json` `x-agenta.flags`; new system not consumed
- **G17** — Playground has no per-invocation mode toggles and no streaming response handling

Execution order: G16 → G14/G15 → G4 → G11 → G17.

---

## 2. Key Files

| File | Role |
|------|------|
| `sdk/agenta/sdk/models/workflows.py` | `WorkflowFlags` model definition |
| `sdk/agenta/sdk/workflows/utils.py` | `is_custom_uri()`, `parse_uri()` |
| `sdk/agenta/sdk/decorators/running.py` | `@workflow`, `@evaluator`, flag injection, `annotate` param |
| `api/oss/src/core/workflows/dtos.py` | API-side `WorkflowFlags`, `WorkflowQueryFlags` |
| `api/oss/src/core/evaluators/defaults.py` | Default human evaluator seed (`is_human=True`, `uri=None`) |
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

Human evaluators currently have `uri=NULL` in workflow revision data. They need URIs before `is_human` can be derived from URI presence.

**Target mappings:**
- Default platform human evaluator (`is_human=True`, no variant slug / standard seed) → `agenta:builtin:human:v0`
- User-created human evaluators (`is_human=True`, has variant slug) → `user:custom:{variant_slug}:v{revision_version}`

**Migration logic:**
```sql
-- Default platform human evaluator
UPDATE workflow_revisions
SET data = jsonb_set(data, '{uri}', '"agenta:builtin:human:v0"')
WHERE data->>'uri' IS NULL
  AND data->'flags'->>'is_human' = 'true'
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
  AND wr.data->'flags'->>'is_human' = 'true';
```

**File:** new migration file in `api/oss/src/dbs/postgres/migrations/`

---

### S2. Add computed properties to API DTOs (G16)

**File:** `api/oss/src/core/workflows/dtos.py`

Add computed (read-only) fields to `WorkflowRevisionData` or `WorkflowFlags`:

```python
from agenta.sdk.workflows.utils import is_custom_uri, parse_uri

class WorkflowFlags(BaseModel):
    is_custom: bool = False
    is_evaluator: bool = False
    is_human: bool = False
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
    else AnnotationOrigin.HUMAN if annotation_flags.is_human
    else AnnotationOrigin.AUTO
)

# After
from agenta.sdk.workflows.utils import is_custom_uri, parse_uri

def _derive_annotation_origin(uri: Optional[str], is_runnable: bool) -> AnnotationOrigin:
    if not is_runnable:
        return AnnotationOrigin.HUMAN
    if uri and is_custom_uri(uri):
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
        is_human=not derived.is_runnable,     # from runnability, ignore stored value
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
    is_human: bool = False   # deprecated: use is_runnable (derived)
    is_chat: bool = False
```

---

## 6. Phase 4 — Frontend Flag Source Migration (G11)

Depends on the new system exposing flags in a stable form. This requires either:
- G13 (per-workflow `{path}/openapi.json`) to be available, OR
- API revision/query responses to include `derived` flags (S2 above)

### S11a. Embed flags in per-route `openapi.json`

**File:** `sdk/agenta/sdk/decorators/routing.py`

Pass `self.flags` into `_attach_openapi_schema` and embed as `info["x-agenta-flags"]`:

```python
# Call site (~line 606)
_attach_openapi_schema(sub_app, _workflow_name, _schemas, flags=self.flags)

# Function signature
def _attach_openapi_schema(sub_app, workflow_name, schemas, flags=None):
    def custom_openapi():
        ...
        if flags:
            schema.setdefault("info", {})["x-agenta-flags"] = flags
        ...
```

**Result:** `GET {path}/openapi.json` → `info["x-agenta-flags"]` mirrors `GET {path}/inspect` → `flags`. Both discovery surfaces carry the same flags.

---

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
| `api/oss/src/dbs/postgres/workflows/mappings.py` | Compute `is_custom`/`is_human` from URI at read time | Phase 2 |
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
- Per-workflow `/openapi.json` (G13) — separate plan
- G5 streaming backend changes — handled in `plan.g5.md`; G17 frontend work consumes G5 output
- Removing `is_chat` from the flag model entirely — it stays as materialized metadata; only authoring is removed
- Removing `is_evaluator` from stored flags — it does not derive cleanly from URI today; leave as authored for now
