# Handoff: route package-layer cache access through the host's QueryClient

You are picking up work that is already diagnosed. **Read
[`plan.md`](./plan.md) in this folder first, in full** — it has the root cause, the evidence, the
affected-file table and the dead ends. This file is the how-to; that file is the why. Do not
re-derive the diagnosis, it cost several hours and the plan records what was already ruled out.

## One-paragraph context

`@agenta/*` package code reaches the TanStack Query cache through a module singleton
(`import {queryClient} from "@agenta/shared/api"`). Desktop OSS/EE pass that exact object to
`QueryClientProvider`, so it works there. `web/mobile` created **its own** `QueryClient`, so on
`/m` every package-layer `invalidateQueries` / `setQueryData` / `removeQueries` wrote to an orphan
client with an empty cache — mutations returned success, toasts fired, and nothing refreshed until
a reload. The acute bug is already fixed (`web/mobile/src/lib/queryClient.ts` now re-exports the
shared singleton). **Your job is to remove the hazard**, so the next host that brings its own
client cannot silently break every package mutation again.

## Where to work

Worktree `.claude/worktrees/sessions-ux`, currently on branch `docs/sessions-ux-stack` (top of a
30-PR stack, PRs #5865–#5894). Before touching anything:

```bash
cd .claude/worktrees/sessions-ux
git status --porcelain          # expect: M web/mobile/src/lib/queryClient.ts, ?? docs/design/query-client-host-divergence/
git log --oneline -1
```

That modified mobile file is the already-verified fix — **do not revert it**, and do not fold your
work into it. Ask where the mobile fix should land before committing it.

**Correction (2026-08-10):** an earlier version of this file said to branch off
`release/v0.112.0`. That is wrong and will not build. Eight of the packages this work touches
(`agenta-settings-ui`, `agenta-settings`, `agenta-home-ui`, `agenta-navigation`,
`agenta-navigation-ui`, `agenta-observability`, `agenta-auth`, `agenta-auth-ui`) are **created by
the sessions-UX stack** and do not exist on 112 — including one converted source file,
`agenta-settings-ui/src/tools/hooks/useToolsConnections.ts`. This work must stack **on top of**
`docs/sessions-ux-stack` (the stack tip), not below it.

Note the repo may be in GitButler workspace mode — check `but status`. If so, follow the branching
rules in the root `AGENTS.md`; if `but` is unavailable, plain git is fine.

## WP1 — the substance

### Step 1: add the accessor

In `packages/agenta-shared/src/api/` (new file `hostQueryClient.ts`, exported from
`src/api/index.ts`):

```ts
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"

/**
 * The QueryClient the HOST actually installed, read from the atom the observers use.
 *
 * Package code must never import the `queryClient` singleton directly: a host that provides its
 * own client (as `/m` did) gets working reads and silently dead writes. Resolve per call — never
 * cache the result at module scope, or you capture whatever was there before hydration.
 */
export const getHostQueryClient = () => getDefaultStore().get(queryClientAtom)
```

`@agenta/shared` already declares `jotai` and `jotai-tanstack-query` as peer deps and already
imports jotai in `src/state/`, so no package.json change is needed.

### Step 2: convert the 16 files

The table in `plan.md` lists every file with its per-method call counts. For each:

```ts
- import {queryClient} from "@agenta/shared/api"
+ import {getHostQueryClient} from "@agenta/shared/api"

- queryClient.invalidateQueries({queryKey: [...]})
+ getHostQueryClient().invalidateQueries({queryKey: [...]})
```

**Order — do these first, they are the highest risk:**

1. `agenta-entities/src/gatewayTrigger/state/optimistic.ts` — 12 calls, all `setQueryData` /
   `getQueryData`. A lost optimistic write produces no error at all, so this is the least visible
   and most damaging.
2. `agenta-entities/src/shared/invalidation/index.ts` — `invalidateEntityQueries` is cross-cutting;
   fixing it repairs every entity-CRUD caller at once.
3. `agenta-entities/src/runnable/deploy.ts` — 10 invalidations behind deployments.
4. Everything else in any order.

**Three rules that matter:**

- **Resolve per call.** `const qc = getHostQueryClient()` at module scope reintroduces the bug in a
  subtler form. Inside a function body is fine.
- **Nested jotai stores need atom scope.** `getDefaultStore()` is right for both current hosts
  (OSS `Providers.tsx` and mobile `AppProviders.tsx` both mount it explicitly), but code running
  under a nested `<Provider>` with its own store — `InfiniteVirtualTableStoreProvider` builds one
  via `createStore()` — must read `get(queryClientAtom)` in atom scope or
  `useAtomValue(queryClientAtom)` in a component, so it picks up the nearest store. If you are
  unsure which applies, check whether the file's callers can run inside that provider.
- **Do not change any query key, `staleTime`, `enabled` or `refetchType`.** This change is purely
  *which client* is addressed. Behaviour changes belong in WP4.

### Step 3: leave the singleton export in place

`@agenta/shared/api`'s `queryClient` is still what the hosts pass to `QueryClientProvider` — OSS
`_app` and mobile both import it. Do not delete it. You are only removing its use *inside
packages*.

## WP2 — stop it recurring

1. **Lint rule.** Add to `web/packages/eslint.config.mjs` — there is an exact precedent to copy at
   line 61, the `no-restricted-imports` block banning the `@agenta/sdk` root barrel. Add an entry
   for `@agenta/shared/api` with `importNames: ["queryClient"]` and a message pointing at
   `getHostQueryClient`. Verify it fires by temporarily reintroducing one import.
2. **Dev assertion.** In `packages/agenta-shared/src/api/queryClient.ts`, warn once in
   development if the singleton is not the client in `queryClientAtom`. This is the check that
   would have collapsed the original investigation into one console line. Guard it so it cannot
   fire during SSR or before hydration (a `setTimeout(…, 0)` on first client use, or on first
   `getHostQueryClient()` call, is enough).
3. **Document the contract.** In `web/AGENTS.md` or the `agenta-package-practices` skill: a host
   MUST pass `@agenta/shared/api`'s `queryClient` to `QueryClientProvider` **and** hydrate
   `queryClientAtom` with the same object; package code MUST NOT import the singleton.

## WP3 — sweep `/m`

Everything in the table was dead on mobile until the fix, so anything already shipped on `/m` that
depends on those paths needs a manual pass, not just triggers: Tools connect / reconnect /
connection manager, webhooks, projects and members CRUD, deployments, and any optimistic toggle.
For each: perform the mutation and confirm the UI settles **without a reload**.

## WP4 — separate, do not bundle

The gateway queries (`connections`, `subscriptions`, `schedules`, `catalog`) all set
`staleTime: 30_000` + `refetchOnWindowFocus: false`, so they refresh only via explicit
invalidation. That is why returning from the Gmail OAuth popup showed a stale drawer. Decide
whether to enable focus refetch for these or invalidate explicitly on OAuth return — but as its
own change, so WP1 stays a pure mechanical swap.

## Verifying your work

**Static gates, before committing** (from `web/`):

```bash
pnpm lint-fix                                   # must be 24/24, and leave the tree clean
for p in @agenta/shared @agenta/ui @agenta/entities @agenta/entity-ui @agenta/settings-ui \
         @agenta/oss @agenta/ee @agenta/mobile; do
  echo "$p: $(pnpm --filter $p exec tsc --noEmit 2>&1 | grep -c 'error TS')"
done                                            # all 0
pnpm --filter @agenta/entities test:unit
```

Gate on the **error-signature diff**, not the count — the oss count fluctuates with cache state.

**Live gate — this is the one that matters.** A green `tsc` proves nothing here; the original bug
type-checked perfectly. Arda runs the dev servers, so ask him for a URL rather than starting one.
On `/m`, Settings → Triggers: create a subscription, delete a subscription, create a schedule.
Each must update the table with no reload and no refresh-button press.

**If something still does not refresh**, use the probe recipe in `plan.md` §"How to verify a host
is wired correctly" before theorising. Tag the singleton, log the ids of `queryClientAtom`,
`useQueryClient()` and the singleton, and dump `getQueryCache().getAll()`. Three matching ids means
the plumbing is right and the problem is elsewhere.

## Do not spend time on

All of these were investigated and eliminated — `plan.md` records the evidence:

- Duplicate `jotai` / `jotai-tanstack-query` / `@tanstack/react-query` modules. One instance each;
  the extra copies in the pnpm store are orphans nothing imports.
- `experimental_prefetchInRender`. Disabling it changed nothing.
- `refetchType: 'active'` / the `enabled: get(idleReadyAtom)` gate. Plausible from the symptom and
  wrong — the query was in a different cache entirely.
- Next `transpilePackages` / module duplication of `@agenta/shared`. It resolves to one real path
  from every consumer.

## Conventions you must follow

- Frontend rules live in `web/AGENTS.md`; package placement rules in the `agenta-package-practices`
  skill. Read both before writing code.
- Comments: at most one short line each (`web/AGENTS.md` hard rule). Do not narrate the migration
  in prose at every call site — one comment on the accessor is enough.
- Never put "Claude", "Anthropic" or `Co-Authored-By` in a commit message or PR body.
- PR title format is in the root `AGENTS.md`; the `write-pr-description` skill has the body format.
  Suggested title: `fix(frontend): package cache writes address the host's QueryClient`.

## Definition of done

- No file under `web/packages/**` imports `queryClient` from `@agenta/shared/api`; the lint rule
  enforces it and fails when violated.
- The dev assertion fires on a deliberately mismatched host and is silent on a correct one.
- Static gates green; `/m` create/delete/update verified live on triggers plus the WP3 surfaces.
- The host contract is written down where the next person will find it.
