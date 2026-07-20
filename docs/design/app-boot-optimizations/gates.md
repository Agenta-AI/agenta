# Playground render-gate ladder (bottom-up audit, 2026-07-20)

Why: on warm reloads the config panel showed loading states even though its data is
IndexedDB-restorable. Central mechanic: **persister restores are asynchronous** — a
disk-served query still passes through `isPending: true` (and `data === undefined`)
for a frame or more, so any `isPending → skeleton` gate treats instant-disk data like
a cold network fetch. `enabled: false` queries report `isPending: true` forever
(drafts — but see the draft analysis: the molecule's `selectors.query` wrapper
special-cases drafts to `isPending: false`, molecule.ts:164-172, so panel gates never
hit that trap directly).

Legend: [SAFE-RELAX] = gate can key on data presence / synchronous signal;
[RESTRUCTURE] = relaxable with reordering; [KEEP] = correctness latch, leave alone.

## Level 1 — config-section internals (entity-ui)

| Gate | Condition | Verdict |
|---|---|---|
| PlaygroundConfigSection ~1888 config skeleton | `schemaQuery.isPending && !hasRenderableConfigSections(activeData)` | **[SAFE-RELAX → RELAXED]** — the data-presence term is sufficient; the `isPending` term only shows the skeleton during the restore frame |
| PCS ~695 revision-switch latch | keep previous render until target data or settled | [KEEP] — swap-correctness latch, prefers data-presence already |
| PCS ~1906 "No configuration needed" | data-null empty state | [RESTRUCTURE] — reached wrongly for drafts pre-hydration; held off by gate 2.1 |
| SchemaPropertyRenderer ~448 Suspense(AgentTemplateControl) | lazy chunk import | **[SAFE-RELAX → RELAXED]** — preload on the synchronous early-agent signal instead of idle |
| useModelHarness vault/capabilities gates | vault + inspect catalogs | [KEEP] — gate a warning / pick a control variant; never hold the body |

## Level 2 — config panel host (PlaygroundVariantConfig)

| Gate | Condition | Verdict |
|---|---|---|
| ~281 `hasPendingHydration` skeleton | pending URL-snapshot hydration; clears when the SOURCE revision query is `!isPending && data` (playground.ts ~900-913) | **[RESTRUCTURE]** — the draft warm-reload skeleton. Must hold (removing it falls through to the wrong "No configuration needed" state), but should resolve off disk-present source *data*; `workflowLocalServerDataAtomFamily` (store.ts ~2361) is in-memory-only and could be reseeded synchronously |
| ~99 `isAgentHeaderMode` incl. `variantQueryPending` disjunct | agent-vs-prompt chrome | **[SAFE-RELAX → RELAXED]** — `earlyAgentState` covers the persisted case synchronously; the pending disjunct mislabels prompt apps as agent for a tick |
| ~341 agent operations skeleton | `hasPendingHydration \|\| (!isAgent && earlyAgentState!=="agent")` | [RESTRUCTURE] — tied to 2.1 |

## Level 3 — MainLayout

| Gate | Condition | Verdict |
|---|---|---|
| ~402 `configEntityIds.length === 0` placeholder | selection not yet applied | **[RESTRUCTURE]** — persisted selection is synchronously readable but applied in `playgroundSyncAtom.onMount` (post-first-commit) → one-frame placeholder |
| ~299 EmptyState (`status === "empty"`) | initialized + empty | [KEEP] — correctly distinct from the idle frame |
| ~519 AgentChatSkeleton | `isAgentConfig && singleEntityQuery.isPending` | **[SAFE-RELAX → RELAXED]** — key on data presence |
| ~183 / ~222 agent host + config latches | isPending-conservative latches | [KEEP] — protect live chat / splitter geometry across swaps |
| ~497 GenerationPanelPlaceholder | same empty-selection frame as 3.1 | [RESTRUCTURE] — same fix |

## Level 4 — Playground root

`playgroundSyncAtom` mounts the sync engine in `onMount` — one commit too late for the
synchronous selection restore ([RESTRUCTURE], the root cause of the Level-3 frames).
Onboarding loader is flag-gated ([KEEP]). No other config-subtree gates.

## Level 5 — PlaygroundRouter

Chunk `loading` shells are warmed (brief). The evaluator-vs-app branch resolves from
the now-persisted + prewarmed detail query ([SAFE-RELAX] residual: avoid an
`isPending`-shaped shell frame; largely mitigated).

## Levels 6-8 — ProtectedRoute → Layout → `_app`

Documented in plan.md (boot model): latched ready-gate + BootShell, warmed chunks,
de-async'd auth init, prewarmed boot query graph. Ready-atom has zero network deps on
warm workspace routes; remaining wait is main-thread parse.

## Draft warm-reload chain (the reported symptom)

Draft selected → `workflowLocalServerDataAtomFamily` is in-memory-null after reload →
panel data null → gate 2.1 holds the skeleton pending hydration → hydration waits for
the SOURCE revision's query to be `!isPending && data` → that query's `initialData`
reads the in-memory detail cache (empty on reload) and fills from the persister
asynchronously. Net: the skeleton's length = source-revision disk-restore latency,
even though the data is on disk. Fix path: hydration resolves on disk-present data +
synchronous reseed of the local-server-data atom (+ gate 1.1 relax so restored
parameters render immediately).

## Status

Relaxed in this round: 1.1 (isPending term dropped), 1.4 (early preload), 2.2 (sync
early-agent signal), 3.3 (data-presence). Restructures pending: 2.1 hydration
fast-path, 3.1/3.6 selection-before-first-render.
