# `@agenta/playground-ui` — migration guide

How to take `@agenta/playground-ui` off antd and into the Storybook inventory. This is
**wave 3**. Waves 1 and 2 took `@agenta/ui` and `@agenta/entity-ui` off antd; this package is
what remains of the shared UI layer.

**Read first, in this order:**

1. [entity-ui.md](entity-ui.md) — the two rules, the antd→primitive map, the per-component
   procedure, and the corrections logged from waves 1 and 2. **Everything there applies here.**
   This file only records what is different about `playground-ui`.
2. [GOTCHAS.md](GOTCHAS.md) — symptom→cause→fix. Read before your first swap, not after your
   first failure.
3. [migrations/](migrations/) — the per-primitive guides. Each one lists the props that exist
   and the antd features that were deliberately dropped.

**Branch off `main`.** Waves 1 and 2 are merged — the primitives
(`web/packages/agenta-ui/src/components/ui/`, 35 of them), the story harness
(`web/storybook`) and both parity gates are all on `main` today. (An earlier version of this
file said to branch on the wave-2 stack #5643 → #5644 → #5694; those have landed.)

**Before your first story**, `@agenta/storybook` needs two wirings that did not exist until
wave 3 started. Both are done now; know about them because the failures look unrelated:

1. `web/storybook/package.json` — `"@agenta/playground-ui": "workspace:*"` in `dependencies`,
   then `pnpm install`. Without it the import does not resolve at all.
2. `web/storybook/next.config.mjs` — `@agenta/playground-ui` **and** `@agenta/playground` in
   `transpilePackages`. The workspace packages are source-only TS (`main: ./src/index.ts`),
   so webpack chokes on the raw TS without this. `tsc` passes either way, because
   `moduleResolution: bundler` reads the source directly — so this one is invisible until you
   actually load the story.

Restart Storybook after touching `next.config.mjs`; HMR does not pick it up.

---

## Where the package stands

> ## ⚠️ Everything below this box is the PRE-MIGRATION baseline, kept as history
>
> **Both halves are DONE. antd: 31 → 0 files** — including the two type-only imports this guide
> still describes as a carve-out; they were retyped onto `@agenta/ui`'s `EnhancedButtonProps` /
> `EnhancedModalProps`, and `antd` + `@ant-design/icons` are out of `peerDependencies`. Stories:
> **82 ids covering all 49 renderable components.** See
> [`wave-3/storybook-map.md`](wave-3/storybook-map.md) for the current state.
>
> Gate scope, precisely: `render-check` covers **light and dark**; `parity/a11y.mjs` runs
> **light only** (it hardcodes `globals=theme:light`), so dark-mode accessibility is checked by
> eye, not gated.
>
> Do not follow the chunk plan, the DoD, or the carve-out sections below as instructions — they
> describe work that is finished. They are retained because the sequencing rationale is still
> useful reading.
>
> The prediction below held, and then some — the inventory was not just the larger half, it was
> the half that found the bugs. Six defects the merged migration had already shipped surfaced
> only once each component had its own story, four of them accessibility failures that every
> existing gate passed. The sharpest case: `VariableCard` and `VariableControlAdapter` were
> migrated together and both ended up with an unnamed `Switch`; the one with a story was caught
> and fixed during the migration, the one without stayed broken for weeks.
>
> **So do not defer the story while migrating a component.** Doing chunks 2–6 first and
> backfilling later cost more than it saved: reconstructing what a component needs after the
> fact is slower than writing it with the antd markup still in front of you.

78 files, **31 import antd**, about 8,000 lines. **Zero Storybook coverage today**, which is
the larger half of this job: the inventory matters as much as the migration.

| Directory     | files | antd | jotai files | atom hooks |
| ------------- | ----: | ---: | ----------: | ---------: |
| `components/` |    65 |   30 |          31 |        213 |
| `context/`    |     2 |    1 |           0 |          0 |
| `hooks/`      |     6 |    0 |           5 |         17 |
| `state/`      |     3 |    0 |           2 |          0 |
| `utils/`      |     1 |    0 |           0 |          0 |

213 atom hooks across 31 jotai files is the highest data-coupling density of any package so
far. Budget your time accordingly: **the fixtures, not the antd swaps, are the work here.**

### What antd is actually used for

| antd                                                                      |   uses | replacement                                                                                                         |
| ------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------------------------------------------------------- |
| `Typography`                                                              |     14 | plain `<span>`/`<p>` + semantic token classes. **Read the token correction in entity-ui.md before you start.**      |
| `Button`                                                                  |     12 | `Button` — `icon` is a child, `loading` is `LoadingButton`                                                          |
| `Tag`                                                                     |      9 | presentational `Tag` presets, or `Badge`                                                                            |
| `Tooltip`                                                                 |      4 | `Tooltip` + `TooltipProvider`                                                                                       |
| `Input`                                                                   |      4 | `Input`; composed variants in `input-composed.tsx`                                                                  |
| `Space`                                                                   |      3 | flex utilities                                                                                                      |
| `Popover`                                                                 |      3 | `Popover`                                                                                                           |
| `InputNumber`                                                             |      3 | `InputNumber`                                                                                                       |
| `message`                                                                 |      2 | `message` from `@agenta/ui/app-message`                                                                             |
| `Switch`                                                                  |      2 | `Switch` — `onChange` becomes `onCheckedChange`                                                                     |
| `Dropdown`                                                                |      2 | `DropdownMenu` — `menu.items[]` becomes JSX                                                                         |
| `Tabs`, `Spin`, `Slider`, `Empty`, `Drawer`, `Divider`, `Alert`, `Upload` | 1 each | `Tabs`, `Spinner`, `Slider`, `EmptyState`, `Sheet`/`EnhancedDrawer`, `Divider`, `Alert`, and see below for `Upload` |
| `ButtonProps`, `ModalProps` (**type-only**)                               |      2 | not chunk work — see the carve-out in the DoD                                                                       |

Of the 18 `Typography.Text` uses, **10 carry `type="secondary"`** (→ `colorTextDescription`,
the trap), 3 are `strong`, and 2 are `type="warning"` (→ `colorWarning`, a different token
family — confirm it rather than assuming it follows the same correction).

**`Upload` has no primitive** (`TestsetSelectionModal/components/CreateTestsetCard.tsx`, which
uses `Upload.Dragger`). There is a working precedent: `usePromptFileUpload` plus the drop-zone
markup in `SkillUploadZone.tsx` from wave 2. Reuse that **shape** rather than inventing a third
one — but not its tokens: `SkillUploadZone` styles itself with `--ag-c-*` literals
(`border-[var(--ag-c-D6DEE6,#d6dee6)]`), which the maintainer checklist at the bottom of this
file rejects. Use semantic classes. Do not leave the call site on antd.

**Raw Tailwind grays.** Six files carry `bg-gray-50` / `border-gray-200` / `text-gray-400`
style classes (19 occurrences) that do not respond to the theme at all. They will fail the
"both themes checked" box. Replace them with semantic tokens in whatever file you touch.

---

## Suggested chunks

Six chunks, sized so one contributor can finish one in a sitting and open a reviewable PR.
They are grouped by **data coupling**, not by file count — a 1,084-line presentational file is
a smaller job than a 250-line container with nine atom reads.

| #   | chunk                                                                                                                   | files | ~lines | character                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ----: | -----: | ---------------------------------------------------------------- |
| 1   | `TestsetSelectionModal/`                                                                                                |     5 |    800 | modal + the `Upload` case. Self-contained. **Best first chunk.** |
| 2   | `WorkflowRevisionDrawer/`                                                                                               |     3 |    530 | drawer chrome; reuse `drawers/shared/*` from entity-ui           |
| 3   | `ExecutionItemComparisonView/` + comparison headers                                                                     |     3 |    450 | mostly presentational                                            |
| 4   | outputs and results: `PlaygroundOutputs`, `ExecutionResultView`, `ExecutionHeader`, `shared/NodeResultCard`             |     4 |  1,100 | atom-heavy; expect real fixture work                             |
| 5   | `ExecutionItems/` (incl. `SingleLayout` 1,084 and `ChatTurnView` 489)                                                   |     7 |  1,900 | biggest; sub-chunk it if it fights you                           |
| 6   | inputs: `PlaygroundInputsBody/VariableCard` (894), `adapters/VariableControlAdapter` (576), `UnreferencedColumnsFooter` |     3 |  1,575 | the recursive variable renderer; story the branch matrix         |

Left over and easy, take them with whichever chunk you touch first: `EntitySelector` (419),
`TurnMessageHeaderOptions` (278), `context/PlaygroundUIContext` (250),
`shared/EvaluatorFieldGrid` (189), `EmptyState` (41), `shared/EntityStatusTag` (24).

**Do not run all six at once.** Waves 1 and 2 ran six parallel agents and it worked, but only
because the chunks touched disjoint files. That is not true here, and the dependency runs in
one direction:

> **Chunk 5 (`ExecutionItems/`) is the shared dependency. Chunks 3 and 4 consume it.**
> Land chunk 5 first, or give 3 + 4 + 5 to one owner. **Chunk 6 is file-disjoint** and can
> run in parallel with anything.

The actual imports, so you can check this yourself:

| consumer | imports from `ExecutionItems/assets/` |
| ------------------------------------------------------------- | ------------------------------------------------ |
| `ExecutionItemComparisonView/GenerationComparisonCompletionOutput` (ch. 3) | `CompletionMode` |
| `ExecutionItemComparisonView/GenerationComparisonChatOutput` (ch. 3) | `ChatTurnView`, `ExecutionRow` |
| `ExecutionResultView` (ch. 4) | `RepetitionNavigation`, `ResultPlaceholder`, `TypingIndicator` |

Note the trap in the last row: `RepetitionNavigation` and `TypingIndicator` are antd files
**owned by chunk 5 but rendered by chunk 4**. Chunk 4's parity stories cannot be trusted
until chunk 5's swaps land — you would be diffing an antd child against itself.

(`ExecutionHeader` has a commented-out `RunOptionsPopover` import at line 16. It is dead —
delete it when you take chunk 4.)

---

## What is different about this package

### The data seam runs through a React context, not only atoms

**Five** files consume `PlaygroundUIContext`: `ExecutionItems/index.tsx`, `ChatTurnView`,
`ExecutionRow/ComparisonLayout`, `ExecutionRow/SingleLayout`, `ExecutionResultView`. (Eight
files *mention* it; the other three are the definition and two barrels. An earlier version of
this file said eight — the seam is narrower than that, so correspondingly **more** of the
package needs atom fixtures rather than a provider.)

Where a component does take its data from the context, that is good news for stories: a
context is trivially providable, so prefer `<PlaygroundUIContext.Provider value={fixture}>`
over seeding atoms.

Seed atoms only for what the component genuinely reads from atoms. The rule from wave 2 holds:
**seed the exact query keys the component reads, never a broad mock.**

### Don't hunt for the query keys — let the harness tell you

`withAgentaData` subscribes to the query cache and logs anything that tries to fetch:

```
[withAgentaData] no fixture for queryKey — add it to parameters.agenta.queries:
["testsets-list","project-34favu",""]
```

So the loop is: render the story with `parameters: {agenta: {queries: []}}`, read the console,
add the key it names, repeat. Each fixture unlocks the next layer — for `LoadModeContent` it went
`testsets-list` → `revisions-list` → two `testcase-paginated` scopes. Copy the key **from the
console**, not from the source: the paginated key ends in a `JSON.stringify`'d meta object that
is compared by value, so the property order has to match.

The project id is story-scoped (`scope.projectId`), so use the function form of `queries` and
two stories can never collide on a cache key.

**A blank render is the other tell.** Some queries won't warn: `testcaseEntityAtomFamily` is
`enabled: … && !cachedData`, so an unseeded row renders empty rather than fetching. The
paginated page carries row IDs only; the cells come from `["testcase", projectId, id]`. If a
table renders the right number of empty rows, you are missing the entity layer, not the page.

### `session: false` is usually what you want

`withAgentaData`'s client sets `staleTime: Infinity` + `refetchOnMount: false` so a seeded key
never runs its `queryFn`. But **a per-query option beats the client default**, and
`testsetsListQueryAtomFamily` sets `refetchOnMount: "always"` (`testset/state/store.ts:643`). The
list refetched anyway, hit the real API, failed, and the sidebar replaced the fixture with
`Error: Failed to fetch` — while the seeded testcases underneath rendered fine, which makes it
look like a fixture bug rather than a refetch bug.

Setting `session: false` closes the auth gate (`enabled: get(sessionAtom) && …`), so the query is
disabled and never fetches — and TanStack still serves whatever is already in the cache. **Seed
the cache AND close the gate.** Leave the gate open only when a story genuinely needs a query to
run. Worked example: `stories/playground-ui/LoadModeContent.stories.tsx`.

### It depends on `@agenta/entity-ui`

`playground-ui` sits above `entity-ui` in the import hierarchy, so the composites built in
waves 1 and 2 are available to you: `SchemaForm` controls, `ChipsInput`, `MultiSelect`,
`DateTimeInput`, the `drawers/shared/*` primitives, `EntityTable`. **Check whether the thing
you need already exists before you build it.** Reuse means mirroring existing usage, not
writing a second version of it.

### There are no stories yet — and no tests either

Every other package had at least a partial inventory to extend. Here you are starting from
zero, so the story is not an afterthought at the end of the chunk. Write the parity story
**as you migrate each component**, while you still have the pre-migration markup in front of
you (`git show main:<path>`). Retrofitting it later is how you end up with a story that
tests what you wrote rather than what you replaced.

The package also has **no `tests/` directory and no `vitest.config.ts`** (against
`@agenta/entity-ui`'s 19 test files). So until your first story exists there is no regression
signal of any kind here. Bear in mind what the gates do and do not cover: VRT proves pixels
and a11y proves the accessibility tree — **neither proves a handler still fires.** A `Switch`
whose `onChange` was not rewired to `onCheckedChange` passes both gates and is broken. For the
interactive surfaces (`VariableCard`, `VariableControlAdapter`, `RunOptionsPopover`), consider
a behavioural test alongside the story.

Stories live in `web/storybook/stories/playground-ui/`, not co-located in the package.
`main.ts` does glob `packages/*/src/**/*.stories.@(ts|tsx)` as well, but no package uses it
and wave 3 should not be the first to.

---

## Definition of done, per chunk

- [ ] Zero `from "antd"` / `from "@ant-design/icons"` in the files you touched — **except the
      two type-only imports carved out below, which are not chunk work**
- [ ] Every migrated surface has a Storybook entry, titled `@agenta/playground-ui/<Area>/<Name>`
- [ ] Parity story (`AntdVsAgenta`) wherever an antd half exists, with `data-vrt-subject` on
      the subjects and the `antd`/`agenta` captions present. A parity story with no antd
      caption fails the gate as "0 pairs measured", which is the harness telling you the story
      is lying about what it compares.
- [ ] Data-seam showcase stories for the container states that matter (loading, empty,
      populated, error)
- [ ] `pnpm --filter @agenta/playground-ui exec tsc --noEmit` — no error naming a symbol you changed
- [ ] `pnpm lint-fix` in `web/` clean
- [ ] VRT passes, or every diff over 1% is declared via `data-vrt-expected="<reason with a measurement>"`
- [ ] a11y clean for your new stories
- [ ] Both themes checked. Light passing is not evidence; dark is where tokens diverge.

### Carved out of the chunks: the two type-only antd imports

Two antd imports are **types on the package's public API**, not markup, and migrating them
is a cross-package change — not something to do mid-chunk:

| file | import | reached through |
| ------------------------------------------ | ------------------------- | -------------------------------- |
| `context/PlaygroundUIContext.tsx:30`        | `type {ButtonProps}`      | exported `PlaygroundUIProviders` |
| `components/TestsetSelectionModal/types.ts:8` | `type {ModalProps}`     | exported `TestsetSelectionModalProps` |

25 files under `web/oss/src` import this package. **The hazard:**
`WorkflowRevisionDrawerWrapper/index.tsx:214,422` already casts
`as unknown as PlaygroundUIProviders` at both sites, so `tsc` will not catch the fallout —
it surfaces at runtime as silently dropped props. Removing those two casts belongs to the
same change, so the type check becomes load-bearing again.

Leave both in place while you do the chunks. They get their own PR at the end, and that PR
closes with:

- [ ] `antd` and `@ant-design/icons` dropped from the package's `peerDependencies` (they are
      still declared there today, so the package advertises an antd contract even at zero
      imports). This is only safe once the two type-only imports are gone.

### The gates

```bash
# from web/storybook — always cd in the same command, the shell resets cwd
cd web/storybook && VRT_OUT=__vrt_mine__ node parity/vrt.mjs <story-id>...
cd web/storybook && node parity/a11y.mjs <story-id>...
```

Register your story ids in `parity/vrt.mjs`: parity exports in `DEFAULT_STORIES`, showcases in
`NO_PAIR_EXPECTED` **with a reason**. An unregistered story is not gated, and a showcase filed
without a reason is indistinguishable from a broken parity story.

**Run tsc before you trust any VRT number.** A type error can make the VRT pass by rendering
nothing.

#### The VRT cannot see `Typography` or `Upload` — mark them by hand

The VRT finds the thing to diff through an auto-detect selector list (`SUBJECT`, in
`parity/vrt.mjs`). It enumerates `.ant-tag`, `.ant-select`, `.ant-alert`, `button`, `input`
and so on — but it has **no `.ant-typography` and no `.ant-upload` entry**. Those are this
package's most-used (`Typography`, 14 files) and least-supported (`Upload`, no primitive)
antd surfaces.

So on every `Typography` and `Upload` row, put `data-vrt-subject` on the real element
yourself. If you forget, the harness does one of two things, and neither looks like your
mistake:

- more than one candidate in the cell → **`AMBIGUOUS SUBJECT`**, the row is skipped;
- no candidate → the story reports **`0 pairs measured`**, which the DoD below tells you to
  read as a broken parity story.

You will hit this on your very first `Typography` swap. It is the harness's gap, not yours.

---

## Standards for contributors working with coding agents

Most of this work will be done with an agent. That is fine and expected. These rules exist
because the failure modes here are **silent** — a wrong token or a dropped prop type-checks,
renders, and looks approximately right.

### Model

**Use a frontier model for migration and gate triage: Claude Opus 5, or Sonnet 5 at minimum.**

This is not gatekeeping for its own sake. The work is a long chain of small judgements where a
plausible-looking wrong answer costs more than a slow right one. Concretely, in waves 1 and 2
these were all caught by reasoning, not by the compiler:

- `Typography.Text type="secondary"` maps to `colorTextDescription`, not the identically-named
  `colorTextSecondary`. 26 sites were wrong and the pixel gate could not see it.
- An accessible name passed to a Slider's Root instead of its thumb looks correct at the call
  site and names nothing.
- Lexical takes `aria-label`; an `ariaLabel` prop type-checks and is silently dropped.

Smaller and faster models are appropriate for the mechanical parts (bulk import rewrites, story
scaffolding from an existing template) **once a frontier model has decided the mapping**. Do
not let a small model choose a token, resolve a VRT diff, or decide that a diff is acceptable.

### Rules for the agent

Put these in the agent's instructions. They are the ones that were violated most often:

1. **Never mark work done on a gate you did not run.** Paste the actual output. "Should pass"
   is not a result.
2. **Never waive a VRT diff without a measurement in the reason.** "Minor AA difference" is not
   a reason. "antd's `.ant-btn-icon` centres the glyph 0.75px high; icon-only crop, 24x24,
   geometry otherwise identical" is.
3. **Do not leave a call site on antd because the primitive lacks a feature.** Compose on top
   of the primitive. This rule is why the Button and Input primitives got reworked.
4. **Match the app, not raw antd.** If the call site goes through an `Enhanced*` wrapper,
   reproduce that.
5. **Verify in the rendered DOM, not in the source.** Attributes get dropped by wrappers that
   enumerate props. Check that the thing you set actually landed.
6. **Report what you could not do.** A precise "I could not make X pixel-neutral because Y" is
   worth more than a silent compromise. Wave 2's best findings came from agents flagging
   things they deliberately did not touch.

### Review checklist for the maintainer

Before approving a wave-3 PR:

- Do the parity stories actually contain an antd half? Grep the story for `>antd<`.
- Is every VRT waiver justified with a number?
- Does the story seed only the query keys the component reads, or did it reach for a broad mock?
- Are new tokens semantic (`text-colorTextDescription`), not raw hex or `--ag-c-*` literals?
- Did dark mode get checked, or only light?

---

## Appendix — re-measuring

```bash
cd web/packages/agenta-playground-ui/src
grep -rl 'from "antd"' . | wc -l                       # remaining antd files
grep -rhoE 'import \{[^}]+\} from "antd"' . \
  | sed 's/import {//;s/} from "antd"//' | tr ',' '\n' \
  | sed 's/ as .*//;s/^ *//;s/ *$//' | sort | uniq -c | sort -rn   # what is left, by component
```

Note the first command misses **type-only** imports (`import type {X} from "antd"`). Use
`grep -rl 'from "antd"'` without the `import {` anchor to catch those two as well.

Re-measured on `main` @ `ecacb20d5f` (2026-08-06) — unchanged from the original wave-2
measurement, plus the tests column:

```
agenta-playground-ui   antd=31  files=78   stories=0  tests=0
agenta-entity-ui       antd=2   files=304  stories=0  tests=19   (antd = the deferred Form engine)
agenta-ui              antd=14  files=409  stories=0             (13 = the deferred Table engine)
agenta-entities        antd=0   files=326
agenta-playground      antd=0   files=60
web/storybook          175 story files · vrt.mjs DEFAULT_STORIES=436 · NO_PAIR_EXPECTED=281
```

`stories=0` in every package is expected — they all live in `web/storybook/stories/`.

### Boundaries you cannot cross in wave 3

Two antd engines are deliberately deferred and are **not** wave-3 scope. If a chunk leads you
into one, stop and file it rather than migrating it as a side quest:

- **antd `Form`**, in `@agenta/entity-ui`: `gatewayTool/components/SchemaForm.tsx:30` and
  `gatewayTrigger/drawers/subscription/SubscriptionForm.tsx:35`. Chunk 6
  (`VariableControlAdapter`) and `shared/EvaluatorFieldGrid` sit right next to this.
- **antd `Table`**, in `@agenta/ui`: `InfiniteVirtualTable/**` (13 files).

Also note `@agenta/ui`'s `components/ui/progress.tsx:3` still imports `@ant-design/icons`
inside the primitive layer — so adopting the `Progress` primitive to get *off* antd currently
drags the icon package back in. Tracked separately; not a wave-3 blocker.

Full readiness scan, with a per-file risk map for all 31 files:
[`wave-3/findings.md`](wave-3/findings.md). Which components get stories, in what order, and
which are reachable without touching the package exports:
[`wave-3/storybook-map.md`](wave-3/storybook-map.md).
