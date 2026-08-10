# Wave 3 (`@agenta/playground-ui`) — migration readiness findings

**Origin:** `scan-codebase` · **Lens:** verification · **Depth:** deep
**Scanned:** `web/packages/agenta-playground-ui`, cross-referenced against `web/storybook`,
`@agenta/ui`, `@agenta/entity-ui`
**Branch:** `code/storybook-migration-wave-3-118ca7` (base `main` @ `ecacb20d5f`)
**Scanned on:** 2026-08-06

## Sources

- [`antd-inventory/playground-ui.md`](../playground-ui.md) — the wave-3 guide (PR #5700)
- [`antd-inventory/STATUS.md`](../STATUS.md), [`entity-ui.md`](../entity-ui.md), [`GOTCHAS.md`](../GOTCHAS.md)
- `web/storybook/.storybook/{main.ts,preview.tsx,decorators/*}`, `web/storybook/parity/{vrt.mjs,a11y.mjs}`
- Package census re-measured on this tip (see Appendix)

## Summary

> ### ⚠️ Read this first: two timeframes live in this file
>
> This **Summary**, the **Component map**, the **Recommended sequencing** and the **Appendix
> census** are the *readiness scan taken on 2026-08-06, before any work started*. They are kept
> verbatim as the historical baseline — do not read them as the current state.
>
> **Current state (2026-08-07): wave 3 is finished.** antd 31 → **0** files (no imports, no
> types, no peer dependency); **82 story ids** covering all 49 renderable components.
> **Closed:** F1, F2, F3, F4, F9, F11, F13, F14, F19, F26, F27. Six of those (F1–F4, F9, F11)
> also had a stale `[OPEN]` heading in this section from the original scan; those headings are
> now `[CLOSED]` and the detailed record lives in the Closed Findings section below.
>
> **Still open:** F5, F6, F7, F8, F10, F12, F13b, F18, F20, F21, F22, F23, F24, F25, F28.
>
> Gate scope: `render-check` covers light **and** dark; `parity/a11y.mjs` is **light only**.

The guide is accurate on the parts it covers, and every headline number in it still holds
(78 files, 31 on antd, 0 stories). This scan re-measured those and then looked at what the
guide does **not** cover. It found three blockers that stop wave 3 before the first swap
(F1–F3), a dependency-order error in the guide's own parallelism advice (F4), and a harness
gap that would let the primary gate silently measure nothing on this package's single most
common antd surface (F5).

The distinguishing risk in wave 3 is **not** the antd swaps. It is that this package is the
first one in the programme whose antd usage reaches its **public type surface**, and the
first whose chunks have real **inter-chunk import dependencies**. Both are invisible at the
call site and neither is caught by any existing gate.

## Rules

- Severity: `P0` blocker · `P1` fix before rollout · `P2` bounded risk · `P3` hygiene.
- A finding is `confirmed` only where it was read directly out of current code on this tip.

## Notes

- **Waves 1 and 2 are merged to `main`.** Verified: 35 primitives in
  `web/packages/agenta-ui/src/components/ui/`, 436 gated story ids in `parity/vrt.mjs`,
  84 entity-ui stories. The guide's "base your branch on the wave-2 stack
  (#5643 → #5644 → #5694)" is now stale — see F1.
- **No package holds co-located stories.** `main.ts` globs
  `../../packages/*/src/**/*.stories.@(ts|tsx)`, but all 0 packages use it; every story
  lives under `web/storybook/stories/`. Wave 3 should follow that convention, which is
  what makes F2 a blocker.
- **The data seam is already built.** `withAgentaData.tsx` supplies `queries`, `atoms`,
  `reset`, `isolate` and a per-story `StoryScope` id namespace. Wave 3 needs no new
  harness machinery — only fixtures.

## Open Questions

1. Does wave 3's "zero `from "antd"`" definition of done include the two **type-only**
   imports on the public API (F3)? If yes, wave 3 is a cross-package change touching
   `web/oss`, not a package-local one, and needs its own PR lane.
2. Do the residual antd engines (`Table` in `@agenta/ui`, `Form` in `@agenta/entity-ui`)
   block any wave-3 chunk, or are they accepted as out-of-scope boundaries (F6, F7)?

---

## Findings, in original scan order

Status is per-heading. Entries marked `[CLOSED]` here were raised by the 2026-08-06 scan and
resolved during the work; their closure record is in [Closed Findings](#closed-findings) below.

### [CLOSED] F1 — Guide instructs contributors to branch off an already-merged stack

- **ID:** WAVE3-F1 · **Origin:** scan · **Severity:** P0 · **Confidence:** high
- **Status:** confirmed · **Category:** Correctness (docs)
- **Files:** `antd-inventory/playground-ui.md:17`
- **Summary:** The guide says "Base your branch on the wave-2 stack (#5643 → #5644 →
  #5694). The primitives, the story harness and the parity gates all live there." All
  three are on `main` as of this tip.
- **Evidence:** `web/packages/agenta-ui/src/components/ui/` holds 35 primitives;
  `web/storybook/parity/vrt.mjs` `DEFAULT_STORIES` holds 436 ids; `stories/entity-ui/`
  holds 84 stories — all present on `main` @ `ecacb20d5f`.
- **Impact:** A contributor following the guide literally branches off three merged PRs,
  or stalls looking for them.
- **Suggested Fix:** Replace the sentence with "branch off `main`; waves 1 and 2 are
  merged." Re-run the Appendix census in the same edit.

### [CLOSED] F2 — `@agenta/storybook` cannot import `@agenta/playground-ui`

- **ID:** WAVE3-F2 · **Origin:** scan · **Severity:** P0 · **Confidence:** high
- **Status:** confirmed · **Category:** Completeness (tooling)
- **Files:** `web/storybook/package.json:13-21`
- **Summary:** The Storybook workspace declares `@agenta/entities`, `@agenta/entity-ui`,
  `@agenta/oss`, `@agenta/shared`, `@agenta/ui` — but **not** `@agenta/playground-ui`.
  Under pnpm's isolated `node_modules`, no story in `web/storybook/stories/` can resolve
  the package.
- **Activation Condition:** First wave-3 story written in the conventional location.
- **Impact:** Blocks chunk 1 at its first import. The failure is a module-resolution
  error, so it is loud — but it will read as a broken environment rather than a missing
  one-line dep.
- **Suggested Fix:** Add `"@agenta/playground-ui": "workspace:*"` to
  `web/storybook/package.json` dependencies and `pnpm install`. Add it to the guide's
  setup section as step 0. No `main.ts` alias is needed — `@agenta/*` resolve to real
  `src/` paths already.

### [CLOSED] F3 — antd types leak through the package's public API; "zero antd" is a breaking change

- **ID:** WAVE3-F3 · **Origin:** scan · **Severity:** P0 · **Confidence:** high
- **Status:** needs-user-decision · **Category:** Migration / Compatibility
- **Files:**
  - `web/packages/agenta-playground-ui/src/context/PlaygroundUIContext.tsx:30,107`
  - `web/packages/agenta-playground-ui/src/components/TestsetSelectionModal/types.ts:8,55`
- **Summary:** Two antd imports are **type-only** and sit on the package's exported
  surface, not inside a component body:
  - `import type {ButtonProps} from "antd"` →
    `export interface CommitVariantChangesButtonProps extends ButtonProps`, reached through
    the exported `PlaygroundUIProviders` type.
  - `import type {ModalProps} from "antd"` →
    `export interface TestsetSelectionModalProps extends Omit<ModalProps, "onCancel">`.
- **Evidence:** 25 files under `web/oss/src` import `@agenta/playground-ui`. Direct
  consumers of the affected types include
  `web/oss/src/components/Playground/OSSPlaygroundShell.tsx:16`,
  `web/oss/src/components/Playground/Playground.tsx:132`,
  `web/oss/src/components/WorkflowRevisionDrawerWrapper/index.tsx:214,422` (both already
  casting through `as unknown as PlaygroundUIProviders`), and
  `web/oss/src/components/Playground/Components/TestsetDropdown/index.tsx:606,626`.
- **Impact:** The guide scopes wave 3 to the package and its stories. Satisfying its own
  DoD bullet ("Zero `from "antd"` … in the files you touched") on these two files changes
  the public prop contract and forces edits in `web/oss`. The two existing
  `as unknown as` casts mean the compiler will **not** reliably catch the fallout at those
  sites — the breakage surfaces at runtime as dropped props.
- **Suggested Fix:** Treat this as its own chunk, sequenced last, with an explicit
  `web/oss` blast-radius list. Replace `ButtonProps` with the `@agenta/ui` `Button` props
  type and `ModalProps` with the `Dialog`/`EnhancedModal` prop type. Remove the
  `as unknown as` casts in `WorkflowRevisionDrawerWrapper` as part of the same change so
  the type check becomes load-bearing again.
- **Alternatives:** Declare the two type-only imports out of scope for wave 3 and record
  them as a wave-4 item — but then say so in the DoD, because as written the DoD forbids
  them.

### [CLOSED] F4 — The guide's parallelism warning names the wrong chunks

- **ID:** WAVE3-F4 · **Origin:** scan · **Severity:** P1 · **Confidence:** high
- **Status:** confirmed · **Category:** Correctness (docs)
- **Files:** `antd-inventory/playground-ui.md:81-83`
- **Summary:** The guide warns "Chunks 4, 5 and 6 here share `ExecutionItems` helpers."
  The measured import graph says otherwise: **chunk 3** is a consumer of chunk 5, and
  **chunk 6 has zero `ExecutionItems` coupling.**
- **Evidence:** every cross-directory import of `ExecutionItems/assets/*` in the package:
  - `ExecutionItemComparisonView/GenerationComparisonCompletionOutput/index.tsx:15` →
    `../../ExecutionItems/assets/CompletionMode` *(chunk 3 → chunk 5)*
  - `ExecutionItemComparisonView/GenerationComparisonChatOutput/index.tsx:11,12` →
    `ChatTurnView`, `ExecutionRow` *(chunk 3 → chunk 5)*
  - `ExecutionResultView/index.tsx:11,12,13` → `RepetitionNavigation`,
    `ResultPlaceholder`, `TypingIndicator` *(chunk 4 → chunk 5)*
  - `ExecutionHeader/index.tsx:16` → `RunOptionsPopover`, **commented out** (dead import)
  - chunk 6 (`VariableCard`, `VariableControlAdapter`, `UnreferencedColumnsFooter`):
    no `ExecutionItems` import at all — its externals are `@agenta/ui` and
    `@agenta/entity-ui` only.
- **Impact:** Two ways to get burned. A team that parallelises 3 and 5 on the guide's
  advice collides. A team that serialises 6 behind 5 for nothing loses the one chunk that
  was safe to run concurrently.
- **Suggested Fix:** Correct the guide to: **chunk 5 is the shared dependency; chunks 3
  and 4 consume it.** Land chunk 5 first, or have one owner take 3+4+5. Chunk 6 is
  file-disjoint and may run in parallel with anything. Note that `RepetitionNavigation`
  and `TypingIndicator` are antd files **owned by chunk 5 but rendered by chunk 4**, so
  chunk 4's parity stories cannot be trusted until chunk 5's swaps land.

### [OPEN] F5 — VRT subject auto-detection misses `Typography` and `Upload`

- **ID:** WAVE3-F5 · **Origin:** scan · **Severity:** P1 · **Confidence:** high
- **Status:** confirmed · **Category:** Testing / Soundness
- **Files:** `web/storybook/parity/vrt.mjs:838` (the `SUBJECT` selector list)
- **Summary:** The auto-detect selector list enumerates `.ant-tag`, `.ant-select`,
  `.ant-alert`, `button`, `input`, … but contains **no `.ant-typography` and no
  `.ant-upload`**. Those are wave 3's most-used (`Typography`, 14 files) and
  least-supported (`Upload`, no primitive) antd surfaces.
- **Evidence:** grep of the `SUBJECT` string at `vrt.mjs:838` — `ant-typography`: 0
  occurrences in the list, `ant-upload`: 0 anywhere in the file. `vrt.mjs:908-913` then
  treats a cell with >1 candidate and no `data-vrt-subject` as **AMBIGUOUS SUBJECT**, and
  `vrt.mjs:1352` reports a story that matched nothing as "0 pairs measured".
- **Impact:** A `Typography` parity story written without an explicit `data-vrt-subject`
  either measures the wrong element or measures nothing — and "0 pairs" is exactly the
  failure mode the guide already flags as "the harness telling you the story is lying".
  Contributors will hit it on their most common component and read it as harness
  flakiness.
- **Suggested Fix:** Two parts. (a) Document in the guide: **every `Typography` and
  `Upload` row needs `data-vrt-subject` by hand.** (b) Consider adding
  `.ant-typography, [data-slot=text]` to the `SUBJECT` list — but only after checking it
  does not make existing rows ambiguous, since `.ant-typography` is applied to many
  wrapper elements.
- **Progress (2026-08-07):** (a) is done — the guide now has a
  "The VRT cannot see `Typography` or `Upload`" section. (b) is deliberately NOT done: the
  `SUBJECT` list is shared by all 436 gated ids and widening it risks turning existing
  passing rows ambiguous. Left open as a decision for the maintainer.
- **Related, found during the pilot — the same class of blind spot, different cause:**
  a parity row only means something relative to its crop. The first
  `TestsetSelectionPreview` story compared an 83px-wide antd cell against a 210px agenta
  cell (the panel is `flex-1` with no width, so each side sized to its own content) and
  the real `Input.Search` deviation measured **under 1% — a silent pass**. Pinning both
  cells to `w-[320px]` surfaced it at 1.06%/1.01%. **A sub-1% result is only evidence if
  the two cells are the same size.** Worth adding to GOTCHAS.md.

### [OPEN] F6 — A shipped `@agenta/ui` primitive still imports antd icons

- **ID:** WAVE3-F6 · **Origin:** scan · **Severity:** P1 · **Confidence:** high
- **Status:** confirmed · **Category:** Consistency
- **Files:** `web/packages/agenta-ui/src/components/ui/progress.tsx:3`
- **Summary:** `progress.tsx` — inside the `components/ui/` primitive layer — imports
  `CheckCircleFilled, CheckOutlined, CloseCircleFilled, CloseOutlined` from
  `@ant-design/icons`. STATUS.md records Progress as "✅ built … computed-verified 13/13"
  and the programme's stated rule is that the primitive layer is antd-free.
- **Evidence:** `@agenta/ui` has 14 files still importing antd. 13 are
  `InfiniteVirtualTable/**` (the deliberately-deferred Table engine, consistent with
  STATUS.md's "engines: Table/Form/Upload ⬜"). `progress.tsx` is the one that is not.
- **Impact:** Any wave-3 file that adopts the `Progress` primitive to get **off** antd
  transitively pulls `@ant-design/icons` back in. The package-level "zero antd" check a
  reviewer would run then reports a false positive on the primitive layer.
- **Suggested Fix:** Swap the four icons for their `@phosphor-icons/react` or
  `lucide-react` equivalents (both are already `@agenta/ui` deps) and re-run
  `progress--antd-vs-agenta`. Small, self-contained, and not wave-3-blocking — but it
  should not be discovered by a wave-3 contributor mid-chunk.

### [OPEN] F7 — antd `Form` boundary in `@agenta/entity-ui` sits adjacent to two wave-3 chunks

- **ID:** WAVE3-F7 · **Origin:** scan · **Severity:** P1 · **Confidence:** medium
- **Status:** open · **Category:** Migration
- **Files:**
  - `web/packages/agenta-entity-ui/src/gatewayTool/components/SchemaForm.tsx:30-31`
  - `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/subscription/SubscriptionForm.tsx:35`
- **Summary:** `@agenta/entity-ui` is antd-free except for antd `Form`/`FormInstance` in
  two files. The guide tells wave-3 contributors that entity-ui composites "are available
  to you" without noting that the Form engine among them is still antd.
- **Impact:** Chunk 6 (`VariableControlAdapter`, 576 lines) and
  `shared/EvaluatorFieldGrid` are form-control surfaces. A contributor who reaches for
  `SchemaForm` to replace an antd control lands back on antd `Form` and cannot reach zero
  without expanding scope into entity-ui.
- **Suggested Fix:** State the boundary explicitly in the guide: **antd `Form` is a
  deferred engine; do not try to cross it in wave 3.** If a chunk needs it, stop and file
  it rather than migrating entity-ui's Form as a side quest.
- **Confidence note:** `medium` — the two files are confirmed, but I did not trace whether
  any wave-3 chunk *must* route through `SchemaForm`. Worth confirming before chunk 6
  starts.

### [OPEN] F8 — `antd` stays in `peerDependencies` after migration unless the DoD says otherwise

- **ID:** WAVE3-F8 · **Origin:** scan · **Severity:** P2 · **Confidence:** high
- **Status:** confirmed · **Category:** Completeness
- **Files:** `web/packages/agenta-playground-ui/package.json` (`peerDependencies`)
- **Summary:** The package declares `"antd": ">=5.0.0"` and
  `"@ant-design/icons": ">=5.0.0"` as peers. The guide's DoD covers source imports only.
- **Impact:** Wave 3 could reach zero antd imports and still ship a package that
  contractually requires antd, leaving the dependency graph unchanged and the next
  reader unsure whether the migration completed.
- **Suggested Fix:** Add to the DoD: "the final chunk drops `antd` and
  `@ant-design/icons` from `peerDependencies`, and `pnpm --filter @agenta/playground-ui
  exec tsc --noEmit` still passes." Note this is only safe once F3 is resolved — the
  type-only imports need the peer dep to type-check.

### [CLOSED] F9 — Ten `type="secondary"` sites: the documented token trap, now located

- **ID:** WAVE3-F9 · **Origin:** scan · **Severity:** P2 · **Confidence:** high
- **Status:** open · **Category:** Correctness
- **Summary:** The guide warns that `Typography.Text type="secondary"` maps to
  `colorTextDescription`, not `colorTextSecondary` (26 sites were wrong in waves 1–2, and
  the pixel gate could not see it). This package's exposure is now measured: **18
  `Typography.Text` uses, 10 carrying `type="secondary"`, 3 `strong`, 2 `type="warning"`.**
- **Impact:** Ten silent-failure sites, invisible to VRT per F5 unless subjects are marked.
- **Suggested Fix:** Put the count in the guide so a reviewer can check the arithmetic:
  after migration, `grep -rc 'colorTextDescription'` across the touched files should
  account for all ten. `type="warning"` (2 sites) maps to `colorWarning` — confirm rather
  than assume, since it is a different token family.

### [OPEN] F10 — Four overlay surfaces need forced-open parity stories

- **ID:** WAVE3-F10 · **Origin:** scan · **Severity:** P2 · **Confidence:** high
- **Status:** open · **Category:** Testing
- **Files:**
  - `ExecutionItems/assets/ChatTurnView/index.tsx` (antd `Popover`)
  - `ExecutionItems/assets/RunOptionsPopover/index.tsx` (antd `Popover`)
  - `WorkflowRevisionDrawer/WorkflowRevisionDrawer.tsx` (antd `Drawer` → `Sheet`)
  - `TurnMessageHeaderOptions/index.tsx` + `ExecutionItems/GatewayToolExecuteButton.tsx`
    (antd `Dropdown`)
- **Summary:** `vrt.mjs:13,859` gates overlays through a `[data-open-compare]` story
  because a closed trigger pairs two buttons, not two panels. `DEFAULT_STORIES` excludes
  `--antd-vs-agenta` for exactly this class of component.
- **Impact:** Without the forced-open story these four migrate with their panel chrome
  ungated — which is where radius, shadow and background diverge most.
- **Suggested Fix:** Copy the pattern from `stories/Dialog.stories.tsx`,
  `AlertDialog.stories.tsx` or `EnhancedModal.stories.tsx`. Register the `--open-state`
  ids in `DEFAULT_STORIES`.

### [CLOSED] F11 — No test or story baseline exists for this package

- **ID:** WAVE3-F11 · **Origin:** scan · **Severity:** P2 · **Confidence:** high
- **Status:** open · **Category:** Testing
- **Files:** `web/packages/agenta-playground-ui/` (no `tests/`, no `vitest.config.ts`)
- **Summary:** The package has **0 stories and 0 unit tests**. By comparison
  `@agenta/entity-ui` ships `tests/` with 19 test files and a `vitest.config.ts`.
- **Impact:** Every wave-3 gate (VRT, a11y) is story-derived, so before the first story
  exists there is no regression signal whatsoever for an 8,000-line package that the
  playground renders on every run. Behaviour changes — a dropped `onChange`, a `Switch`
  whose `onCheckedChange` was not rewired — are caught by nothing.
- **Suggested Fix:** This is inferred from file layout, **not** from a test run — hand to
  `test-codebase` to confirm what `pnpm --filter @agenta/playground-ui exec tsc --noEmit`
  and the existing suites actually report today. Consider requiring one behavioural test
  per chunk for the interactive components (`VariableCard`, `VariableControlAdapter`,
  `RunOptionsPopover`), since VRT proves pixels and proves nothing about handlers.

### [OPEN] F12 — `SingleLayout.tsx` is an outlier and should not be one chunk

- **ID:** WAVE3-F12 · **Origin:** scan · **Severity:** P3 · **Confidence:** high
- **Status:** open · **Category:** Migration
- **Files:** `web/packages/agenta-playground-ui/src/components/ExecutionItems/assets/ExecutionRow/SingleLayout.tsx`
- **Summary:** 1,084 lines, **24 atom hooks**, 4 `PlaygroundUIContext` reads, 1
  `atomFamily`, 3 distinct antd `Tag` call sites (`StepTag` at :172, plus :398 and :780),
  and a provider-injected `renderSyncStateTag` slot at :606. It is simultaneously the
  largest file, the most atom-coupled, and the most context-coupled in the package.
- **Impact:** The guide files it inside chunk 5 with a parenthetical "sub-chunk it if it
  fights you". On these numbers it will.
- **Suggested Fix:** Pre-declare the split: the three `Tag` sites are independent swaps,
  and `StepTag` is an extractable presentational component that can be storied on its own
  before any of the atom-coupled surface is touched.

### [CLOSED] F14 — Radix `Tooltip` crashed every migrated call site; both gates stayed green

- **ID:** WAVE3-F14 · **Origin:** scan (found in the dark-mode pass) · **Severity:** P0
- **Status:** fixed · **Confidence:** high · **Category:** Correctness
- **Summary:** antd's `Tooltip` needs no provider; Radix's throws
  `` `Tooltip` must be used within `TooltipProvider` ``. Every component wave 3 moved to the
  Radix Tooltip (`VariableCard`, `VariableControlAdapter`, `ExecutionHeader`,
  `TurnMessageHeaderOptions`, `ChatTurnView`) therefore crashed on render.
- **Why both gates missed it — this is the important part.** A crashed story renders Storybook's
  error overlay. The VRT finds no `data-vrt-subject` pair in it and reports the story as "no
  antd pair by design" (it was in `NO_PAIR_EXPECTED`); axe audits the overlay as **one clean
  root** and passes. `tsc` is clean because the error is a runtime context check. So VRT PASS +
  a11y PASS + tsc clean, on a component that renders nothing but a stack trace. **Only opening
  the story in a browser caught it.**
- **Fix:** `Tooltip` now self-provides (`components/ui/tooltip.tsx`), matching current shadcn —
  one change instead of five call-site wrappers, and it forecloses the whole class. Nesting is
  harmless: an outer `TooltipProvider` still wins for shared delay/skip state, so wave 2's
  per-cluster providers in entity-ui keep working.
- **Follow-on it exposed:** with the stories finally rendering, axe immediately found a
  **critical `button-name`** on `VariableCard`'s boolean branch — the `Switch` had no accessible
  name (antd's was unnamed too). Fixed by threading the variable `name` into `CardBody` and
  passing it as `aria-label`.
- **Process change:** added a crash-check (every story id × both themes, assert the root has
  text and no error string) to `storybook-map.md`. It found a second defect the same run —
  `ToolCallView` rendering `null` on a wrong-shaped `resultData`, also green on both gates.

### [OPEN] F13b — the sibling status backgrounds have the same latent bug

- **ID:** WAVE3-F13b · **Origin:** scan · **Severity:** P3 · **Confidence:** high
- **Status:** open · **Category:** Consistency
- **Files:** `web/packages/agenta-ui/src/utils/styles.ts` — `successBg: "bg-green-1"`,
  `errorBg: "bg-red-1"`, `infoBg: "bg-zinc-1"`
- **Summary:** F13 is fixed for `warningBg`, but its three siblings are still raw scale values
  frozen at their light hues. They are **latent, not live**: all three have zero consumers
  repo-wide today, so nothing renders wrong right now.
- **Suggested Fix:** `--ag-colorSuccessBg` and `--ag-colorErrorBg` already exist in
  `theme-variables.css` (the generator emits them), so those two need only a `shadcnTokens`
  bridge entry each, exactly as `colorWarningBg` did. `infoBg` → `colorInfoBg` is already
  bridged and can be repointed immediately. Left undone deliberately: with no consumer and no
  story, the change is unverifiable, and the next person to use one of these should do it with
  a rendering to check against.

### [OPEN] F18 — Author labels render blank in Storybook; the fix breaks the preview bundle

- **ID:** WAVE3-F18 · **Origin:** scan (story-coverage backfill) · **Severity:** P3
- **Status:** open · **Confidence:** high · **Category:** Test coverage
- **Files:** `web/storybook/.storybook/decorators/AgentaProviders.tsx`,
  `web/packages/agenta-entities/src/shared/user/atoms.ts`
- **Summary:** `UserAuthorLabel` resolves a user id through `atomConfig`, which the APP sets at
  module scope (`oss/src/components/AppGlobalWrappers/index.tsx` calls `setUserAtoms`). The
  harness never imports that file, so `atomConfig` stays `null` and every author label renders
  **blank** — silently, with no warning and no failing gate. Surfaced as an empty "Created by"
  field in `MetadataSidebar`.
- **Why it is not simply fixed:** calling `setUserAtoms` from the decorator requires importing
  `@agenta/oss/src/state/workspace/atoms/selectors`, which pulls the OSS org-state graph into the
  preview bundle and throws `Cannot access 'cacheWorkspaceOrgPair' before initialization` during
  module init — taking down **every** story, not just the ones with author labels. Attempted and
  reverted; the attempt and its failure are recorded in a comment at the decorator.
- **Suggested Fix:** break the initialisation cycle in the OSS org state, or expose a leaf-level
  members atom with no org-graph dependency that the harness can import safely.

### [CLOSED] F19 — `EnhancedDrawer` left the Radix dialog unnamed when it rendered no header

- **ID:** WAVE3-F19 · **Origin:** scan (a11y gate on the new drawer stories) · **Severity:** P2
- **Status:** fixed · **Confidence:** high · **Category:** Accessibility
- **Files:** `web/packages/agenta-ui/src/drawer/EnhancedDrawer.tsx`,
  `web/packages/agenta-playground-ui/src/components/WorkflowRevisionDrawer/WorkflowRevisionDrawer.tsx`
- **Summary:** with `closable={false}` and no `title`/`extra`, `EnhancedDrawer` rendered no
  `SheetHeader` and therefore no `SheetTitle`. Radix still renders `role="dialog"`, so axe
  reported **serious `aria-dialog-name`** on every drawer in that shape.
  `WorkflowRevisionDrawer` is exactly that shape, so all four of its states failed. antd's
  `Drawer` had no equivalent requirement, which is why the migration did not surface it —
  and why it went unnoticed: the package had no story for this drawer until now.
- **Fix:** `EnhancedDrawer` now emits an `sr-only` `SheetTitle` when there is no visible header,
  named by a new `ariaLabel` prop (fallback `"Drawer"`). `WorkflowRevisionDrawer` passes
  `"Evaluator"` / `"Workflow revision"` by context. a11y green on all seven drawer stories, and
  `enhanced-drawer--open-state` (the primitive's own parity story) still passes unchanged.
- **Scope beyond this package:** the guard is in the primitive, so any other caller using
  `closable={false}` without a title is fixed by the same change.

### [OPEN] F20 — Dark-mode `AbortError` on VariableCard's non-string branches

- **ID:** WAVE3-F20 · **Origin:** scan (render-check) · **Severity:** P3
- **Status:** open · **Confidence:** medium · **Category:** Performance
- **Files:** `web/packages/agenta-playground-ui/src/components/PlaygroundInputsBody/VariableCard.tsx`
- **Summary:** stories rendering a `VariableCard` whose value is **not a string** (the
  object/number branches, which lazy-load their view) emit an uncaught
  `AbortError: The user aborted a request.` in **dark only**. The theme decorator remounts once
  to apply the antd dark algorithm, cancelling the in-flight chunk fetch. String-only stories
  (`variablecard--header-states`) are clean.
- **Evidence it is cosmetic:** no stack, no failed network request, and the rendered text is
  byte-identical in both themes (537 chars either way for `inputs-bodyparts--body`).
- **Handling:** ignored by pattern in `parity/render-check.mjs` with this reasoning inline.
  Narrow the pattern if a real abort ever needs to fail the gate.

### [OPEN] F21 — `VariableCard`'s read-only body renders the value as placeholder text

- **ID:** WAVE3-F21 · **Origin:** scan (dark-mode eyeball of `inputs-bodyparts--body`)
- **Severity:** P3 · **Status:** open · **Confidence:** medium · **Category:** Functionality
- **Files:** `web/packages/agenta-playground-ui/src/components/PlaygroundInputsBody/VariableCard.tsx`
- **Summary:** with `editable={false}` the card renders its value inside a disabled input at
  placeholder contrast, so a real value reads as an empty field with hint text. Visible in the
  "read-only" row of `agenta-playground-ui-inputs-bodyparts--body`, both themes, worse in dark.
- **Not caused by wave 3** — the same rendering predates the migration. Raised because the new
  story is the first thing to show it side by side with the editable cards. Fixing it is a
  design call (render read-only values as plain text vs. a disabled control), not a migration
  fix, so it is left open.

### [OPEN] F22 — Comparison columns fall back to a revision's `name`, which `AGENTS.md` forbids

- **ID:** WAVE3-F22 · **Origin:** scan (story-coverage backfill) · **Severity:** P2
- **Status:** open · **Confidence:** high · **Category:** Correctness
- **Files:**
  - `…/ExecutionItemComparisonView/assets/GenerationComparisonOutputHeader/index.tsx:35`
  - `…/ExecutionItems/assets/ExecutionRow/shared.tsx:33` (`usePlaygroundNodeLabels`), consumed by
    `GenerationComparisonCompletionOutput`'s `primaryNodeLabel`
- **Summary:** `web/AGENTS.md` states plainly that `revision.name` is dead for display and calls
  any `.name` read off a revision entity used as a label a **review blocker** — UI-created
  revisions carry the variant name (`"default"`) and SDK-created ones carry no name at all.
  Both sites do exactly that:
  - The header renders `variantLabel ?? data?.name`. Its comment says the fallback is "only a
    fallback for drafts the variants list does not know yet", but **nothing gates that branch on
    draft-ness** — `isLocalDraftId(entityId)` gates only the *version* badge on line 26. Any
    revision whose variant fails to resolve (no `workflow_variant_id`, unmatched variant) shows
    the revision's `name` instead.
  - `usePlaygroundNodeLabels` prefers `workflowMolecule.selectors.data(node.entityId)?.name` over
    `PlaygroundNode.label` for non-evaluator nodes, so a node labelled `classify` in the
    playground graph displays as `default`. Reproduced in the `CompletionOutput` story.
- **Not a wave-3 regression.** This file's only antd was a `Tag`; the label logic is untouched by
  the migration. It surfaced because these components had no story until now, and the story had
  to seed a revision to render — which forced the question of which field is the label.
- **Suggested Fix:** route both through the sanctioned selectors (`artifactName` for
  evaluators/entities, the variants list for variant labels) and drop the `revision.name`
  fallbacks. Deliberately not done here: it is a display-semantics change with reach beyond this
  package, and the story-coverage backfill is the wrong change to bundle it into.

### [OPEN] F23 — A malformed result `output` renders a blank card, not a placeholder or an error

- **ID:** WAVE3-F23 · **Origin:** scan (building the loadable fixture seam) · **Severity:** P2
- **Status:** open · **Confidence:** high · **Category:** Correctness
- **Files:** `…/ExecutionResultView/index.tsx` → `deriveToolViewModelFromResult`
- **Summary:** the view model reads `result.response.data`. Any `output` that is not
  `{response: {data: …}}` — a bare string, a legacy shape, a drifted one — yields
  `displayValue: ""`, and `ResponseContent` renders an empty editor. Because `currentResult` is
  still truthy the "No output yet" placeholder is skipped, so the user sees a **blank output
  card**: not the placeholder, not an error, no signal at all that the shape was wrong.
- **How it surfaced:** it cost a debugging cycle while building `seedPlaygroundLoadable` — the
  fixture looked correct and the row rendered, just with nothing in it. The helper now wraps
  `output` for callers, which hides the problem in stories but not in the app.
- **Suggested Fix:** fall through to the placeholder (or an explicit "unrecognised result shape"
  state) when the derived `displayValue` is empty but a result exists.

### [OPEN] F24 — `SingleLayout` splits busy state between a prop and the store

- **ID:** WAVE3-F24 · **Origin:** scan · **Severity:** P3 · **Confidence:** high
- **Status:** open · **Category:** Consistency
- **Files:** `…/ExecutionItems/assets/ExecutionRow/SingleLayout.tsx:822`
- **Summary:** the output card derives its busy state from the `isBusy` **prop**
  (`primaryNodeStatus`, `ExecutionResultView isRunning`), while the run control reads
  `chainStatus.isBusy` from the execution store. A caller passing `isBusy` without a matching
  seeded run gets "Generating response…" beside an **enabled Run button**.
- **Latent, not live:** unreachable through `ExecutionRow`, which derives both from the same
  store. Recorded because it is a real prop/store contract split in the largest file in the
  package (1,084 lines), and the new stories are the first thing able to drive the two
  independently.

### [OPEN] F25 — Two structural smells in the playground execution selectors

- **ID:** WAVE3-F25 · **Origin:** scan · **Severity:** P3 · **Confidence:** medium
- **Status:** open · **Category:** Soundness
- **Files:** `web/packages/agenta-playground/src/state/execution/selectors.ts:966` and `:145`
- **Summary:** two things noticed while seeding the graph, neither currently breaking:
  - `generationRowIdsAtom` **writes during a read** — in chat mode with no messages it calls
    `playgroundStoreAtom.set(addUserMessageAtom, …)` inside a derived atom's read function. It
    works, but a side-effecting derived read is fragile under concurrent rendering, and it made
    the empty-chat bootstrap behaviour hard to reason about.
  - `derivedLoadableIdAtom` keeps mutable module state outside the store
    (`_loadableAnchorEntityId`). It self-corrects when the anchor leaves `playgroundNodesAtom`,
    so story switching is safe — but it is per-module, not per-store, so two Jotai stores on one
    page would contend for it.

### [CLOSED] F26 — Icon-only `EnhancedButton`s had no accessible name (35 critical nodes)

- **ID:** WAVE3-F26 · **Origin:** scan (a11y gate on the composite stories) · **Severity:** P2
- **Status:** fixed · **Confidence:** high · **Category:** Accessibility
- **Files:** `web/packages/agenta-ui/src/components/presentational/EnhancedButton.tsx`
- **Summary:** `<EnhancedButton icon={…} tooltipProps={{title: "Remove"}} />` — the standard shape
  for row actions — rendered a button with no text, no `aria-label`, and a Radix tooltip that
  does not name its trigger. axe reported **critical `button-name`** on 35 nodes across the new
  execution stories (`SingleLayout`'s `RowHeaderActions` is three per row).
- **Fix:** when the button has an icon and no label/children, a **string** tooltip title is
  borrowed as `aria-label`. An explicit `aria-label` still wins (it is spread after). One change
  in the primitive cleared all 35, and it covers every other icon-only tooltip button repo-wide.

### [CLOSED] F27 — `VariableControlAdapter`'s boolean `Switch` was unnamed

- **ID:** WAVE3-F27 · **Origin:** scan · **Severity:** P2 · **Confidence:** high
- **Status:** fixed · **Category:** Accessibility
- **Files:** `…/components/adapters/VariableControlAdapter.tsx`
- **Summary:** the exact defect fixed in `VariableCard`'s boolean branch during the migration
  (the F14 follow-on), in its sibling adapter — which never got the same treatment. The header
  carries the visible name and `hideLabel` drops even that, so the control was unnamed: critical
  `button-name`. **This is the argument for per-component stories**: the two components were
  migrated together, one was storied and got fixed, the other was not and stayed broken.
- **Fix:** `aria-label={name}` on the `Switch`.

### [OPEN] F28 — `SharedEditor`'s error state uses the raw CSS keyword `red`

- **ID:** WAVE3-F28 · **Origin:** scan · **Severity:** P3 · **Confidence:** high
- **Status:** open · **Category:** Consistency
- **Files:** `web/packages/agenta-ui/src/SharedEditor/SharedEditorImpl.tsx:431`
- **Summary:** the error branch applies
  `!text-[red] [&_.message-user-select]:text-[red]`, i.e. `#ff0000`. Two problems: it measures
  **3.99:1 on white** and **3.69:1 on `#f5f6f6`** (both sub-AA), and being a raw CSS keyword it
  is identical in dark mode, where the palette would otherwise lighten an error colour. `web/AGENTS.md`
  requires colours be consumed as semantic tokens, not raw values.
- **Suggested Fix:** `text-colorError`, which is theme-aware and already AA-tuned. One line.
- **Not done here:** it restyles every error editor across the app, which is a wider blast radius
  than a story-coverage change should carry. Waived in `parity/a11y.mjs` **with the measured
  ratios inline** so the waiver is not fiction, and recorded here for a deliberate follow-up.

### [CLOSED] F3 — antd types on the public API (Phase 3, now done)

- **ID:** WAVE3-F3 · **Status:** fixed · **Confidence:** high · **Category:** Compatibility
- **Files:** `context/PlaygroundUIContext.tsx`, `components/TestsetSelectionModal/types.ts`,
  `package.json`
- **Summary:** the last two antd references were `import type` only —
  `ButtonProps` on `CommitVariantChangesButtonProps` and `ModalProps` on
  `TestsetSelectionModalProps`. They shipped no antd code, but they kept `antd` and
  `@ant-design/icons` in `peerDependencies` and made "zero antd" untrue.
- **The fix was smaller than the original estimate.** F3 assumed removing them was a breaking
  change rippling into ~25 `web/oss` consumers. It is not: this repo had already solved the
  identical problem three times, and the pattern is documented in the code —
  `EnhancedModal.tsx:27` ("carries 0 antd runtime AND 0 antd type dependency; the shapes below
  reproduce the antd `ModalProps` fields the ~80 call-sites pass **so they move off antd with no
  call-site changes**"), plus `EnhancedDrawer.tsx:79` and `EnhancedButton.tsx:39`.
- **What was done:** rather than write a fourth copy of those shapes, both now import the ones
  `@agenta/ui` already exports — `EnhancedButtonProps` (`@agenta/ui/components/presentational`)
  and `EnhancedModalProps` (`@agenta/ui/components/modal`). `EnhancedModalProps` is in fact the
  *more* accurate type: `TestsetSelectionModal` spreads its leftover props straight into
  `EnhancedModal`, so antd's `ModalProps` had been describing the wrong target all along.
- **Then** `antd` and `@ant-design/icons` were dropped from `peerDependencies`.
- **Verified:** `tsc` 0 errors in `@agenta/playground-ui`, **`@agenta/oss`, `@agenta/ee`** and
  storybook (bar the pre-existing `ClaudePermissionsControl` failure); **no call site changed**,
  exactly as the pattern promises. lint 12/12. All 82 stories still render in both themes, a11y
  and VRT green.
- **Result: `@agenta/playground-ui` is the first genuinely antd-free UI package in the repo** —
  0 imports, 0 types, 0 peer dependency.

### [CLOSED] F29 — `mask={false}` rendered a click-swallowing overlay (antd parity break)

- **ID:** WAVE3-F29 · **Origin:** CodeRabbit review, PR #5806 · **Severity:** P1
- **Status:** fixed · **Confidence:** high · **Category:** Correctness (regression)
- **Files:** `agenta-ui/src/components/ui/sheet.tsx`, `agenta-ui/src/drawer/EnhancedDrawer.tsx`,
  `playground-ui/src/components/WorkflowRevisionDrawer/WorkflowRevisionDrawer.tsx`
- **Summary:** the migration mapped antd's `mask={false}` to a **transparent** Radix overlay,
  with a code comment claiming "Same look, and the behaviour Radix depends on stays intact."
  That was wrong. antd's `mask={false}` renders **no mask element**; the transparent overlay is
  still `fixed inset-0` and captures every click. On top of that, Radix `Dialog` defaults to
  `modal={true}`, which pins `pointer-events: none` on `<body>`.
- **Impact:** `WorkflowRevisionDrawer`'s document click handler matches on `event.target`, which
  became the overlay for every outside click — so `.variant-table-row`, `.ant-drawer`,
  `.ant-popover` and `.ant-modal-root` never matched. Clicking another variant row behind the
  open drawer used to swap the drawer's content; instead the overlay ate the click.
- **Fix:** `SheetContent` gained `maskless`, which omits the overlay entirely, and
  `EnhancedDrawer` passes `modal={!maskless}` so Radix stops disabling body pointer events.
  Outside-click still closes via `DismissableLayer` (a document listener, not the overlay).
  Also: `maskClosable` means "clicking the MASK closes" — with no mask there is nothing to
  click, so the maskless path now `preventDefault()`s the Radix outside handlers and leaves
  closing to the caller's own logic, exactly as antd did.
- **Lesson:** "Radix always renders an overlay, so map `false` to transparent" was a plausible
  and wrong equivalence. A prop that removes an element is not the same as one that hides it.

### [OPEN] F30 — Gateway tool executions share one loading slot and can collide

- **ID:** WAVE3-F30 · **Origin:** CodeRabbit review, PR #5806 · **Severity:** P3
- **Status:** open · **Confidence:** high · **Category:** Correctness
- **Files:** `playground-ui/src/components/ExecutionItems/GatewayToolExecuteButton.tsx:75,84`
- **Summary:** `callId` is optional, so `key={p.callId || p.name}` yields duplicate React keys
  for two same-named payloads, and `executingId` is a single string slot — when two executions
  overlap, the first one's `finally` clears the second's loading state.
- **Not a wave-3 regression:** identical code on `main` @ `ecacb20d5f` (same `key`, same single
  slot). Left out of the migration PR deliberately.
- **Suggested Fix:** mint a stable per-payload id and track active ids in a `Set`.

### [OPEN] F31 — `ChatTurnView`'s tooltip trigger is not keyboard reachable

- **ID:** WAVE3-F31 · **Origin:** CodeRabbit review, PR #5806 · **Severity:** P3
- **Status:** open · **Confidence:** high · **Category:** Accessibility
- **Files:** `playground-ui/src/components/ExecutionItems/assets/ChatTurnView/index.tsx:145`
- **Summary:** `TooltipTrigger asChild` wraps a `Badge`, which renders a `<span>`. A span is not
  focusable, so keyboard users can never open the tooltip and never see the node status detail.
- **Not a wave-3 regression:** the pre-migration antd `Popover trigger="hover"` wrapped an antd
  `Tag`, also a span, with the same gap. Note axe does **not** flag this, so the a11y gate is
  green either way.
- **Suggested Fix:** `tabIndex={0}` plus a visible focus style on the trigger; if
  `popoverContent` ever becomes interactive, switch to `Popover`.

### [OPEN] F32 — Raw `rgba(255,255,255,0.4)` divider on the run-options button

- **ID:** WAVE3-F32 · **Origin:** CodeRabbit review, PR #5806 · **Severity:** P3
- **Status:** open · **Confidence:** high · **Category:** Consistency
- **Files:** `playground-ui/src/components/ExecutionItems/assets/RunOptionsPopover/index.tsx:74`
- **Summary:** the split-button divider uses a raw rgba literal, which `web/AGENTS.md` forbids in
  favour of semantic tokens.
- **Two corrections to the review's reasoning**, both verified: it is **pre-existing** (the antd
  version carried the identical value as an inline `borderLeft` style), and the stated cause —
  "does not adapt to the light theme" — is wrong. The divider sits on a **primary** button, which
  is dark navy in both themes, so white-at-40% is correct in both. It is a token-hygiene issue,
  not a theming bug.
- **Suggested Fix:** add an on-primary divider token rather than changing the rendered colour.

---

## Closed Findings

> Closed during the chunk-1 pilot (2026-08-07). Working tree only — nothing committed.

### [CLOSED] F13 — `statusColors.warningBg` rendered a light banner in dark mode

- **ID:** WAVE3-F13 · **Origin:** scan (found during the chunk-1 dark pass) · **Severity:** P2
- **Status:** fixed · **Confidence:** high · **Category:** Correctness
- **Files:**
  - `web/packages/agenta-ui/src/utils/styles.ts:233` — `warningBg: "bg-gold-1"`
  - `web/packages/agenta-playground-ui/src/components/TestsetSelectionModal/components/SelectionSummary.tsx:35,77`
    (the only two consumers repo-wide)
- **Summary:** The warning/disabled banner renders as a cream box in dark mode — a light-mode
  island in a dark UI. `statusColors.warningBg` is `bg-gold-1`, a raw scale value pinned at its
  light hue.
- **Evidence:** Screenshot of `selectionsummary--antd-vs-agenta` at `globals=theme:dark`: both
  the `warning` and `disabled` rows show `#fffbe6`-ish banners against the dark surface.
  `palette.ts:100` **already defines** the correct pair —
  `warningBg: {light: "#fffbe6", dark: "#2b2111"}` (antd's own value) — but `colorWarningBg` was
  never added to the `shadcnTokens` bridge in `oss/tailwind.config.ts` (grep count: 0), so there
  is no `bg-colorWarningBg` class to use. *(This paragraph's original claim that
  `colorSuccessBg`/`colorErrorBg` "were bridged" was wrong — see the corrections below.)*
- **Why the gate is silent:** this is **not** a migration regression — the antd half renders the
  identical cream box, because both halves route through the same `@agenta/ui/styles` helper.
  The VRT diffs antd-vs-agenta, so **any defect present on both sides passes by construction.**
  That is the structural limit of the primary gate, and it is worth stating in GOTCHAS.md: the
  VRT proves *parity*, not *correctness*. Only a human looking at dark caught this.
- **Fix applied (2026-08-07) — two lines, no regeneration:**
  1. `web/oss/tailwind.config.ts` — added `colorWarningBg: v("colorWarningBg")` to `shadcnTokens`.
  2. `web/packages/agenta-ui/src/utils/styles.ts` — `warningBg: "bg-gold-1"` → `"bg-colorWarningBg"`.

- **Two corrections to this finding's original diagnosis.** Both were stated with more
  confidence than the evidence supported, and checking them changed the fix:
  - **`colorWarningBg` was already a generator CORE row** (`scripts/generate-tailwind-tokens.ts`
    line 165), and `--ag-colorWarningBg` was already in `theme-variables.css` with both values
    (`#fffbe6` / `#2b2111`). The generator was never the gap — only the Tailwind bridge was. So
    **no `pnpm generate:tailwind-tokens` run was needed**, and the
    `antd-overrides.generated.ts` invariant was never at risk. Verified: `git status` shows zero
    churn in either generated file.
  - **`colorSuccessBg`/`colorErrorBg` were NOT "already bridged."** STATUS.md records generator
    CORE rows for them, which is a different layer; neither is in `shadcnTokens` either. See
    F13b above.
- **Verification:** light is bit-for-bit unchanged — `rgb(255,251,230)`, exactly what
  `bg-gold-1` produced. Dark now resolves to `rgb(43,33,17)` (`#2b2111`) across all 4 banner
  instances instead of the frozen cream. VRT still PASS (26 comparisons, same 5 declared
  diffs, no new ones), a11y still PASS, `tsc` clean on both `@agenta/ui` and
  `@agenta/playground-ui`, `pnpm lint-fix` 12/12.
- **Note:** because `statusColors` is shared, the fix corrects the **antd half too** — which is
  precisely why the VRT was blind to it and stays blind after the fix. The structural point in
  "Why the gate is silent" above still stands and still belongs in GOTCHAS.md.

### [CLOSED] F11 — No test or story baseline existed for this package

**Status:** partially fixed. Six stories now exist where there were zero: three parity stories
and three data-seam showcases (`LoadModeContent` loading / empty / populated), all registered in
`vrt.mjs`. Two things the pilot established that the rest of wave 3 inherits, both now in the
guide:

- **Finding fixtures is mechanical, not archaeological.** `withAgentaData` logs every query key
  that tries to fetch, so the loop is render → read console → add key → repeat. It cannot drift
  from the source, because the source emits the warning. Caveat: queries gated on
  `!cachedData` never warn — a table rendering the right number of *empty* rows means the
  entity layer (`["testcase", projectId, id]`) is unseeded, not the page layer.
- **`session: false` belongs on almost every data-seam story.** A per-query
  `refetchOnMount: "always"` beats the harness client's `refetchOnMount: false`, so a seeded
  key can still refetch, fail against the real API, and replace the fixture with an error.
  Closing the auth gate disables the query while TanStack keeps serving the cache.

Still open: the package has no unit tests, and the gates remain visual-only. VRT proves pixels,
a11y proves the accessibility tree; **neither proves a handler still fires.**

### [CLOSED] F1 — Guide instructed contributors to branch off an already-merged stack

**Status:** fixed. `playground-ui.md` now says branch off `main` and notes the three PRs landed.

### [CLOSED] F2 — `@agenta/storybook` could not import `@agenta/playground-ui`

**Status:** fixed, and it was **two** wirings, not one:

- `web/storybook/package.json` — added `"@agenta/playground-ui": "workspace:*"`.
- `web/storybook/next.config.mjs` — added `@agenta/playground-ui` **and** `@agenta/playground`
  to `transpilePackages`. This was not in the original scan. The packages are source-only TS,
  so webpack fails on the raw TS without it — but `tsc` passes either way (`moduleResolution:
  bundler` reads the source directly), which makes it invisible until a story actually loads.
  Both are now documented in the guide's setup section.

### [CLOSED] F4 — Guide's parallelism warning named the wrong chunks

**Status:** fixed. The guide now states chunk 5 is the shared dependency with chunks 3 and 4
consuming it, lists the exact imports, flags that `RepetitionNavigation`/`TypingIndicator` are
chunk-5 files rendered by chunk 4, and notes chunk 6 is disjoint.

### [CLOSED] F9 — The `type="secondary"` token trap

**Status:** fixed for chunk 1, documented for the rest. Verified against antd 6.3.7's own
`lib/typography/style/index.js` rather than assumed, which corrected a second token in the
process: **`type="warning"` maps to `colorWarningText`, not `colorWarning`.** Confirmed
in-browser in dark: warning `rgb(216,150,20)` and secondary `rgba(255,255,255,0.45)` are
identical on both halves. The guide now carries the counts (10 secondary, 2 warning, 3 strong)
and the warning-token caveat.

---

## Component map — all 31 antd files, by chunk and risk

Risk is driven by: antd surface breadth · atom-hook count · `PlaygroundUIContext` reads ·
overlay (needs forced-open story) · cross-chunk consumption · public-API exposure.

### Chunk 1 — `TestsetSelectionModal/` (best first chunk)

| file | LOC | antd | atoms | risk | why |
| --- | --: | --- | --: | --- | --- |
| `components/CreateTestsetCard.tsx` | 49 | `Upload`, `Button`, `Typography`, `InboxOutlined` | 0 | **HIGH** | no `Upload` primitive; follow `SkillUploadZone`; VRT has no `.ant-upload` subject (F5) |
| `types.ts` | 241 | `ModalProps` *(type)* | 0 | **HIGH** | public API break (F3) |
| `components/LoadModeContent.tsx` | 367 | `Divider` | 6 | MED | atom-coupled, trivial antd surface |
| `components/SelectionSummary.tsx` | 107 | `Button`, `Space`, `Typography` | 0 | LOW | |
| `components/TestsetSelectionPreview.tsx` | 39 | `Input` | 0 | LOW | |

### Chunk 2 — `WorkflowRevisionDrawer/`

| file | LOC | antd | atoms | risk | why |
| --- | --: | --- | --: | --- | --- |
| `DrawerHeader.tsx` | 267 | `Button`, `Input`, `Popover`, `Typography` | **11** | **HIGH** | highest atom count outside chunk 5; overlay |
| `WorkflowRevisionDrawer.tsx` | 133 | `Drawer` | 7 | MED-HIGH | `Drawer`→`Sheet`; needs open-state story (F10) |
| `MetadataSidebar.tsx` | 138 | `Typography` | 4 | LOW-MED | |

### Chunk 3 — comparison view · **depends on chunk 5** (F4)

| file | LOC | antd | atoms | risk | why |
| --- | --: | --- | --: | --- | --- |
| `GenerationComparisonCompletionOutput/index.tsx` | 387 | `Tag` | 9 | MED-HIGH | imports `CompletionMode` from chunk 5 |
| `assets/GenerationComparisonOutputHeader/index.tsx` | 43 | `Tag`, `Typography` | 3 | LOW | |
| `assets/GenerationComparisonInputHeader/index.tsx` | 23 | `Typography` | 0 | LOW | |

*(`GenerationComparisonChatOutput/index.tsx` has no antd of its own but imports
`ChatTurnView` + `ExecutionRow` from chunk 5 — it still needs a story.)*

### Chunk 4 — outputs and results · **depends on chunk 5** (F4)

| file | LOC | antd | atoms | risk | why |
| --- | --: | --- | --: | --- | --- |
| `PlaygroundOutputs/index.tsx` | 418 | `Tag` | **10** | MED-HIGH | atom-heavy, narrow antd surface |
| `ExecutionHeader/index.tsx` | 209 | `Button`, `Tooltip`, `Typography` | **10** | MED-HIGH | dead commented import at :16 — delete it |
| `ExecutionResultView/index.tsx` | 248 | `Typography` | 2 | MED | 2 ctx reads; renders 3 chunk-5 children |
| `shared/NodeResultCard/index.tsx` | 229 | `Tag` | 0 | LOW-MED | |

### Chunk 5 — `ExecutionItems/` · **land this first** (F4)

| file | LOC | antd | atoms | ctx | risk | why |
| --- | --: | --- | --: | --: | --- | --- |
| `assets/ExecutionRow/SingleLayout.tsx` | **1084** | `Tag` | **24** | 4 | **HIGHEST** | see F12 |
| `assets/ChatTurnView/index.tsx` | 489 | `Popover`, `Tag`, `LoadingOutlined` | 7 | 2 | **HIGH** | overlay + ctx + consumed by chunk 3 |
| `assets/RunOptionsPopover/index.tsx` | 91 | `Popover`, `Slider`, `InputNumber`, `Button`, `Typography` | 3 | 0 | **HIGH** | 5 antd in 91 lines; `Slider` accessible-name trap (guide §Model) |
| `GatewayToolExecuteButton.tsx` | 100 | `Dropdown`, `message` | 0 | 0 | MED | `menu.items[]`→JSX |
| `assets/ExecutionRowActions/index.tsx` | 67 | `Button` | 4 | 0 | LOW-MED | |
| `assets/RepetitionNavigation/index.tsx` | 46 | `Button`, `Typography` | 0 | 0 | LOW | **rendered by chunk 4** |
| `assets/TypingIndicator.tsx` | 36 | `Spin`, `LoadingOutlined` | 0 | 0 | LOW | **rendered by chunk 4** |

### Chunk 6 — inputs · **file-disjoint, safe to parallelise** (F4)

| file | LOC | antd | atoms | risk | why |
| --- | --: | --- | --: | --- | --- |
| `PlaygroundInputsBody/VariableCard.tsx` | 894 | `Alert`, `Button`, `Input`, `InputNumber`, `Switch`, `Tag`, `Tooltip`, `Typography`, `message` | 1 | **HIGH** | **broadest antd surface in the package (9)**; low atom coupling, so this is a pure-swap grind |
| `adapters/VariableControlAdapter.tsx` | 576 | `InputNumber`, `Switch`, `Tooltip`, `Typography` | 7 | **HIGH** | recursive renderer; `Switch.onChange`→`onCheckedChange`; F7 boundary |
| `PlaygroundInputsBody/UnreferencedColumnsFooter.tsx` | 105 | `Button` | 0 | LOW | |

### Leftovers — take with whichever chunk you touch first

| file | LOC | antd | atoms | ctx | risk |
| --- | --: | --- | --: | --: | --- |
| `context/PlaygroundUIContext.tsx` | 250 | `ButtonProps` *(type)* | 0 | 9 | **HIGH** — public API break (F3) |
| `EntitySelector/EntitySelector.tsx` | 419 | `Input`, `Button`, `Tabs`, `Space`, `Typography` | 6 | 0 | MED |
| `TurnMessageHeaderOptions/index.tsx` | 278 | `Button`, `Dropdown`, `Tooltip` | 0 | 0 | MED — overlay (F10) |
| `shared/EvaluatorFieldGrid/index.tsx` | 189 | `Tag` | 0 | 0 | LOW |
| `EmptyState.tsx` | 41 | `Empty`, `Button`, `Space`, `Typography` | 0 | 0 | LOW |
| `shared/EntityStatusTag.tsx` | 24 | `Tag` | 0 | 0 | LOW |

**Correction to the guide's context count.** The guide states "Eight files read
`PlaygroundUIContext`." Eight files *mention* it; **five consume it** —
`ExecutionItems/index.tsx`, `ChatTurnView`, `ExecutionRow/ComparisonLayout`,
`ExecutionRow/SingleLayout`, `ExecutionResultView`. The other three are the definition
plus two barrels (`index.ts`, `context/index.ts`). The context seam is therefore narrower
than advertised, and correspondingly **more** of the package needs atom fixtures.

---

## Recommended sequencing

1. **Unblock** — F2 (add the dep), F1 (fix the guide's base branch), decide F3's scope.
2. **Chunk 1** — self-contained, forces the `Upload` decision early. Defer `types.ts` to
   the F3 chunk.
3. **Chunk 5** — the shared dependency. Sub-chunk `SingleLayout` per F12.
4. **Chunks 3 and 4** — only after 5. **Chunk 6 and chunk 2** may run in parallel with
   any of the above.
5. **F3 chunk last** — the two public-API type swaps plus the `web/oss` fallout, plus F8
   (drop the peer deps) as the closing commit.

## Handoff

- `triage-findings` — to decide F3's scope and confirm the sequencing above.
- `test-codebase` — F11 is inferred from file layout; it needs a real run of
  `tsc --noEmit` and the existing suites to become a validated finding.
- `resolve-findings` — F1, F2, F4, F6 are small, well-specified, and independently
  landable.

## Appendix — census re-measured on this tip

```text
web/packages/agenta-playground-ui   antd=31  files=78   stories=0   tests=0
web/packages/agenta-entity-ui       antd=2   files=304  stories=0   tests=19
web/packages/agenta-ui              antd=14  files=409  stories=0
web/packages/agenta-entities        antd=0   files=326
web/packages/agenta-playground      antd=0   files=60
web/storybook/stories               *.stories.tsx=175
web/storybook/parity/vrt.mjs        DEFAULT_STORIES=436   NO_PAIR_EXPECTED=281
```

`stories=0` in every package is expected: all stories live in `web/storybook/stories/`,
even though `main.ts` also globs `packages/*/src/**/*.stories.@(ts|tsx)`.

antd surface remaining in `@agenta/playground-ui`, by component:
`Typography` 14 · `Button` 12 · `Tag` 9 · `Tooltip` 4 · `Input` 4 · `Space` 3 ·
`Popover` 3 · `InputNumber` 3 · `message` 2 · `Switch` 2 · `Dropdown` 2 ·
`Tabs`/`Spin`/`Slider`/`Empty`/`Drawer`/`Divider`/`Alert`/`Upload` 1 each ·
plus 2 type-only (`ButtonProps`, `ModalProps`).
