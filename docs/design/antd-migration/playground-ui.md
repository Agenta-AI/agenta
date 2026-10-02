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

**Base your branch on the wave-2 stack** (#5643 → #5644 → #5694). The primitives, the story
harness and the parity gates all live there.

---

## Where the package stands

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

**`Upload` has no primitive** (`TestsetSelectionModal/components/CreateTestsetCard.tsx`). There
is a working precedent: `usePromptFileUpload` plus the drop-zone markup in
`SkillUploadZone.tsx` from wave 2. Reuse that shape rather than inventing a third one, and do
not leave the call site on antd.

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
because the chunks touched disjoint files. Chunks 4, 5 and 6 here share `ExecutionItems`
helpers. If two people take those simultaneously, agree who owns the shared file first.

---

## What is different about this package

### The data seam runs through a React context, not only atoms

Eight files read `PlaygroundUIContext`. That is a second seam on top of the jotai one, and it
is good news for stories: a context is trivially providable, so prefer
`<PlaygroundUIContext.Provider value={fixture}>` over seeding atoms wherever the component
takes its data from the context.

Seed atoms only for what the component genuinely reads from atoms. The rule from wave 2 holds:
**seed the exact query keys the component reads, never a broad mock.** Find them by reading the
component's hooks, not by guessing.

### It depends on `@agenta/entity-ui`

`playground-ui` sits above `entity-ui` in the import hierarchy, so the composites built in
waves 1 and 2 are available to you: `SchemaForm` controls, `ChipsInput`, `MultiSelect`,
`DateTimeInput`, the `drawers/shared/*` primitives, `EntityTable`. **Check whether the thing
you need already exists before you build it.** Reuse means mirroring existing usage, not
writing a second version of it.

### There are no stories yet

Every other package had at least a partial inventory to extend. Here you are starting from
zero, so the story is not an afterthought at the end of the chunk. Write the parity story
**as you migrate each component**, while you still have the pre-migration markup in front of
you (`git show <base>:<path>`). Retrofitting it later is how you end up with a story that
tests what you wrote rather than what you replaced.

---

## Definition of done, per chunk

- [ ] Zero `from "antd"` / `from "@ant-design/icons"` in the files you touched
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

Numbers in this file were measured on the wave-2 tip. Re-run before trusting them.
