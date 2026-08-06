# SDK → Entities Migration Plan

## Goal

Replace all direct `axios` API calls in `@agenta/entities` (and OSS/EE app code) with `agenta-sdk` methods. The SDK becomes the single source of truth for all Agenta API interactions.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  App (_app.tsx)                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  SDK instance (configured once)                 │ │
│  │  - authProvider: () => getJWT() → Bearer token  │ │
│  │  - projectIdProvider: () => store.get(projectId) │ │
│  │  - onResponse: handle 401 → signOut             │ │
│  └─────────────────────────────────────────────────┘ │
│         ↓ provided via jotai atom                    │
│  ┌─────────────────────────────────────────────────┐ │
│  │  @agenta/entities                               │ │
│  │  atomWithQuery(() => sdk.workflows.list())      │ │
│  │  atom(null, (get, set, data) =>                 │ │
│  │    sdk.workflows.commit(data))                  │ │
│  └─────────────────────────────────────────────────┘ │
│         ↓                                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │  Components                                      │ │
│  │  useAtomValue(workflowsListAtom)                │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## SDK Auth Modes

The SDK client supports two auth modes:

### 1. Static API Key (server-side / scripts / my-agent)

```typescript
const ag = new Agenta({
  host: "https://cloud.agenta.ai",
  apiKey: "ak-...",
  projectId: "proj-...",
});
```

### 2. Dynamic Auth Provider (browser / web app)

```typescript
const ag = new Agenta({
  host: getAgentaApiUrl(),
  authProvider: async () => {
    const jwt = await getJWT();
    return jwt ? `Bearer ${jwt}` : undefined;
  },
  projectIdProvider: () => store.get(projectIdAtom) ?? undefined,
  onResponse: async (res) => {
    if (res.status === 401) await signOut();
  },
});
```

## Migration Steps

### Phase 1: SDK instance in the app (no behavior change)

1. Create a shared `agentaSdkAtom` in `@agenta/shared/state` that holds the `Agenta` instance
2. Initialize it in `_app.tsx` with `authProvider` + `projectIdProvider` + `onResponse`
3. No existing code changes — axios calls continue working

### Phase 2: Migrate entities API calls (domain by domain)

For each domain in `@agenta/entities/src/*/api/`:

1. **Add SDK method** if missing (e.g. `sdk.environments.guard()`)
2. **Replace axios call** in the entity's API module:

   ```typescript
   // Before
   const response = await axios.post(
     `${getAgentaApiUrl()}/preview/simple/environments/`,
     body, { params: { project_id: projectId } }
   );
   return response.data;

   // After
   return await sdk.environments.create(body);
   ```

3. **Remove `project_id` injection** — SDK handles it automatically
4. **Remove auth header logic** — SDK handles it automatically
5. **Test** — verify the atom still works, query keys unchanged

#### Domain migration order (by dependency, simplest first):

| Order | Domain | Files | Estimated Calls |
|-------|--------|-------|-----------------|
| 1 | `environment` | `api/api.ts`, `api/mutations.ts` | ~12 |
| 2 | `testset` | `state/mutations.ts` | ~5 |
| 3 | `annotation` | `api/api.ts` | ~3 |
| 4 | `evaluationRun` | `api/api.ts` | ~4 |
| 5 | `evaluationQueue` | `api/api.ts` | ~8 |
| 6 | `workflow` | `state/store.ts` | ~15 |
| 7 | `trace` | `state/store.ts` | ~5 |
| 8 | `loadable` / `runnable` | various | ~5 |

### Phase 3: Remove axios dependency

1. Remove `axios` from `@agenta/shared` dependencies
2. Remove `configureAxios`, `createAxiosInstance` from `@agenta/shared/api`
3. Remove `axiosConfig.ts` from OSS app
4. Update `@agenta/entities` to remove `axios` peer dependency

### Phase 4: Migrate OSS/EE app-level API calls

Remaining axios calls in `web/oss/src/lib/` and `web/oss/src/services/` that aren't in entities.

## Key Decisions

- **SDK instance as jotai atom**: The `Agenta` instance is created once and stored in a jotai atom. Entity atoms read it via `get(agentaSdkAtom)`.
- **No SDK dependency on jotai**: The SDK is a plain TypeScript class. The jotai integration lives in `@agenta/shared` or `@agenta/entities`.
- **Backward compat during migration**: Both axios and SDK calls can coexist. Migrate one domain at a time.
- **Response transforms**: The current axios response interceptor converts UTC dates (`created_at + "Z"`). This should move to the SDK's response handling or be dropped if the API is fixed.
