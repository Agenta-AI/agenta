# `@agenta/playground-ui` — Storybook coverage map

Which components get stories, in what order, and what each one costs. Companion to
[playground-ui.md](../playground-ui.md) (the migration guide) and
[findings.md](findings.md) (the readiness scan).

**Measured on `main` @ `ecacb20d5f`, 2026-08-07.** Re-run the Appendix before trusting it.

> ## Status: BOTH jobs are done — the migration and the story inventory
> **31 → 0 antd files.** The last two were type-only and are now retyped onto `@agenta/ui`'s
> `EnhancedButtonProps` / `EnhancedModalProps`; `antd` and `@ant-design/icons` are out of
> `peerDependencies`. **This is the first genuinely antd-free UI package in the repo.**
>
> Stories: **82 gated ids covering every renderable component.** a11y PASS across all 82,
> `render-check` PASS in BOTH themes across all 82, VRT PASS. The Tier tables below are kept as
> the historical record of how the work was sequenced — they are no longer a backlog.

## Where coverage stands

| package | renderable components | story ids |
| ---------------------- | --------------------: | --------: |
| `@agenta/ui`           |                  ~145 |        89 |
| `@agenta/entity-ui`    |                  ~168 |        86 |
| `@agenta/playground-ui` |                **49** |    **82** |

49 = 52 `.tsx`, less one barrel-only `index.tsx` and two pure context files
(`PlaygroundUIContext`, `DrawerContext`). `EntitySelector.tsx` contains a `createContext` but
is genuinely renderable, so it counts.

### Verifying the "every component" claim

Do not trust a story count — match component files against what the stories actually name:

```bash
cd web/packages/agenta-playground-ui/src && find . -name '*.tsx' | grep -v '\.stories\.' | sort
cd web/storybook/stories/playground-ui && grep -ho '\b[A-Z][A-Za-z]*\b' *.stories.tsx _fixtures/*.ts | sort -u
```

Three files never appear by name, all explained:

| file | why |
| --- | --- |
| `ExecutionRow/shared.tsx` | filename only — its export `ExecutionRowRunControl` **is** storied (`execution-leaves--run-control`) |
| `TestsetSelectionSidebar.tsx` | rendered transitively by `LoadModeContent` (`LoadModeContent.tsx:301`) |
| `context/PlaygroundUIContext.tsx` | a pure context — no render surface |

## What the gates are worth here

The backfill stories are **showcases with no antd half by decision**, so the VRT contributes no
pixel signal for them — it only enforces that every id is registered with a written reason. The
real gates became:

1. **`parity/render-check.mjs`** (added in this pass) — every id × light and dark, asserting the
   story rendered, did not crash, and logged no console/page error. This is the primary
   correctness gate for the backfill, and it is what caught a 404 fixture gap.
2. **`parity/a11y.mjs`** — which found **37 critical `button-name` nodes** the migration had
   shipped (F26, F27).
3. **Eyeballing dark**, because `a11y.mjs` hardcodes `theme:light`.

`a11y.mjs` now prints the measured `fg / bg / ratio` for every gated contrast node, so a waiver
cannot be written from guesswork — the wave-3 record has three waivers whose first draft was
fiction.

## The two access rules

### 1. Most components are already reachable — check before adding an export

**26 of the 45 can be storied today with zero API change.** Resolve reach by walking every
entry in `package.json` `exports`, not by reading the main barrel:

| subpath | exposes |
| --- | --- |
| `./components` | `EmptyState`, `EntitySelector`, `ExecutionResultView`, `ExecutionHeader`, `ToolCallView`, `ControlsBar`, `PlaygroundOutputs`, `ExecutionItems`, both `GatewayTool*`, `TestsetSelectionModal` |
| `./comparison-view` | all 4 `GenerationComparison*` + `GenerationComparisonOutput` |
| `./playground-inputs-body` | `PlaygroundInputsBody`, `PlaygroundInputsBodyHost`, `VariableCard`, `UnreferencedColumnsFooter` |
| `./adapters` | `TurnMessageAdapter`, `VariableControlAdapter`, `TurnMessageHeaderOptions` |
| `./workflow-revision-drawer` | `WorkflowRevisionDrawer` |
| `./testset-selection` | the chunk-1 set |

`TurnMessageHeaderOptions` is the easy one to miss — it is re-exported through `./adapters`
even though the component does not live under `adapters/`.

### 2. When a component is NOT reachable, add a subpath — never a barrel re-export

`components/index.ts:38-41` records a deliberate non-export: a barrel **value** re-export of
`ChatMode`/`CompletionMode`/comparison-view would statically pull code-split chunks into every
consumer of that entry.

> The comment's stated reason is stale — it claims "the package has no sideEffects config",
> but `package.json` sets `"sideEffects": false`. The intent still holds; do not reverse it
> casually.

This also rules out adding `ChatTurnView` & co. to `ExecutionItems/index.tsx`: that file *is*
the `./execution-items` **and** `./generations` entry, so anything added there lands in every
consumer of both. **Chunk 5 gets a new `./execution-row` entry instead.**

19 components need new access, all in Tier B.

---

## Story files, and what each covers

The finished layout. Group leaves into one file per area; give composites their own.

| file | covers |
| --- | --- |
| `Presentational.stories.tsx` | `ControlsBar`, `EmptyState`, `ToolCallView` |
| `SharedLeaves.stories.tsx` | `NodeNameTag`, placeholders, `TypingIndicator`, `RepetitionNavigation` |
| `SharedParts.stories.tsx` | `EntityStatusTag`, `EvaluatorFieldGrid`, `NodeResultCard` |
| `CreateTestsetCard` / `SelectionSummary` / `TestsetSelectionPreview` / `LoadModeContent` / `TestsetSelectionModal` | the testset-selection area (chunk 1 + its modal shell) |
| `VariableCard.stories.tsx`, `InputsParts.stories.tsx` | `VariableCard`, `PlaygroundInputsBody`, `UnreferencedColumnsFooter` |
| `TurnMessageHeaderOptions.stories.tsx` | the per-message toolbar |
| `WorkflowRevisionDrawer.stories.tsx` | the drawer, `DrawerHeader`, `MetadataSidebar`, `DrawerContent` |
| `ExecutionLeaves.stories.tsx` | run control, run options, row actions, gateway tools, comparison input header |
| `ComparisonView.stories.tsx` | all four `GenerationComparison*` |
| `ExecutionComposites.stories.tsx` | `ExecutionItems`, `ExecutionRow`, `SingleLayout`, `ComparisonLayout`, `ChatTurnView` |
| `Modes.stories.tsx` | `ChatMode`, `CompletionMode` |
| `Adapters.stories.tsx` | `TurnMessageAdapter`, `VariableControlAdapter` |
| `Outputs.stories.tsx` | `PlaygroundOutputs`, `ExecutionHeader`, `ExecutionResultView`, `PlaygroundInputsBodyHost` |
| `EntitySelector.stories.tsx` | `EntitySelector` + its modal |
| `_fixtures/` | `testsetSelection.ts`, `workflowRevision.ts`, `playgroundLoadable.ts`, `comparisonView.ts`, `outputs.ts` |

### `_fixtures/playgroundLoadable.ts` — the seam that unblocked the composites

Eleven components render **nothing** without a seeded execution graph: `generationRowIdsAtom`
(`agenta-playground/src/state/execution/selectors.ts:962`) derives rows from
`derivedLoadableIdAtom` → `testcaseMolecule.atoms.displayRowIds`. `seedPlaygroundLoadable()`
builds that graph entirely through the **existing public surface** — no package API was widened,
and the unexported `executionStateAtomFamily` / `stepsByIdAtomFamily` were never needed.

It returns `{session: false, queries, atoms: [[seedGraphAtom, options]]}`; one write-only atom
does the whole graph in a single `store.set`, because `parameters.agenta.atoms` allows one value
per call and the steps are order-dependent. In order: seed the revision query (this one entry
decides loading state, chat-vs-completion via `flags.is_chat`, and which variable cards exist) →
`playgroundController.actions.addPrimaryNode` → `executionController.actions.initSessions` →
`loadableController.actions.addRow` → chat messages → results via
`startRunAtom`/`completeRunAtom`/`failRunAtom`.

Four traps it encodes, each of which cost a debugging cycle:

- **`initSessions` is not optional.** `isCompareModeWithContext` counts *active sessions*, not
  selected entities, so a two-entity playground still routes to `SingleLayout` without it.
- **Use the row id `addRow` returns.** Reading `displayRowIds` back mid-write does not see the
  additions, so `setRows` + read-back silently produces unkeyed results.
- **A result's `output` must be `{response: {data: …}}`.** A bare string yields
  `displayValue: ""` and renders an *empty output card* — not a placeholder, not an error
  (finding F23).
- **Structured evaluator output must arrive at `response.outputs`**, not `response.data`: the
  evaluator field-grid branch is gated on `displayValue` being falsy, and anything at
  `response.data` serialises into a non-empty one.

The testcase and chat stores are global, so the seed clears both and every story uses its own
entity ids via `entityIds(prefix)`.

---

## Historical: how the work was sequenced

The Tier tables below are the plan as written *before* execution. They are kept because the
ordering rationale is still useful, but they are no longer a backlog — everything in them is done.

## Tier A — antd-free and reachable (story only, no migration)

The complete set: 9 of the 20 antd-free components. No export changes, no antd swaps.

| # | component | LOC | atoms | fixtures |
| --- | --- | --: | --: | --- |
| A1 | `ControlsBar` | 52 | 0 | none — pure props |
| A2 | `PlaygroundInputsBody` | 221 | 0 | none — pure props |
| A3 | `ToolCallView` | 250 | 0 | none — pure props |
| A4 | `TestsetSelectionModal` | 95 | 0 | none, but it is an overlay → forced-open story |
| A5 | `GatewayToolAssistantActions` | 122 | 5 | light |
| A6 | `ExecutionItems` | 150 | 4 (+2 ctx) | first `PlaygroundUIContext.Provider` story |
| A7 | `PlaygroundInputsBodyHost` | 202 | 6 | moderate |
| A8 | `GenerationComparisonChatOutput` | 245 | 9 | moderate |
| A9 | `TurnMessageAdapter` | 814 | 14 | heavy — largest antd-free file |

The other 11 antd-free components need exports and travel with their chunk: `ChatMode`,
`CompletionMode`, `ComparisonLayout`, `ExecutionRow`, `ExecutionRow/shared`, `ResultPlaceholder`
(chunk 5), `TestsetSelectionModalContent`, `TestsetSelectionSidebar`, `DrawerContent`,
`CollapseToggleButton`, and the `ExecutionItemComparisonView` index (whose content is already
reachable as `GenerationComparisonOutput`).

## Tier B — antd chunks, in dependency order

**Chunk 5 is the shared dependency; chunks 3 and 4 consume it. Chunks 2 and 6 are disjoint.**

| chunk | components | new exports |
| --- | --- | --- |
| **6** inputs | `VariableCard` (894, **9 antd** — broadest surface), `VariableControlAdapter` (576), `UnreferencedColumnsFooter` (105) | none |
| **2** drawer | `WorkflowRevisionDrawer` (133, `Drawer`→`Sheet`), `DrawerHeader` (267, 11 atoms), `MetadataSidebar` (138) | `DrawerHeader`, `MetadataSidebar` |
| **5** execution | `SingleLayout` (1084, 24 atoms, 4 ctx), `ChatTurnView` (489), `RunOptionsPopover` (91, 5 antd), `ExecutionRowActions` (67), `RepetitionNavigation` (46), `TypingIndicator` (36), `GatewayToolExecuteButton` (100) | new `./execution-row` entry |
| **3** comparison | `GenerationComparisonCompletionOutput` (387), `…InputHeader` (23), `…OutputHeader` (43) | none |
| **4** outputs | `PlaygroundOutputs` (418, 10 atoms), `ExecutionHeader` (209, 10 atoms), `ExecutionResultView` (248), `NodeResultCard` (229) | `NodeResultCard` |
| leftovers | `EntitySelector` (419), `TurnMessageHeaderOptions` (278), `EvaluatorFieldGrid` (189), `EmptyState` (41), `EntityStatusTag` (24) | `EvaluatorFieldGrid`, `EntityStatusTag` |

`SingleLayout` is the outlier — split `StepTag` (line 172) out as a presentational piece and
story it before touching the atom-coupled surface.

## Not storied (and correctly so)

Barrels, `hooks/*`, `state/*`, `store.ts`, `viewModeAtoms.ts`, contexts, `utils/*` — no render
surface. `TestsetSelectionModalContent` and `TestsetSelectionSidebar` are covered transitively
by the `LoadModeContent` stories.

Four render paths are deliberately **not** covered, each recorded in its story's docblock:

- **`ExecutionItems`' agent arm** — renders `providers.AgentGenerationPanel`, which lives in
  `web/oss` and cannot be imported from a package story. With the slot absent the arm is a no-op.
- **Chain / downstream-node rows** (`DownstreamNodeCard`, `StepCollapsedSummary`, the run-step
  dropdown) — need a depth>0 node via `addDownstreamNode` plus a second
  `${rootEntityId}:${nodeEntityId}` results namespace. A separate seed, not a variation.
- **Repetitions > 1** — `useRepetitionResult` needs a `repetitions[]` array on the RunResult that
  the fixture does not build.
- **Cell values in `PlaygroundInputsBodyHost` / `VariableControlAdapter`** — the cards, names,
  type chips and section grouping render, but values, the connected-source indicator and the
  unreferenced-columns footer all come from `testcaseMolecule.data(testcaseId)`. Minting local
  testcases there would leak rows into every other story via the global `newEntityIdsAtom`.

## Cross-story state to know about

Three non-family singletons are seeded by stories and are **not** reset between them:
`playgroundNodesAtom` (the execution stories), `entitySelectorOpenAtom` / `entitySelectorConfigAtom`
(EntitySelector). The gates navigate per story so they are unaffected, but browsing interactively
from one of those stories into another that reads playground node state will show stale nodes.
Declare `reset: [[playgroundNodesAtom, []]]` if that bites.

`EntitySelector.stories.tsx` calls `registerSelectionAdapter` + `setEvaluatorAtoms` at module
scope and deliberately avoids `initializeSelectionSystem()` — that is a one-shot singleton
(`if (initialized) return`), so whichever story imported it first would decide whether the
evaluator adapter exists for everyone.

## What the backfill found that the migration had shipped

Writing a story per component was not bookkeeping — it surfaced defects the merged migration had
already shipped, none of which any existing gate could see. Full detail in
[findings.md](findings.md):

| finding | what | how it was found |
| --- | --- | --- |
| **F26** | 35 critical `button-name` nodes: icon-only `EnhancedButton`s had a tooltip but no accessible name | a11y, once the composites finally rendered |
| **F27** | `VariableControlAdapter`'s boolean `Switch` unnamed — the *same* defect fixed in `VariableCard` during the migration | a11y |
| **F19** | `aria-dialog-name`: `EnhancedDrawer` left the Radix dialog unnamed whenever it rendered no header | a11y on the first drawer story ever written |
| **F22** | comparison columns label from `revision.name`, which `AGENTS.md` calls a review blocker | seeding a revision forced the question of which field is the label |
| **F23** | a malformed result `output` renders a blank card — no placeholder, no error | building the fixture seam |
| **F28** | `SharedEditor`'s error state uses the raw CSS keyword `red` (3.99:1, no dark variant) | a11y contrast, measured |

**F27 is the argument for per-component stories in one line:** `VariableCard` and
`VariableControlAdapter` were migrated together, both got an unnamed `Switch`. The one with a
story was caught and fixed during the migration; the one without stayed broken until it got a
story.

## Technique

Reuse, don't reinvent:

- **Parity rows** — the `Row` + `data-vrt-subject` grid in
  `stories/playground-ui/CreateTestsetCard.stories.tsx`.
- **Data seams** — `parameters.agenta` + `session: false` in
  `stories/playground-ui/LoadModeContent.stories.tsx`.

Both are written up in [playground-ui.md](../playground-ui.md): the console-driven fixture loop,
and why `session: false` is needed (a per-query `refetchOnMount: "always"` beats the harness
client default and replaces fixtures with a fetch error).

**Traps the gates cannot catch**, all found the hard way:

- A sub-1% VRT result is meaningless if the two cells are different sizes.
- The VRT diffs antd-vs-agenta, so a defect on **both** halves passes by construction.
- `a11y.mjs` hardcodes `theme:light` — dark has no a11y coverage at all.
- Neither gate proves a handler still fires.
- **A story that CRASHES passes both gates.** `VariableCard` threw
  `` `Tooltip` must be used within `TooltipProvider` `` and the VRT read the error overlay as
  "no pairs" while axe audited it as one clean root. Only opening the story caught it. There is
  now a standing crash-check for this — see below.
- **A story that renders NOTHING also passes.** `ToolCallView` returned `null` because the
  story's `resultData` had the wrong shape; both gates were green on an empty page.

### Crash-check (run this alongside the gates)

The gates answer "does it match?", not "did it render?". A throwaway Playwright loop over every
story id × both themes, asserting the root has text and no error string, catches both traps
above in about a minute. Two real defects were found this way after the gates went green.

**A geometry lesson that recurred three times:** a diff in the 15–20% range was *never* colour,
always a dropped dimension — `CreateTestsetCard` (UA `<button>` font-size, 26px), `EmptyState`
(antd `Typography.Title`'s `margin-top: 1.33em`, 21px). Measure in the browser before writing a
"colour only" waiver; the first draft of both waivers was fiction.

## Appendix — re-measuring

```bash
cd web/packages/agenta-playground-ui/src
find . -name '*.tsx' | grep -vc '\.stories\.'          # total renderable-ish
grep -rl 'from "antd"' .                                # includes type-only imports
```

```bash
cd web/storybook && ls stories/playground-ui | wc -l    # stories written
grep -c 'agenta-playground-ui' parity/vrt.mjs           # ids gated
```

Run the three gates over every playground-ui id (Storybook must already be on :6006):

```bash
cd web/storybook && curl -s http://localhost:6006/index.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(Object.keys(j.entries).filter(i=>i.startsWith('agenta-playground-ui')&&!i.endsWith('--docs')).join(' '))})" > /tmp/ids.txt
```

```bash
cd web/storybook && node parity/render-check.mjs $(cat /tmp/ids.txt)
```

```bash
cd web/storybook && node parity/a11y.mjs $(cat /tmp/ids.txt)
```

```bash
cd web/storybook && VRT_OUT=__vrt_wave3__ node parity/vrt.mjs $(cat /tmp/ids.txt)
```

Two operational notes. **zsh does not word-split an unquoted `$VAR`** — use the
`$(cat …)` form above, not `$IDS`. And a **brand-new story file sometimes needs a second save**
before this dev server serves it (it appears in `index.json` while the preview bundle still
throws `Cannot find module`), so touch and re-run before believing a blank result.
