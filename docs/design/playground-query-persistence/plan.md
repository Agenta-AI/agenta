# Playground query persistence — IndexedDB-backed SWR for workflow entities & playground catalogs

Status: BUILT (increments ①–③, 2026-07-18) — pending live browser verification; increment ④ (measure + Class C exceptions) not started. See "Build notes" at the bottom.
Scope: agent-playground experience — workflow entities (artifact/variant/revision) +
playground-adjacent fetches (templates, catalogs, schemas, models, tools/trigger
catalogs). Explicitly NOT an app-wide cache subsystem.
Branch: `fe-refactor/data-optimizations`

## Problem

Two compounding issues on the agent-playground load path:

1. **Cold/warm reload re-fetches everything.** The critical TTI chain is
   `session/project → revision body → inspect → config sections paint`. Inspect and the
   static catalogs are already disk-seeded (localStorage), but the **revision body — the
   primary TTI blocker and the immutable-by-key one — is not persisted at all**. It also
   has the TanStack default 5-minute `gcTime`, so it evaporates mid-session: switching
   away from a revision for 5 idle minutes refetches its full body.
2. **The backend is capacity-limited.** Cold reload fires ~15–22 concurrent requests;
   a saturated backend (esp. local dev) queues 6–9s per request. Any persistence design
   that paints-from-disk but still revalidates everything makes the UI *look* fast while
   sending the same request burst. Revalidation policy is therefore as important as
   storage.

Additionally, the three existing hand-rolled localStorage layers
(`persistedInspect.ts`, `persistedCatalog.ts`, `persistedAgentType.ts` in
`web/packages/agenta-entities/src/workflow/state/`) are rationing a ~5MB origin quota
shared with SuperTokens auth state — `persistedInspect` carries LRU(15) eviction, a
1.2MB char budget, and quota-purge machinery that exists *only* because localStorage is
small and synchronous.

## Design center

**One decision, made per query: mutability class × storage tier × revalidation policy.**

Mechanism: TanStack Query's `experimental_createQueryPersister` (per-query persistence),
NOT `persistQueryClient` (whole-cache). Reasons:

- Whole-cache dehydration sweeps in every mutable pointer query by default; the
  `shouldDehydrateQuery` denylist would drift as queries are added.
- `PersistQueryClientProvider` gates render on an async restore; we're on jotai
  (`useHydrateAtoms` in `web/oss/src/state/Providers.tsx:21`) and gating the app on an
  IndexedDB read is the opposite of the TTI goal.
- Per-query lets us opt in exactly the revision-detail query first and measure.

Storage: IndexedDB via `idb-keyval`, one shared module in
`web/packages/agenta-shared/src/api/persist/` exporting persister instances per policy
class. The QueryClient itself (`web/packages/agenta-shared/src/api/queryClient.ts:7`)
stays bare; queries opt in via `persister` in their query options.

## Mutability classes and policy

### Class A — immutable-by-key: persist, NEVER revalidate

The only class where persistence *reduces* backend load rather than deferring it.

| Query | Where | Today | Win |
|---|---|---|---|
| `["workflows","revision", revId, projectId]` — full revision body | `agenta-entities/src/workflow/state/store.ts:1118` (`workflowQueryAtomFamily`) | 30s staleTime, default 5m gcTime, no persistence | **The jackpot.** Primary TTI blocker on warm reload; also GC-refetch mid-session |
| `["revision", projectId, revId]` — testset revision | `agenta-entities/src/testset/state/store.ts:245` | staleTime/gcTime Infinity (memory only) | Cross-reload; low priority |
| `["revision-with-testcases", …]` | `testset/state/revisionMolecule.ts:166` | opt-in enabled | Same, when playground test data loaded |
| `["trace-entity"]` / `["trace-summary"]` | `trace/state/store.ts:693/761` | staleTime Infinity, 5m gcTime | OUT of first scope — noted for later |

Policy: `staleTime: Infinity`, `maxAge: Infinity`, restore from IDB, zero revalidation.

Caveat: immutable server-side ≠ immutable client-shape. The Zod `workflowSchema`
(`workflow/core/schema.ts:271-336`) evolves; every persisted entry is keyed with a
**schema-version buster** (the `VERSION = "1"` idiom from `persistedInspect.ts`). Bump
on any schema change → old entries are dead weight, GC'd by maxAge sweep, refetched.

Also raise the in-memory `gcTime` for the revision-detail query (e.g. 1h): the persister
covers cross-GC restore, but restore is async — a longer gcTime avoids even the brief
pending flash when switching back to a recently viewed revision.

### Class B — catalogs & schemas (change on backend deploy): persist, paint-from-disk, ONE low-priority revalidate

Arda's established rule from the disk-SWR round applies to this whole class:
**`initialDataUpdatedAt: 0` (paint from disk + one background revalidate), NOT
`staleTime: Infinity`** — schemas still evolve during active development.

| Query | Where | Today | Treatment |
|---|---|---|---|
| Inspect body | `workflow/state/store.ts:1200` + `persistedInspect.ts` | localStorage LRU(15), 1.2MB budget | **Migrate to IDB**; raise entry count; delete LRU/quota code |
| Harness catalog (embeds full model catalog + pricing — the "models" source) | `workflow/state/inspectMeta.ts:98` + `persistedCatalog` | localStorage seed | Migrate to IDB (large blob) |
| ag-type schemas | `workflow/state/store.ts:1403` + `persistedCatalog` | localStorage seed | Same |
| Tool catalog: categories / integrations / actions / details | `gatewayTool/hooks/useToolCatalog*.ts` (incl. two `atomWithInfiniteQuery`) | 5–30m staleTime, memory only | Persist → drawer opens instantly across reloads; revalidate on drawer-open only |
| Trigger catalog: integrations / events | `gatewayTrigger/hooks/useTriggerCatalog*.ts` | 5m, memory only | Same |
| Evaluator templates | `workflow/state/evaluatorTemplateAtoms.ts:23` | 5m, memory only; fires near cold load via config panel | Persist + idle-defer revalidation |
| App / application templates | `workflow/state/appUtils.ts:38`, `oss/src/state/app/atoms/templates.ts:14` | 5m | Persist (home/onboarding benefit) |
| Service schema (legacy custom apps) | `shared/openapi/serviceSchemaAtoms.ts:29` | 30m/1h, already well-tuned | Persist, lowest priority |

Revalidation discipline (the anti-choke core):

1. **Seeded ⇒ `priority:"low"`.** Plumbing exists: `lowPriorityWhenCached` in
   `agenta-shared/src/api/axios.ts:44` + low-priority client variants in
   `agenta-sdk/src/resources.ts`. Already applied to inspect/catalog revalidations.
2. **Revalidate once per session, not per mount.** After the single background refetch,
   normal `staleTime` suppresses repeats.
3. **Idle-defer revalidations** of anything not visible — fold into the existing
   `idleReadyAtom` pattern (`oss/src/state/boot/idleReady.ts`, commit add38e89) so
   warm-reload revalidations don't join the cold-load network burst.

### Class C — user-mutable pointers & lists: mostly DON'T persist

`["workflows","latestRevision"]` (store.ts:877 — the stale-"latest" hazard: renders a
stale head after a teammate commits), `revisionsByWorkflow`/`revisions` lists (already
thin `{id, version, created_at}` refs), workflow `detail`/`artifact`, vault secrets
(`secret/state/atoms.ts:96`), tool/trigger connections, environments
(`environment/state/store.ts:202`), testset lists, session mounts.

Payloads are thin — persistence buys milliseconds and risks staleness bugs. Keep
these on the existing low-priority/deferred treatment.

Two paint-fast **exceptions to evaluate later** (persist + ALWAYS revalidate):

- Vault secrets — kills the model-key-badge flicker in
  `AgentChatPanel → useAgentModelKeyStatus.ts:59` / ConnectModelBanner.
- Environments list — deploy-drawer paint.

Deferred to increment ④; measure first.

### Class D — frequently changing: NEVER persist

Session records (`session/state/records.ts:21`), trigger deliveries
(`useTriggerDeliveries.ts:22`), mount file listings/contents (`session/state/mounts.ts`).
The session *tab list* is already `atomWithStorage`
(`AgentChatSlice/state/sessions.ts:76`) — untouched.

## Storage-tier rule

Not everything migrates to IDB. The distinction that must survive:

- **Sync-critical tiny signals stay in localStorage.** `persistedAgentType` (header
  flavor, `PlaygroundLoadingShell.tsx:25`; splitter geometry latch,
  `MainLayout.tsx:212-242`) and the persisted last-selection
  (`state/url/playground.ts:148-179`) gate **first-frame render decisions**. IndexedDB
  is async and cannot serve a synchronous first-frame read. DO NOT migrate these.
- **Heavy bodies move to IndexedDB.** Inspect, harness catalog, revision bodies, tool
  catalogs. Bonus: `persistedInspect` today does synchronous `JSON.parse` of ~100KB+
  payloads during render; IDB restore is async, off the critical frame.
- Net: localStorage shrinks to a few KB of signals (quota pressure vs SuperTokens gone);
  the LRU/eviction/quota-purge code in `persistedInspect.ts` is **deleted**, not
  replicated.

## Module sketch

```
web/packages/agenta-shared/src/api/persist/
  idbStorage.ts       // idb-keyval store "agenta-query-cache", AsyncStorage adapter
  persisters.ts       // immutablePersister (Class A: maxAge Infinity + version buster)
                      // catalogPersister   (Class B: bounded maxAge, e.g. 14d)
  version.ts          // PERSIST_SCHEMA_VERSION — bump invalidates Class A entries
  gc.ts               // idle-time sweep: drop entries past maxAge / wrong version
```

Queries opt in via `persister: xPersister.persisterFn` in their query options
(supported by `atomWithQuery`). Keys in IDB are the serialized queryKey + version
prefix; cross-tab sharing comes free (IDB is origin-scoped; persister writes are
throttled).

## Expected benefits

1. **Warm-reload TTI**: the entire render chain `revision → inspect → sections` serves
   from disk; only `profile/projects` + pointer revalidations touch the network before
   paint. Today the config panel and chat host block on the revision fetch
   (`AgentChatSkeleton` gate, `MainLayout.tsx:519-521`).
2. **Subsumes the parked TTI plan** (`project_agent_playground_tti_plan`): the persisted
   revision body contains `uri`/`url`/`flags`, so phases 2–3 (persistedRevisionMeta +
   early inspect prefetch) collapse into "restore revision from IDB, derive the inspect
   key from it". Phase 1 (snapshot hint) remains independently useful.
3. **Warm-reload request count drops** (not just reorders — distinct from the
   priority-demotion pass): Class A revalidations eliminated; Class B collapsed to one
   low-priority idle refetch each. On the capacity-limited backend this is the lever
   that matters.
4. **Mid-session refetch elimination**: revision bodies survive the 5-minute GC;
   revision-switching stops refetching bodies.
5. **Drawer UX**: tool/trigger catalogs + evaluator templates open instantly on every
   visit after the first.

## Risks / open questions (settle empirically in increment ①)

1. **The `initialData` race.** `store.ts:877` and `store.ts:1118` use
   `initialData: detailCached` + `enabled: !detailCached`, reading the query cache
   synchronously at atom evaluation. The per-query persister restores *asynchronously*
   on observer mount. Does restore land before the enabled-gate/initialData evaluate,
   or race them? If it races, keep a small synchronous latch (or reorder: persister
   restore first, `initialData` as fallback). This is THE question increment ① answers.
2. **Commit-time cache priming.** `primeWorkflowRevisionDetailCache`
   (`store.ts:124`, called from `workflow/state/commit.ts:310/485`) writes via
   `setQueryData`. Confirm the persister observes cache writes that don't originate
   from its own queryFn — a just-committed revision must be persisted too, or the first
   reload after a commit misses the newest revision.
3. **Infinite queries.** Persister support for `atomWithInfiniteQuery` pages
   (tool/trigger catalogs) is the least-proven corner of the experimental API. Verify;
   fall back to persisting first-page-only if pages misbehave.
4. **Multi-workspace / auth.** Keys include `projectId` already (good). Decide whether
   logout should clear the IDB store (probably yes — hook the same place SuperTokens
   clears its state).
5. **Eviction.** No LRU needed at IDB scale, but do an idle-time sweep (maxAge +
   version mismatch) so the store doesn't grow unboundedly across months.

## Build order

Each increment is a standalone win; stop-and-measure between them.

1. **① Infra + revision body.** `persist/` module; wire
   `["workflows","revision", revId, projectId]` through `immutablePersister` with
   schema-version buster; raise its `gcTime`; settle risks 1–2 empirically on the
   highest-value target. Verify: warm reload paints config panel without a revision
   network request; commit → reload shows the new revision.
2. **② Migrate inspect + catalogs off localStorage.** `persistedInspect` +
   `persistedCatalog` → `catalogPersister` (IDB), preserving the
   `initialDataUpdatedAt: 0` + low-priority-revalidate semantics. Delete the LRU/quota
   machinery. `persistedAgentType` and last-selection are NOT migrated (sync-critical).
3. **③ Drawer catalogs.** Tool/trigger catalog queries + evaluator/app templates via
   `catalogPersister`; revalidate on drawer-open; idle-defer the rest.
4. **④ Measure, then decide Class C exceptions** (vault secrets, environments list) —
   only if the badge/drawer flicker still registers after ①–③.

## Build notes (2026-07-18, increments ①–③)

Answers to the open risks, settled empirically during the build:

1. **initialData race — none exists.** The persister runs only inside a fetch the
   `enabled`/`initialData` gates already allowed, and restores only when
   `query.state.data === undefined`. `detailCached` present ⇒ persister never runs;
   absent ⇒ restore happens before any network. (query-persist-client-core source.)
2. **Commit priming — handled at one choke point.** All commit/list primes route
   through `primeWorkflowRevisionDetailCache`, which now fire-and-forgets
   `immutablePersister.persistQueryByKey` for full bodies only (`workflow.data`
   truthy). Note `persistQueryByKey` resolves before the IDB write completes — never
   assume durability before navigation/unload.
3. **Infinite queries — wired, sound.** `infiniteQueryBehavior` hands the persister the
   whole `{pages, pageParams}`; `fetchNextPage` re-persists post-update state. Restored
   stale infinite queries refetch all restored pages (standard TanStack semantics).
4. **Class B revalidation needs an observer.** `fetchQuery` alone restores but never
   background-refetches (`isStale()` is false without observers). `atomWithQuery`
   mounts observers, so all wired queries get paint-then-revalidate; imperative
   prefetch paths get restore-only. (Verified by unit test.)
5. **Version discipline.** `@tanstack/query-persist-client-core` pinned `5.100.9` +
   `pnpm-workspace.yaml` override `@tanstack/query-core: 5.100.9` — the workspace must
   keep exactly one query-core or `Query`/`QueryClient` types split nominally.
6. **Typing.** query-core's `persister` option uses `NoInfer<TQueryKey>`: plain sites
   need `persisterFn<Resp, QueryKey>`, infinite sites need an
   `as QueryPersister<PageResp, QueryKey, unknown>` cast (types-only mismatch).

Behavior deltas accepted: inspect disk entries are per-revision (queryHash), no longer
per-service — a new revision's first inspect won't paint from a sibling's entry.
Revalidate-on-restore fires only when restored data is stale (vs the old
`initialDataUpdatedAt: 0` always-once).

Landed outside the original sketch: logout `clearPersistedQueryCache()` in
`oss/src/hooks/useSession.ts`; GC sweep in `_app` `PreloadQueries`. Unit coverage:
`agenta-shared/tests/unit/persist.test.ts` (11 behavioral tests over fake-indexeddb).

**Diagnostics:** `localStorage.setItem("agenta:persist:debug", "1")` + reload enables
console logging at the storage boundary (`persist/debug.ts`): `HIT` (restore, with
size and age), `MISS`, `WRITE`, `SKIP` (nullish data), `EVICT` (expired/buster/nullish),
`CLEAR`, and a GC summary with swept counts. No-op (single flag check) when disabled.
**Kill switch:** `localStorage.setItem("agenta:persist:disable", "1")` + reload makes
reads miss and writes no-op (entries survive) — for A/B-ing whether a symptom is
persistence-related.

**Nullish-data guard (found in first live run):** a revision queryFn that resolves
`null` (transient API miss / failed validation) must never persist — an
immutable-restored `null` suppresses refetch forever. The storage adapter skips
nullish writes and treats pre-existing nullish entries as miss + evict on read.

Still open: live browser verification (warm-reload paint without revision request;
commit → reload shows new revision; drawer catalogs instant on reopen), then
increment ④.

## Out of scope

- Whole-cache `persistQueryClient` / render-gating restore.
- Persisting Class C pointers (`latestRevision`, lists) or Class D live data
  (session records, deliveries, mount files).
- Trace store persistence (immutable trace-entity/summary noted, separate effort).
- Non-playground surfaces (observability tables, evaluations) — same infra would apply
  later, but not this pass.
- The backend 8s/request latency itself (server-side capacity, not FE-fixable).
