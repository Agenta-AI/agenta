# App boot optimizations — collapsing the serial gate chain

Status: ANALYSIS + PLAN (2026-07-19, not built)
Scope: initial-load time of the web app (agent playground as the reference route).
Constraints: Next.js pages router stays; no Next upgrade; no app-router migration;
SuperTokens stays.
Companion: docs/design/playground-query-persistence/plan.md (the data-layer work this
plan complements — data is now largely disk-served; boot is the remaining felt cost).

## The boot model (what actually happens)

The server delivers an effectively empty shell (theme pre-paint only — the inline
`_document` script sets `.dark` before paint). Everything else is client-JS, and it
runs as a **serial chain of four null-render gates**, each of which must fully release
before the next is even discovered:

```text
HTML → [BLOCK] /__env.js (beforeInteractive, Cache-Control: no-store)
     → parse _app JS (~3.56 MB uncompressed; page-route chunk 326 KB loads in parallel — fine)
     → GATE 1  AuthProvider renders null
               → effect: await import(frontendConfig) [CHUNK ROUND-TRIP]
               → SuperTokens.init (cookie-only, no network)
               → setIsInitialized → ENTIRE provider tree mounts (double render)
     → GATE 2  Layout chunk (dynamic ssr:false, ~336 KB) [SEQUENTIAL CHUNK ROUND-TRIP, no preload]
     → GATE 3  ProtectedRoute renders null until protectedRouteReadyAtom
               (session + profile + project + org resolution; the atom FLIPS MULTIPLE
               TIMES during auth resolution — each flip unmounts/remounts the whole
               page subtree)
     → GATE 4  Playground chunk (dynamic ssr:false, ~10.19 MB uncompressed, 37 files)
               [SEQUENTIAL CHUNK ROUND-TRIP, ZERO preload/warmup anywhere]
     → data gates (revision/inspect/records — now largely IndexedDB-served)
```

Key facts with evidence:

- **The 10 MB Playground graph has no warmup.** It is discovered only after Gates 1–3
  release. The only prefetch in the codebase (`VariantsComponents/index.tsx:125`)
  warms the 326 KB page-route chunk, not this lazy leaf. `preloadEditorPlugins` runs
  *after* Playground mounts.
- **Gate 1 is self-inflicted latency**: the session check is cookie-only; the gate's
  cost is an async chunk fetch (`frontendConfig`) plus an effect tick, serialized
  before *everything* (state, theme, Layout, queries all wait).
- **Gate 3 is unstable**: `state/url/auth.ts` sets `protectedRouteReadyAtom` false at
  6 sites and true at 3 during boot; `ProtectedRoute` swaps `null ↔ children`, so each
  early flip can unmount the page subtree mid-boot (and re-trigger the Gate-4 dynamic
  mount). It also subscribes 5 boot-volatile sources directly.
- **`/__env.js`** is `beforeInteractive` + `no-store`: a render-blocking, never-cached
  script fetch on every single load.
- **Healthy parts (leave alone):** playground URL rewrites use `history.replaceState`
  and bypass all router events — zero `_app` churn during editing; `PreloadQueries` is
  a correctly isolated warmup leaf; the theme pre-paint prevents wrong-theme flash;
  `appStateSnapshotAtom` writes are signature-deduped to real navigations.

### Re-render amplifiers (ranked by breadth × flip-count)

1. `AppWithVariants` subscribes the whole `appStateSnapshotAtom` (`Layout.tsx:174`);
   every navigation writes a fresh object (with `timestamp: Date.now()`) →
   the widest subtree re-renders per navigation. Inline antd `ConfigProvider`
   `theme={{algorithm…}}` object literals at `Layout.tsx:299-306`/`:332-338` compound
   it (cssinjs re-eval).
2. `ThemeContext.Provider value={{…}}` is an inline object (`ThemeContextProvider.tsx:247-253`)
   → every provider re-render fans out to all `useAppTheme` consumers (Layout, Sidebar,
   ThemeContextBridge). `ThemeContextBridge` additionally rebuilds `{...token, isDark}`
   per render.
3. Gate-3 flips (above) — mount/unmount is the most expensive re-render there is.
4. Sidebar: `memo`'d island defeated by internal subscriptions (`useRouter()`, theme
   context, session/org/currentApp flips) → ~5+ full menu recomputes during boot.
5. `useSession` writes session atoms in effects; each boot flip cascades to every
   session-gated consumer.
6. `currentWorkflowContextAtom` returns a fresh object per query phase (no selectAtom)
   → PlaygroundRouter re-renders per transition; a `workflowKind` change remounts
   Playground.
7. PlaygroundHeader/MainLayout inline `useMemo(() => atom(...))` atoms re-subscribe
   when input identities change.
8. `AppGlobalWrappers` reconciles ~15 null dynamic children per router event (cheap,
   bounded — low priority).

## The plan (ranked; measure between tiers)

### Tier 1 — collapse the serial chain (structural, low-risk, highest impact)

**T1.1 Warm the Playground chunk immediately.** Hoist the `import()` thunk
(`const load = () => import("../Playground/Playground")`), share it with `dynamic()`,
and invoke it at PlaygroundRouter module-eval (or first idle) — the 10 MB download+parse
then runs IN PARALLEL with Gates 1–3 instead of after them. Same pattern for the Layout
chunk from `_app`. This is the single biggest structural win: it converts the two
sequential chunk round-trips into parallel work behind the auth/data gates.

**T1.2 De-async Gate 1.** Import `frontendConfig` statically in AuthProvider (its
recipe deps — supertokens-auth-react — are already in the `_app` vendor bundle, so the
chunk split buys ~nothing) and call `SuperTokens.init` at module scope (it is
synchronous). Gate 1 then collapses to ~zero and the double mount of the entire
provider tree disappears. Verify: no SSR pitfalls (init guarded by `typeof window`),
`fromSupertokens === "needs-refresh"` path preserved.

**T1.3 Latch Gate 3.** `protectedRouteReadyAtom`: once true, stay true for the session
(reset only on real sign-out), so mid-boot auth-resolution flips stop unmounting the
page subtree. Additionally render the page shell (skeleton) instead of `null` while
not-ready, so gate release is a fill-in rather than a mount storm. Collapse
ProtectedRoute's 5 subscriptions into one derived boolean atom.

**T1.4 Unblock `/__env.js`.** The standalone server can inline the env payload into
`_document` at request time (it already templates HTML), removing a render-blocking,
uncacheable round-trip from every load. Fallback option: keep the script but allow a
short max-age + ETag.

### Tier 2 — re-render hygiene (mechanical, low-risk)

**T2.1** Memoize the four unstable identities: ThemeContext provider value,
ThemeContextBridge token object, `AgSWRConfig` config object, both nested
`ConfigProvider theme` literals in Layout.
**T2.2** Narrow `AppWithVariants`'s snapshot subscription to the slices it renders
(selectAtom with equality), and stop stamping `timestamp: Date.now()` into the
snapshot object (or exclude it from equality).
**T2.3** `currentWorkflowContextAtom` → stable-identity selector (selectAtom or
equalityFn) so query-phase transitions don't re-render PlaygroundRouter; same
treatment for ProtectedRoute's derived ready-boolean (T1.3).
**T2.4** Sidebar: replace `useRouter()` with a pathname selector; benefits from T2.1
automatically. Hoist PlaygroundHeader's inline `useMemo(atom)` instances where inputs
churn.

### Tier 3 — flagged, not recommended now

- **Split the 10 MB Playground graph** (agent vs prompt branches; MainLayout statically
  imports ExecutionItems/comparison views). Real but large refactor; T1.1 removes the
  serialization pain first — re-measure before considering.
- **SSR/streaming shell** — excluded by constraints (pages router, ssr:false layers,
  window-guarded Layout).
- **`_app` entity-cascade trim** (~450 KB) — previously attempted and reverted
  (multi-root, registration-race risk). Unchanged verdict.

## Expected effects (directional, verify by measuring)

- T1.1: removes 10 MB of *serialized* download+parse from the critical path — in dev
  (uncompressed, unminified) this is the dominant term; in prod (~gzip) still the
  largest single structural win.
- T1.2: −1 chunk round-trip, −1 full-tree double mount at the very front of boot.
- T1.3: eliminates mid-boot page-subtree remounts (worst-case re-render class).
- T1.4: −1 blocking uncached request before hydration on every load.
- Tier 2: fewer/narrower re-renders during the boot window in which the main thread is
  already contended with chunk parse — the wins compound with Tier 1 rather than
  standing alone.

## Measurement protocol

Prod build (`next build && next start`), Performance panel: mark
(1) nav → first shell paint, (2) → PlaygroundLoadingShell, (3) → real config+chat.
Compare before/after per tier. In dev, the same ordering holds with larger absolute
numbers; use the same three marks.
