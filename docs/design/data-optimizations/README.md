# Data & render optimizations — branch summary

Branch: `fe-refactor/data-optimizations`
Status: **built and profiler/HAR-verified** (not yet merged)
Scope: warm-reload and cold-load cost of the web app, with the **agent playground** as the
reference route.

**Out of scope for this branch:** the drive / file / mount surfaces (virtualization, the unified
Files drawer, the paged listing endpoint). That work ships separately in
[PR #5400](https://github.com/Agenta-AI/agenta/pull/5400), which this branch is stacked on. No
commit here touches `Drives/`, `mounts`, or `/files`.

Companion docs (deeper detail on two sub-efforts):

- [app-boot-optimizations/plan.md](../app-boot-optimizations/plan.md) — the serial boot gate chain
- [app-boot-optimizations/gates.md](../app-boot-optimizations/gates.md) — render-gate ladder audit
- [playground-query-persistence/plan.md](../playground-query-persistence/plan.md) — the IndexedDB layer

---

## What we tackled

### 1. Per-query IndexedDB persistence (paint-from-disk)

A per-query persister layer over TanStack Query, backed by one IndexedDB database
(`agenta-query-cache` / store `queries`), with four classes:

| persister | prefix | maxAge | on restore | used for |
|---|---|---|---|---|
| `immutablePersister` | `agenta-imm` | ∞ | never refetch | immutable-by-key bodies (workflow revisions, trace summaries) |
| `catalogPersister` | `agenta-cat` | 14d | one revalidate if stale | catalogs/schemas/profile/projects/workflow detail |
| `recordsPersister` | `agenta-rec` | 7d | **always** revalidate | session record logs (append-only, disk never authoritative) |
| `vaultSecretsPersister` | `agenta-vault` | — | **always** revalidate | LLM provider rows, **redacted** before write |

Everything not on that list is memory-only and refetched per cold load.

### 2. Cold-load request reduction

HAR-driven removal of redundant and head-of-line requests: duplicate by-id workflow fetches,
an eager revisions-list fetch, a per-reload-rotating inspect persist key, session records
fetched 3×, and null-fetch stragglers. Secondary reads demoted to `priority: "low"`.

### 3. Boot render-gate hygiene

Latching the protected-route gate, prewarming the boot atom graph and the serialized boot chunks,
un-gating org detail from `/profile`, config-accordion render hygiene, naming anonymous
`forwardRef`s, and skipping the Tooltip wrapper on tooltip-less buttons. Detail in the
companion docs.

### 4. Session-UI boot render cost (`e3495d2292`)

Three fixes on the session rail/tab surfaces, all profiler-confirmed:

- **Latch-mount `SessionRail`.** It lives in a `size={0}` + `inert` splitter panel until the chat is
  maximized, but was rendered unconditionally — mounting the whole session list (~1000 renders,
  **10–15% of all boot React work**) plus fetching its lazy chunk, into a zero-width panel. Now
  mounted on first open and kept mounted after.
- **Hover-gate the rename/delete/close clusters.** Each button drags a Tooltip + Trigger + icon
  subtree; a full history of rows paid all of it on boot behind `opacity-0` — **984 renders,
  7.8–12.3% of React work**, for pixels nobody sees. Now mounted on hover/focus, with keyboard
  access preserved via the focusable row plus a focus-leave guard.
- **Memoize the rows** (`SessionRailRow`, `SessionTag`) with id-taking callbacks and hoisted static
  icon elements, so a streamed token or liveness poll no longer re-renders every row.

Measured (same session, baseline → after): `Button` 375 → 87 renders, `Tooltip` 439 → 177,
`IconBase` 538 → 258, `SessionStatusDot` 176 → 50. Both row components went from ~2 re-renders per
mount to **0**, reproducible across three independent captures.

### 5. Request dedup + stop cancelling boot queries (`7f4905a0df`)

- `revalidateSessionRecordsAtom` invalidated with TanStack's default `cancelRefetch: true`, killing
  an in-flight records fetch and restarting an identical one. It fires from `onFinish` when the SDK
  auto-resumes the restored last turn on reload — i.e. every warm boot. Now `cancelRefetch: false`,
  matching `revalidateSessionMountsAtom`, whose comment documents the same hazard.
- `workflowDetailQueryAtomFamily` and `workflowArtifactScopedQueryAtomFamily` issue the **same**
  `POST /workflows/query` (same body) under two cache keys. They now cross-prime each other, so
  whichever runs first satisfies the other.

### 6. Latest-revision persistence — "Phase 1" (`96b7f1363f`)

The revision *body* was already disk-served, but a warm reload still blocked on the latest-revision
round-trip (1.7–5 s on a slow backend) to resolve the fallback selector, the "latest" tag, and the
dirty/commit affordance. Now `catalogPersister` is attached to
`workflowLatestRevisionQueryAtomFamily`, **plus** the two `setQueryData` prime paths mirror to IDB
via `persistQueryByKey` — without that, a session that only ever *primed* the latest (dedicated
query disabled) would leave nothing on disk to restore.

Verified: the blocking `workflows/revisions/query` is **absent** from the warm-reload HAR.

### 7. Removed the persistence kill switch (`f19395f798`)

See *Learnings* — this is the one that made everything else actually work.

---

## What we deliberately did **not** tackle

- **Phase 2 — persisting the variant/revision *list* queries.** Scoped and gated, then parked. Two
  reasons: once Phase 1 landed, the lists were no longer on the critical path (they're fast,
  Low-priority background fetches), and the gate test proved it is *not* a clean persister-add — see
  the `isFetched` learning below. Revisit only if the switcher is measurably slow.
- **The sidebar `Menu` churn.** Attempted and **reverted**. Memoizing inside `SidebarMenu` was a
  no-op because the inputs are unstable upstream (`menuProps` is a fresh object literal per render;
  `section.items` comes from `scope.useSections()`, which rebuilds every render). A real fix means
  refactoring the sidebar scope engine — its churn is also partly legitimate (route/`openKeys`
  resolving during boot). Not worth the risk/value.
- **Deep config-panel work** (`AgentTemplateControl`, `ConfigAccordionSection`,
  `SchemaPropertyRenderer` — still the largest React cost). `sections` is a ~20-dependency inline
  array; wholesale `useMemo` is a real stale-UI risk on core config code. We verified the collapsed
  bodies aren't the prize either (the heavy sections are drawer-openers that render `children` as
  `null`). Squeezing further means structural work, not pattern-reuse.
- **Persisting `organizations` / `organizations/{id}`.** High-priority and unpersisted, so they're
  candidates — but org data drives workspace/permissions, so stale-then-revalidate has a real
  correctness surface. Deferred pending evidence it's a felt cost.
- **The `billing/subscription` 502.** Investigated, no code change needed. The FE already handles it
  deliberately: never retries 502/503/504, deferred to browser idle at Low priority, degrades to
  hobby/free, and is config-gated behind `isBillingEnabled()`. The 502 is a **local EE dev artifact**
  (billing flagged on via `NEXT_PUBLIC_AGENTA_BILLING_ENABLED` while Stripe/the billing service
  isn't configured); the handler itself returns a clean 404 for "no subscription".
- **The serial boot gate chain** (`profile → organizations → project-scoped queries → mounts`). This
  is the single biggest remaining lever, but it belongs to the app-boot workstream, not the data
  layer. Partly addressed (org detail un-gated from `/profile`); the rest is a separate project.
- **`sessions/mounts` + `sessions/records` cancelled pair (unmount variant).** The
  *invalidate*-triggered cancel is fixed. A second variant — both queries aborted mid-flight by a
  component unmount, then cleanly refired — appeared in slow-backend captures but not in the healthy
  warm one. Not root-caused.

---

## Important learnings

### A silent kill switch disabled the entire persistence layer

**This cost the most time by far.** The layer was built but never live-verified, and a stale
`localStorage["agenta:persist:disable"] = "1"` flag (from earlier A/B debugging) made every
IndexedDB read and write a silent no-op. The failure was invisible because:

- `getItem`/`setItem` **early-returned before logging**, so the debug output showed nothing.
- `entries()` (used by GC) **did not check the flag**, so GC kept happily reporting
  `[persist] GC 17 entries` — proving data existed on disk while nothing could read it.

Every "warm" reload was therefore cold, and every measurement of the persistence work read as
"it does nothing." The fix was to **remove the kill switch entirely** — persistence is now
unconditional, and removing the *check* (not just the flag) self-heals any browser that still has
the stale flag set.

**Takeaway:** a debug kill switch that fails silently is worse than no kill switch. If one must
exist, it has to be loud.

### Verify the layer runs before optimizing on top of it

We shipped Phase 1 and measured it against captures where persistence wasn't executing at all —
and nearly concluded the work was ineffective. Confirm the foundation is live (one `[persist] HIT`
line would have done it) before attributing results to changes built on it.

### `isPending` vs `isFetching` — most consumers were already SWR-safe

The worry that paint-from-disk would be undone by components blanking to skeletons on the background
revalidate turned out to be **mostly unfounded**. TanStack v5's `isPending` is `false` whenever data
exists, including mid-revalidate, and the codebase gates on `isPending` almost everywhere
(`isFetching` appears once, off the reload path). `PlaygroundConfigSection` even belt-and-suspenders
it: `schemaQuery.isPending && !hasRenderableConfigSections(activeData)`.

The audit was worth doing — but the correct outcome was **"change 2 selection hooks, not 30
components."**

### `isFetched` is `true` after a persister restore — even for an empty list

The Phase 2 gate test ([persist.test.ts](../../../web/packages/agenta-shared/tests/unit/persist.test.ts),
[autoSelectLatestChild.restore.test.ts](../../../web/packages/agenta-entity-ui/tests/unit/autoSelectLatestChild.restore.test.ts))
pinned this: a restored query reports `isPending: false` (good) but `isFetched: true` — because the
persisted state carries `dataUpdateCount: 1`. That bypasses `resolveAutoSelectLatestChild`'s
`isFetched === false` wait-guard, so an **empty** restore returns `"complete"` with no selection
instead of waiting for the revalidate that brings the real revision. This is a *correctness* hazard,
not a visual one, and it's why Phase 2 is not a blind persister-add.

### `setQueryData` bypasses the persister

Anything primed imperatively never reaches disk. Both the revision-body cache and the
latest-revision cache need an explicit `persistQueryByKey` mirror alongside their `setQueryData`
calls, or the disk copy silently never exists.

### Measure render *counts*, not self-time, across runs

Per-render self time moved 1.25–2.3× between captures purely from backend/machine contention, which
twice led to a wrong conclusion (once "Button regressed 2x" — it hadn't). Render **counts** and
**re-renders-per-mount** are contention-independent and were the only reliable cross-run metric.
Normalizing self-time against a global mean is *not* valid: the global mean is dominated by trivial
fibers that inflate differently than heavy components.

### Hidden UI is not free

Two of the largest wins were subtrees that were never visible: a whole session rail mounted into a
zero-width panel, and ~106 hover-action buttons rendered behind `opacity-0`. CSS-hiding
(`opacity-0`, `width: 0`, `inert`) still costs full mount + reconciliation. Gate on *mount*, not on
*paint*.

### Don't memoize without verifying the inputs are stable

The reverted sidebar change: a `useMemo`/`useCallback` whose dependencies change every render is
dead weight. Always confirm the upstream props are referentially stable first — the profiler will
show it (`changed props: {menuProps, items, …}` every commit).

### Tooling notes

- **React DevTools profiler exports** use variable-length opcodes in the `operations` stream that
  break naive parsers. A tolerant decoder (resync by trying candidate skips and validating a
  lookahead) is needed to recover fiber names — without it, everything reads as `#1234`.
- **Never `rm -rf node_modules/.pnpm` alone.** It empties the virtual store but leaves pnpm's state
  file, after which every `pnpm install` reports "Already up to date" and refuses to rematerialize,
  leaving all binaries as dangling symlinks. Use `pnpm install --force`, or remove all of
  `node_modules`.
- A **duplicated `@tanstack/query-core`** would put the persister and the app's QueryClient on
  different instances and silently break restore. `pnpm-workspace.yaml` pins it to a single version;
  keep it in lockstep with `@tanstack/react-query`.

---

## Verification status

| area | status |
|---|---|
| Session-UI render hygiene | **Verified** — 5 profiler captures, reproducible |
| Request dedup / cancel fix | **Verified** — cancelled pair absent from warm HAR |
| Phase 1 latest-revision persistence | **Verified** — `[persist] HIT` logs + blocking request gone |
| Persistence layer end-to-end | **Verified** — HITs for profile, projects, detail, body, records, vault |
| Phase 2 | Not built (gate tests only) |

Known pre-existing failure on the base PR, not from this branch: `session-mounts-store.test.ts`
(2 tests) fails identically on `origin/fe-refactor/drive-surfaces`.
