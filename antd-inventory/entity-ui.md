# `@agenta/entity-ui` — migration guide

How to take an `@agenta/entity-ui` component off antd and onto `@agenta/ui`, in chunks small
enough for one PR, without diverging from what the `@agenta/ui` migration already established.

**Read first:** [STATUS.md](STATUS.md) (what exists) · [GOTCHAS.md](GOTCHAS.md) (symptom→cause→fix,
read before your first component) · [migrations/](migrations/) (per-primitive guides — each one
tells you the props that exist and the antd features that were deliberately dropped).

**Upstream PRs this builds on:** #5643 (`@agenta/ui` off antd) and #5644 (the Storybook data seam).
Both must be in your base or the primitives and the story harness won't be there.

---

## Where the package stands

291 files, **117 still import antd**. Measured on `fe-refactor/migration-away-from-antd`; re-run
the command in [Appendix A](#appendix-a--re-measuring) before trusting these numbers.

| Directory | files | antd | jotai files | atom hooks | character |
|---|---:|---:|---:|---:|---|
| `DrillInView/` | 105 | 63 | 24 | 76 | biggest; must be sub-chunked |
| `selection/` | 49 | **0** | 19 | 67 | antd-free already — stories only |
| `modals/` | 45 | 7 | 21 | 129 | densest data coupling, little antd |
| `gatewayTrigger/` | 32 | 18 | 12 | 52 | drawers + forms |
| `drawers/` | 12 | 8 | **0** | **0** | pure UI — best first chunk |
| `gatewayTool/` | 10 | 7 | 3 | 14 | drawers + schema form |
| `testcase/` | 10 | 2 | 0 | 0 | pure UI |
| `variant/` | 6 | 3 | 2 | 10 | has the reference example |
| `view-types/` | 5 | 1 | 0 | 0 | pure UI |
| `shared/` | 4 | 3 | 2 | 14 | `EntityTable` — antd `Checkbox`/`Radio` only |
| `adapters/` | 4 | 0 | 3 | 0 | no UI |
| `workflow/` | 3 | 2 | 1 | 2 | two tag components |
| `secretProvider/` | 3 | 2 | 0 | 0 | pure UI |
| `template-format/` | 2 | 1 | 0 | 0 | pure UI |

**"atom hooks"** counts `useAtomValue`/`useSetAtom`/`useAtom(` occurrences. It is a proxy for how
much fixture work a story needs, *not* for how hard the antd swap is — those are independent axes,
and `drawers/` (8 antd, 0 atoms) versus `modals/` (7 antd, 129 atoms) is the proof.

---

## The two rules

**1. Match the app, not raw antd.** The app wraps antd in its own defaults — `EnhancedModal` forces
`borderRadius: 16`, so a modal that matches bare antd's 10px is *wrong*. Before reproducing
anything, find out whether the call site goes through an `Enhanced*` wrapper and measure that.
This cost a full rework once already (STATUS.md, "Fix round 2026-07-26").

**2. Container reads atoms, presentational takes props.** The target shape already exists in this
package:

- [`variant/VariantNameCell.tsx`](../web/packages/agenta-entity-ui/src/variant/VariantNameCell.tsx) —
  container. Reads 5 atoms across 3 molecules, derives a flat object, renders a sibling.
- [`variant/VariantDetailsWithStatus.tsx`](../web/packages/agenta-entity-ui/src/variant/VariantDetailsWithStatus.tsx) —
  presentational. **Zero** jotai/entities imports. Storiable with plain args.

Keep containers at the leaf. Do **not** hoist atom reads to the top of a tree and prop-drill down:
`web/AGENTS.md` says components fetch their own data via atoms and pass IDs, not data structures,
and hoisting regresses re-render behaviour. The split is one file boundary, not an architecture.

---

## antd → `@agenta/ui` map

Counts are import occurrences across `entity-ui/src`, so they tell you what a chunk will actually
hit. Primitives live in `@agenta/ui/components/ui/*`; each has a guide under [migrations/](migrations/).

| antd | uses | replacement |
|---|---:|---|
| `Button` | 54 | `Button` — no `icon`/`loading` props; icon is a child, `LoadingButton` is composed |
| `Typography` | 53 | **no primitive** — plain `<span>`/`<p>` + semantic token classes. `Typography.Text editable` → `EditableText` |
| `Tooltip` | 39 | `Tooltip` (+ `TooltipProvider` — the Radix root is required) |
| `Input` | 30 | `Input`; `prefix`/`suffix`/`allowClear`/`Search`/`Password`/`autoSize` → `input-composed.tsx` |
| `Tag` | 23 | `Tag` (presentational) — presets `status`/`mapping`/`env`/`draft`/`sync`, or `Badge` for generic |
| `Select` | 21 | `Select`; **`showSearch` → `Combobox`** (Radix has no searchable select) |
| `Spin` | 13 | `Spinner` |
| `Switch` | 9 | `Switch` |
| `Form` | 9 | **no primitive** — see [Form](#antd-form-has-no-replacement-on-purpose) below |
| `Dropdown` | 9 | `DropdownMenu` — `menu.items[]` becomes JSX; there is no array adapter |
| `Alert` | 8 | `Alert` |
| `Divider` | 7 | `Divider` |
| `Empty` | 6 | `EmptyState` |
| `Skeleton` | 5 | `Skeleton` / `LoadingSkeleton` |
| `InputNumber` | 5 | `InputNumber` |
| `Space` | 4 | **no primitive** — flex utilities (`flex gap-2`) |
| `Segmented` | 4 | `Segmented` |
| `Popover` | 4 | `Popover`. `trigger="hover"` has no Radix equivalent — use `PopoverAnchor` (not `PopoverTrigger`) + manual open delays |
| `Drawer` | 4 | `Sheet`, or keep the `EnhancedDrawer` facade |
| `Radio` | 3 | `RadioGroup` |
| `Modal` | 3 | `Dialog`/`AlertDialog`, or keep the `EnhancedModal` facade |
| `Checkbox` | 3 | `Checkbox` |
| `Card` | 2 | **no primitive** — decision pending; div + tokens for now |
| `App` | 2 | **stays antd** — `utils/appMessageContext`, deliberate |
| `Tabs` | 1 | `Tabs` (LINE type only) |

Also available with no antd counterpart in this package: `accordion`, `avatar`, `breadcrumb`,
`cascader`, `field`, `label`, `notification`, `progress`, `sheet`, `slider`, `toast`.

**If a feature you need doesn't exist on the primitive, build a composed component on top of it.**
Do not leave the call site on antd — that rule triggered the Button and Input reworks.

### antd `Form` has no replacement on purpose

The `Editor/form/**` migration (STATUS.md, 2026-07-28) found antd `Form` was near-vestigial:
`Form.Item` existed only to clone leaf inputs and inject `value`/`onChange`, which the node props
already carried. The recipe: drop `Form`/`useForm`/`setFieldsValue`, make each leaf explicitly
controlled, and use local-buffer-plus-sync for the round trip. Watch for behaviour that lived in
`onValuesChange` — it has to move onto the direct path or it silently stops running.

---

## Procedure for one component

1. **Read the target and its call sites.** `grep -rn "<ComponentName" web/oss/src web/ee/src
   web/packages` — the call sites decide whether it goes through an `Enhanced*` wrapper (rule 1).
   Do not skip this because the component "looks self-contained".
2. **Split, if it isn't already.** Move the markup into a sibling that takes props; leave the atom
   reads in the container. If the component has no atom reads, there is nothing to split — go to 3.
3. **Swap the antd imports** using the map above. Consult the primitive's guide in
   [migrations/](migrations/) for the prop surface and the deliberate deviations.
4. **Write the story** — presentational component: plain args. Container: the data seam
   ([below](#writing-a-data-backed-story)).
5. **Run the gates** ([Appendix B](#appendix-b--gates)). tsc *before* you trust any VRT number.
6. **Check both themes.** Dark is where tokens diverge; light passing is not evidence.

### Definition of done

- [ ] Zero `from "antd"` / `from "@ant-design/icons"` in the files you touched
- [ ] `pnpm --filter @agenta/entity-ui exec tsc --noEmit` — no error mentioning a symbol you changed
- [ ] `pnpm lint-fix` in `web/` clean
- [ ] A story exists for the component, rendering in **light and dark**
- [ ] `pnpm --filter @agenta/storybook vrt <story-id>` passes, or the diff is declared with
      `data-vrt-expected="<reason with a measurement>"`
- [ ] `pnpm --filter @agenta/storybook a11y` clean for the new story
- [ ] No new deps without asking — the primitives exist; reach for them first

---

## Writing a data-backed story

Both injection points are ones the app itself uses, so **no product code is mocked**: gate atoms
(`projectIdAtom`/`sessionAtom` are primitives the app populates) and the QueryClient (the app
injects it via `useHydrateAtoms([[queryClientAtom, qc]])`). Seeding the query cache seeds the
molecules too, because `createEntityController` derives `serverData` from `query.data`.

```ts
parameters: {
  agenta: {
    queries: (scope) => myComponentQueries(scope),        // [queryKey, data][]
    args:    (scope) => ({revisionId: ids(scope).revisionId}),
    session: true,                    // default; the auth gate
    atoms:   [[someAtom, value]],     // extra seeds
    reset:   [[someSingleton, init]], // L2 — rewind a non-family atom
    isolate: "reload",                // L3 — escape hatch, opt-in
  },
}
```

**Every entity id must come from `scope.id(...)`, never a shared constant.** Stories share one
Jotai store (they must — ~120 files call `getDefaultStore()` imperatively, and jotai's default
store has no reset). Isolation works by not colliding: `atomFamily(id)` entries are per-story
because the ids are per-story. A hardcoded id is the one way draft state leaks between stories.

**Finding the query keys.** Run the story with no fixtures. The decorator logs every key that
tried to fetch:

```
[withAgentaData] no fixture for queryKey — add it to parameters.agenta.queries:
["workflows","revision","rev-6dp143","project-6dp143"]
```

Add each one. Build the payload through the **zod schema the API boundary already validates with**
(`workflowSchema`, `environmentsResponseSchema`, …) so a fixture can't drift from the contract
without failing loudly — see `web/storybook/fixtures/workflow.ts`, and cite the `store.ts` line
each key comes from, because that coupling is the real cost of cache-level seeding.

Reference story: `web/storybook/stories/domain/VariantNameCell.stories.tsx` — 5 atoms, 3 molecules,
4 query keys, plus a `NoData` story that reaches the empty-state branch a live app can't.

---

## Chunking

One directory (or one `DrillInView` sub-tree) per PR. Ordered by coupling, not size — the
zero-jotai directories need no fixtures at all, so they're where a new contributor or agent should
start.

| # | chunk | antd | why this order |
|---|---|---:|---|
| 1 | `drawers/` | 8 | 0 atom hooks — pure antd swap, no seam needed |
| 2 | `secretProvider/` + `template-format/` + `view-types/` | 4 | same, tiny |
| 3 | `testcase/` | 2 | same |
| 4 | `workflow/` + `variant/` | 5 | small; `variant/` already has the reference split |
| 5 | `shared/` | 3 | `EntityTable` needs only antd `Checkbox`/`Radio` — both primitives exist |
| 6 | `gatewayTool/` | 7 | drawers + `SchemaForm` (1484 lines, 0 hooks — sub-chunk it) |
| 7 | `gatewayTrigger/` | 18 | one drawer per PR; largest is `SubscriptionForm` (778) |
| 8 | `modals/` | 7 | little antd, heaviest fixtures — do it for the stories |
| 9 | `DrillInView/components/PlaygroundConfigSection/` | 6 | self-contained; all 6 remaining non-SchemaControls files live here |
| 10 | `DrillInView/SchemaControls/` | 57 | the long tail — sub-chunk by control family; `AgentTemplateControl` (1199) and `agentTemplate/useModelHarness` (1108) are each their own PR |
| — | `selection/` | 0 | antd-free; stories only, any time |

**Nothing here is blocked.** entity-ui imports no antd `Table`, `Tree`, or `Pagination`, so the
missing engine-level primitives don't gate any chunk. (`InfiniteVirtualTable` in `@agenta/ui` does
still need them — that is a different package and out of scope here.)

---

## Traps specific to this package

- **A big file is not a coupled file.** `gatewayTool/components/SchemaForm.tsx` is 1484 lines with
  **zero** atom hooks; `ToolSelectorPopover` is 1070 with zero. Size is markup, not coupling — check
  the hook count before you assume a file is hard.
- **`grep` per component, not per name.** "StatusTag has 10 uses" turned out to be 1 — the others
  were unrelated local definitions with the same name.
- **Re-read the file before deleting it.** Two components were nearly deleted as dead on the
  strength of a summary; both had live call sites. Independent re-verification caught both.
- **antd `Tabs` keeps panes mounted, Radix unmounts them.** Picker/breadcrumb state resets unless
  you `forceMount` visited tabs.
- **`afterOpenChange` has no Radix equivalent** — use an effect on the open state.
- **A clean VRT can be a false pass.** A component that fails to compile renders Storybook's error
  page on *both* halves and scores ~0%. Always run tsc after an edit, before believing a number.

---

## Appendix A — re-measuring

```bash
cd web/packages/agenta-entity-ui/src
for d in */; do
  n=$(find "$d" \( -name '*.tsx' -o -name '*.ts' \) | wc -l)
  a=$(grep -rl 'from "antd"\|from "@ant-design/icons"' "$d" 2>/dev/null | wc -l)
  h=$(grep -rho 'useAtomValue\|useSetAtom\|useAtom(' "$d" 2>/dev/null | wc -l)
  printf "%-18s files=%-4s antd=%-3s hooks=%s\n" "${d%/}" "$n" "$a" "$h"
done
```

## Appendix B — gates

```bash
# types — run BEFORE trusting any VRT number
pnpm --filter @agenta/entity-ui exec tsc --noEmit
pnpm --filter @agenta/storybook exec tsc --noEmit

# lint (documented pre-commit gate for all frontend work)
cd web && pnpm lint-fix

# storybook — the harness needs a full restart for main.ts / tailwind.config / dep changes
NODE_OPTIONS=--max-old-space-size=6144 pnpm --filter @agenta/storybook storybook

# parity + a11y
pnpm --filter @agenta/storybook vrt <story-id>   # per-story is the reliable signal
pnpm --filter @agenta/storybook a11y
```

**Reading a VRT number:** rank by absolute differing pixels, not ratio — the same ~146 pixels reads
4.66% on one crop size and 1.55% on another. Sub-2% on text is the antialiasing floor. A solid
block of colour is a real bug.

**Type-check gate:** `tsc | wc -l` fluctuates with build cache. The sound gate is "no error line
references a symbol I changed", which is cache-independent.

## Appendix C — working alongside other agents

This worktree has had two agents in it at once, and the same failure happened twice: a conclusion
computed against disk state that had already changed. A 29-diff VRT report was against a story
fixed three minutes later; a "the seam was deleted" report was a branch mid-surgery.

**`stat` your inputs at write-up time, not just at run time**, and when two of your own
measurements disagree, suspect the disk moved before you suspect the tool. Claim a directory before
you touch it.
