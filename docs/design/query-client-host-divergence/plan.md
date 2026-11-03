# The package layer's QueryClient singleton breaks on any host that brings its own

Status: root cause found, acute bug fixed (`web/mobile/src/lib/queryClient.ts`), and the systemic
hardening done: **WP1 and WP2 are complete**, WP3 is the live sweep tracked below, WP4 is
deliberately out of scope (its own PR).

## The symptom, as reported

On `/m` (mobile), in Settings → Triggers:

- Create a subscription → success toast → **the table does not change**. Hit the section's
  refresh button and the row appears instantly.
- Delete a subscription → same.
- Create a schedule from the agent config panel → same.
- Connect Gmail → come back → the drawer is still stuck on "connect", correct after a reload.

Not reproducible on `release/v0.112.0` or on desktop OSS/EE.

## Root cause

`/m` installed **its own `QueryClient`**:

```ts
// web/mobile/src/lib/queryClient.ts (before)
export const queryClient = new QueryClient({defaultOptions: {queries: {retry: 1, ...}}})
```

`AppProviders` passed that client to `QueryClientProvider` **and** hydrated `queryClientAtom`
with it. So on mobile every `atomWithQuery` observer, the React context, and the jotai atom all
pointed at *mobile's* client — consistently, which is why reads, rendering and manual `refetch()`
all worked perfectly.

Meanwhile the package layer reaches the cache through a **module singleton**:

```ts
// packages/agenta-entities/src/gatewayTrigger/hooks/useTriggerSubscription.ts
import {queryClient} from "@agenta/shared/api"
const invalidateSubscriptions = () =>
    queryClient.invalidateQueries({queryKey: ["triggers", "subscriptions"]})
```

That singleton was **never used by anything on `/m`**. Its cache was literally empty. Every
invalidation, every optimistic `setQueryData`, every `removeQueries` from package code went to an
orphan client and did nothing — silently, with no error and a successful-looking toast.

Desktop OSS/EE pass the `@agenta/shared/api` singleton into their provider, so the two coincide
there and nobody ever saw it.

### Why it presented as a regression

`web/mobile/src/lib/queryClient.ts` predates the sessions-UX stack. What the stack added was the
first `/m` surfaces that *perform package-layer mutations* — the `mobile/settings` lane, Tools and
Triggers on `/m`, and making them writable. The latent breakage had nothing to invoke it before.

## The fix that is already in

`web/mobile/src/lib/queryClient.ts` now re-exports the shared singleton and merges mobile's
defaults onto it rather than replacing them (`setDefaultOptions` is a whole-object write, so
spreading the existing `queries` preserves `experimental_prefetchInRender` set by the package
layer). `AppProviders` needed no change. Verified live on `/m`: subscription create and delete both
settle without a reload. (Tool *connect* is only partly covered — see the WP3 table.)

## Why this must not be left there

The fix removes the symptom but not the hazard. The package layer asserting *"the host's client is
the one I imported"* is an invariant nothing enforces and nothing checks. The next host — a new
app, a Storybook decorator, an embedded surface, a test harness — reintroduces the whole class,
and the failure mode is the worst kind: **writes appear to succeed and silently do nothing.**

The app layer already does this correctly. OSS reads the client off the atom (`store.get(queryClientAtom)`,
~17 sites), as do several `@agenta/entities` molecules (`resultMolecule`, `metricMolecule`,
`trace/state/prefetch`, `testcase/state/prefetch`, `createInfiniteTableStore`). Both hosts mount
jotai's **default store** (`<Provider store={getDefaultStore()}>` in OSS `Providers.tsx` and mobile
`AppProviders.tsx`), so `getDefaultStore().get(queryClientAtom)` resolves to whatever the host
actually installed. That is the pattern to converge on.

## Affected surface

16 files import the singleton and make ~70 cache calls on it. **All of them were dead on `/m`**,
not just triggers — `invalidateQueries` is the loud one, but `setQueryData` is worse, because
optimistic updates vanish with no feedback at all.

> **The table below is one short.** It was built by grepping *static* imports, which misses
> `const {queryClient} = await import("@agenta/shared/api")` — there is one such site, in
> `agenta-playground/src/state/controllers/playgroundController.ts:1703`. It is converted, and the
> matching lint gap (`no-restricted-imports` does not flag dynamic `import()`) is now closed by a
> `no-restricted-syntax` rule — see WP2 below.

| file | invalidate | setQueryData | getQueryData | removeQueries | fetchQuery |
|---|---|---|---|---|---|
| `agenta-annotation/src/state/controllers/annotationFormController.ts` | 3 | 0 | 0 | 0 | 0 |
| `agenta-annotation/src/state/controllers/annotationSessionController.ts` | 4 | 3 | 0 | 0 | 0 |
| `agenta-entities/src/gatewayTool/hooks/useToolConnectionActions.ts` | 3 | 0 | 0 | 0 | 0 |
| `agenta-entities/src/gatewayTrigger/hooks/useTriggerConnectionActions.ts` | 3 | 0 | 0 | 0 | 0 |
| `agenta-entities/src/gatewayTrigger/hooks/useTriggerSchedule.ts` | 1 | 1 | 0 | 0 | 0 |
| `agenta-entities/src/gatewayTrigger/hooks/useTriggerSubscription.ts` | 1 | 0 | 0 | 0 | 0 |
| `agenta-entities/src/gatewayTrigger/state/optimistic.ts` | 0 | 8 | 4 | 0 | 0 |
| `agenta-entities/src/runnable/deploy.ts` | 10 | 0 | 0 | 0 | 0 |
| `agenta-entities/src/shared/invalidation/index.ts` | 1 | 0 | 0 | 1 | 0 |
| `agenta-entities/src/webhook/atoms.ts` | 7 | 2 | 1 | 0 | 0 |
| `agenta-entity-ui/src/gatewayTool/drawers/ConnectDrawer.tsx` | 2 | 0 | 0 | 0 | 0 |
| `agenta-entity-ui/src/gatewayTool/drawers/ConnectionManagerDrawer.tsx` | 0 | 1 | 0 | 0 | 0 |
| `agenta-entity-ui/src/gatewayTool/hooks/useReconnectToolConnection.ts` | 3 | 0 | 0 | 0 | 0 |
| `agenta-entity-ui/src/gatewayTrigger/drawers/TriggerConnectDrawer.tsx` | 3 | 0 | 0 | 0 | 0 |
| `agenta-playground/src/state/controllers/traceRefResolution.ts` | 0 | 0 | 0 | 2 | 2 |
| `agenta-settings-ui/src/tools/hooks/useToolsConnections.ts` | 4 | 0 | 0 | 0 | 0 |

User-visible areas these back: gateway **tools** (connect / reconnect / connection manager),
gateway **triggers** (connections, subscriptions, schedules, the optimistic play/pause), **webhooks**,
**deployments** (`runnable/deploy.ts`, 10 invalidations), **annotations**, playground **trace-ref
resolution**, and the cross-cutting `invalidateEntityQueries` used by entity CRUD.

## Work plan

Independent work packages; WP1 is the substance, WP2 is what stops it recurring.

### WP1 — package code reads the client from the atom — **DONE**

Add one accessor to `@agenta/shared/api` and route every package-layer call through it:

```ts
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

/** The client the host actually installed. Never import the singleton in package code. */
export const getHostQueryClient = () => getDefaultStore().get(queryClientAtom)
```

Then, per file in the table: `queryClient.invalidateQueries(...)` → `getHostQueryClient().invalidateQueries(...)`.

Notes for whoever does it:

- **Resolve per call, never at module scope.** `const qc = getHostQueryClient()` at the top of a
  module captures whatever is there at import time (possibly before hydration) and reintroduces the
  bug in a subtler form.
- **`getDefaultStore()` is correct for both hosts today** (both mount it explicitly), but code
  inside a nested jotai `Provider` with its own store — `InfiniteVirtualTableStoreProvider` creates
  one via `createStore()` — must read through `useAtomValue(queryClientAtom)`/`get(queryClientAtom)`
  in atom scope instead, so it picks up the nearest store.
- Do `agenta-entities/src/gatewayTrigger/state/optimistic.ts` first. It is the largest single
  cluster (12 calls, all `setQueryData`/`getQueryData`) and the most dangerous, since a lost
  optimistic write is invisible.
- `shared/invalidation/index.ts` (`invalidateEntityQueries`) is cross-cutting — fixing it repairs
  every CRUD caller at once.

### WP2 — make the invariant enforceable — **DONE**

1. **Lint rules** in `web/packages/eslint.config.mjs`, inherited by every package:
   - `no-restricted-imports` bans the named `queryClient` import from `@agenta/shared/api` **and**
     from the `@agenta/shared` root barrel, which re-exports it. Exported as
     `restrictedImportPaths`; the 11 package configs that override the rule spread it back in.
   - `no-restricted-syntax` (exported as `restrictedSyntax`) bans **dynamic** `import()` of those
     two modules outright. `no-restricted-imports` does not see `await import(...)`, so without
     this the one dynamic call site was unguarded. A selector matching only the destructured
     `queryClient` would still miss `const m = await import(...); m.queryClient`, so the whole
     module is off-limits dynamically and package code lazily imports the narrow
     `@agenta/shared/api/hostQueryClient` subpath instead (added to the package's `exports`).
   Both were probed with a deliberate violation, before (passed) and after (errors).
2. **Dev-time assertion** in `@agenta/shared/api/queryClient.ts`: on first package-layer cache
   access, error if the singleton is not the client in `queryClientAtom`. Deferred and re-checked
   once at 1s to avoid firing before hydration; once-only; off in prod and SSR. 5 unit tests in
   `agenta-shared/tests/unit/hostQueryClientAssertion.test.ts`.
3. **Host contract documented** in `web/AGENTS.md` § "The QueryClient host contract" and in the
   `agenta-package-practices` skill.

### WP3 — sweep `/m` for other silent staleness — **DONE (see coverage below)**

Everything in the table was dead on mobile until the fix, so anything already shipped on `/m` that
depends on those paths needed a look, not just triggers.

Driven live on `/m` against `mobile-test-project`, EE dev stack. Method: before each mutation,
stamp `window.__qcMark` from the console; after it settles, assert the row set changed **and** the
stamp survived. A surviving stamp is positive proof the page never reloaded, which a screenshot
cannot give you. The section "Reload all …" button was never pressed during a check.

| flow | backing file | result |
|---|---|---|
| Subscription create | `gatewayTrigger/hooks/useTriggerSubscription.ts` | PASS — row appears, stamp survives |
| Subscription delete | `gatewayTrigger/hooks/useTriggerSubscription.ts` | PASS — row vanishes, stamp survives |
| Schedule create | `gatewayTrigger/hooks/useTriggerSchedule.ts` | PASS — row appears, stamp survives |
| Subscription pause/resume | `gatewayTrigger/state/optimistic.ts` | PASS — flips instantly, **and does not revert** after the server settles; both directions |
| Webhook create | `webhook/atoms.ts` | PASS |
| Webhook delete | `webhook/atoms.ts` | PASS — table returns to empty state |
| Project create / delete | `shared/invalidation/index.ts` | PASS — 52→53→52 |
| Member invite / remove | `shared/invalidation/index.ts` | PASS — pending row appears, then clears |
| Tool reconnect | `gatewayTool/hooks/useToolConnectionActions.ts`, `useReconnectToolConnection.ts` | PARTIAL — the status change (`Connected`→`Pending`) propagated with no reload, but the OAuth leg was not completed |

The optimistic toggle is the load-bearing one: before the fix a lost `setQueryData` was invisible,
so "flips and stays flipped after the refetch" is the check that actually distinguishes a live
cache write from a dead one.

Not verified on `/m`, and why:

- **Tool connect / reconnect (full OAuth).** Both open a Composio → Google consent screen for
  full-mailbox scopes. Completing it needs a real Google account, so only the pre-consent half ran.
- **Deployments (`runnable/deploy.ts`, 10 invalidations).** `/m` has **no deploy surface** — nothing
  under `mobile/src` reaches it. Converted and type-checked, but not exercisable on mobile at all;
  it can only regress on desktop OSS/EE, where the singleton and the host client coincide anyway.

### WP5 — `ConnectDrawer` never invalidates the trigger connections

Found by review on #5915, **pre-existing and unchanged by this work** — the same two keys are on the
base. `gatewayTool/drawers/ConnectDrawer.tsx`'s local `invalidateConnections` invalidates
`["tools", "connections"]` and `["tools", "catalog"]` but not `["triggers", "connections"]`, so
connecting a tool can leave the Triggers connections list stale. Either add the third key or reuse
`useToolConnectionActions`'s helper, which already covers all three.

Deliberately not fixed in #5915: that lane is a pure "which client is addressed" change, and adding
an invalidation is a behaviour change — same reasoning that keeps WP4 out.

### WP4 — decide on `refetchOnWindowFocus: false`

Orthogonal to the client bug but it removed the safety net that would have masked it, and it is a
real UX gap on its own: the gateway queries (`connections`, `subscriptions`, `schedules`, `catalog`)
all set `staleTime: 30_000` + `refetchOnWindowFocus: false`, so they refresh **only** via explicit
invalidation. That is why the Gmail OAuth return showed a stale drawer. Consider enabling focus
refetch for these, or invalidating explicitly on OAuth return.

## How to verify a host is wired correctly

The technique that found this, kept because it generalises. Tag the singleton, then compare it
against the client the observers use, from inside package code:

```ts
// packages/agenta-shared/src/api/queryClient.ts
;(queryClient as any).__id = `shared-${Math.random().toString(36).slice(2, 8)}`

// any package hook
console.log("atom:", (useAtomValue(queryClientAtom) as any).__id,   // observers
            "provider:", (useQueryClient() as any).__id,           // React context
            "singleton:", (queryClient as any).__id)               // what package code writes to
console.log("keys:", queryClient.getQueryCache().getAll().map(q => q.queryKey))
```

All three ids equal → wired correctly. An `undefined` id on `atom`/`provider` is the conclusive
tell: the host installed a rival client and every package-layer write is a no-op.

An **empty `getAll()`** on the singleton is only supporting evidence — a correctly wired client also
has an empty cache before any query mounts. Read it after a query you know is live has rendered, and
confirm the ids disagree before concluding anything.

## Dead ends, recorded so nobody repeats them

- **Not module duplication.** `jotai`, `jotai-tanstack-query` and `@tanstack/react-query` each
  resolve to exactly one instance across `oss`, `ee`, `mobile` and every package (verified through
  the `node_modules` symlinks). The extra copies in the pnpm store are orphans nothing imports.
- **Not `experimental_prefetchInRender`.** Disabling the global default changed nothing.
- **Not `enabled: get(idleReadyAtom)` / `refetchType: 'active'`.** Plausible from the symptom
  (`refetch()` works, `invalidateQueries` doesn't) but wrong — the query was in a different cache
  entirely, so activeness never came into it.
- **Not a `references`/scoping bug** in the agent-config Triggers panel. Worth knowing anyway:
  `referencesMatch` only matches on `ref.id`, while an environment-bound trigger writes
  slug-only references (`{environment: {slug}, application: {slug}}`) — so an environment-bound
  trigger genuinely cannot appear in that panel. Separate latent bug, not the one reported.
