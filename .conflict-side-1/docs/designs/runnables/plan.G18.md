# Plan: G18 — Web Consumers Migrating off Legacy Serving Endpoints

> Status: draft
> Date: 2026-03-17
> Gap: [gap-analysis.md § G18](./gap-analysis.md#g18-web-consumers-still-targeting-legacy-serving-endpoints)
> Unblocks: [plan.G1.md § S2](./plan.G1.md#s2-checkpoint-2--remove-legacy-system)

---

## Goal

Migrate all web consumers off `/test`, `/run`, `/generate`, `/generate_deployed` and onto `{routePath}/invoke`. This unblocks G1 checkpoint 2 (removal of `serving.py`).

---

## Consumer Inventory

### C1. Playground invocation URL

**File:** `web/packages/agenta-entities/src/legacyAppRevision/state/runnableSetup.ts`

```typescript
// line 52 — maps execution mode to legacy endpoint suffix:
return mode === "deployed" ? "/run" : "/test"

// line 60 — builds full invocation URL from this suffix:
export const invocationUrlAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const endpoint = get(endpointAtomFamily(revisionId)) // "/test" or "/run"
        // builds: {serviceUrl}{routePath}{endpoint}
    })
)
```

The resolved `invocationUrl` is used directly in:
- `web/packages/agenta-playground/src/state/execution/executionRunner.ts` — no change needed there, it's a passthrough

**Migration target:** Replace the endpoint suffix with `{routePath}/invoke`. The `direct` vs `deployed` mode distinction moves to the revision `url` field (which already encodes which container to call), not the endpoint suffix.

---

### C2. Legacy evaluator runnable setup

**File:** `web/packages/agenta-entities/src/legacyEvaluator/state/runnableSetup.ts`

Same `endpointAtomFamily` pattern as C1. Same migration applies.

---

### C3. App-selector default parameter extraction

**File:** `web/oss/src/services/app-selector/api/index.ts`

```typescript
// line 201 — probes legacy endpoint names to find request body schemas:
const endpointNames = ["/test", "/run", "/generate", "/generate_deployed", "/"]
```

Walks the shared OpenAPI spec paths to extract default parameters for a variant.

**Migration target (short-term):** Add `"/invoke"` to the front of the probe list so the new system is tried first.

**Migration target (long-term):** Replace the path-probe heuristic with a direct inspect call — `POST {routePath}/inspect` returns `WorkflowServiceRequest` with schemas directly, no OpenAPI parsing needed.

---

## Steps

### S1. Switch C1 + C2 from `/test`/`/run` to `/invoke`

**Files:**
- `web/packages/agenta-entities/src/legacyAppRevision/state/runnableSetup.ts`
- `web/packages/agenta-entities/src/legacyEvaluator/state/runnableSetup.ts`

Current:
```typescript
export const endpointAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const mode = get(executionModeAtomFamily(revisionId))
        return mode === "deployed" ? "/run" : "/test"
    }),
)
```

Target:
```typescript
export const endpointAtomFamily = atomFamily((revisionId: string) =>
    atom((get) => {
        const schemaQuery = get(legacyAppRevisionSchemaQueryAtomFamily(revisionId))
        const routePath = schemaQuery.data?.routePath || ""
        return `${routePath}/invoke`
    }),
)
```

**Pre-condition:** Confirm that the revision `url` field already encodes the correct container URL for deployed mode. If not, that field needs to be populated before this step can land.

---

### S2. Add `/invoke` to app-selector endpoint probe list

**File:** `web/oss/src/services/app-selector/api/index.ts`

Short-term:
```typescript
const endpointNames = ["/invoke", "/test", "/run", "/generate", "/generate_deployed", "/"]
```

---

### S3. Long-term — replace path-probe with inspect call

**File:** `web/oss/src/services/app-selector/api/index.ts`

Replace the OpenAPI path-probe block with a single `POST {routePath}/inspect` call. The response `WorkflowServiceRequest` carries the revision/interface schemas directly — no OpenAPI parsing required.

This step can land independently of S2 and is not required to unblock G1 removal.

---

## File Index

| File | Role | Action |
|---|---|---|
| `web/packages/agenta-entities/src/legacyAppRevision/state/runnableSetup.ts` | Playground invocation URL | S1: switch to `/invoke` |
| `web/packages/agenta-entities/src/legacyEvaluator/state/runnableSetup.ts` | Evaluator invocation URL | S1: same pattern |
| `web/oss/src/services/app-selector/api/index.ts` | Schema default extraction | S2: add `/invoke`; S3: use inspect |
| `web/packages/agenta-playground/src/state/execution/executionRunner.ts` | Fetch executor | no change — passthrough of resolved URL |
