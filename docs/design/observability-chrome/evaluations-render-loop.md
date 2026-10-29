# `/evaluations` render loop — diagnosis and fix plan

Status: diagnosed, not fixed. Branch `obs/wp6-mobile-observability` @ `7dfe8f9bbc`.

## Symptom

`/w/<ws>/p/<project>/evaluations` renders the shell then dies with React's
"Maximum update depth exceeded". The page is unusable — no table, no controls.

Reproduced in a real browser on EE (v0.112.0). Not seen on `/observability`,
which renders the same table stack, so whatever differs between the two pages is
part of the answer.

## Evidence

The console stack is the whole story:

```
dispatchSetState        ← a state setter fired
  setRef                ← from a ref callback
    (anonymous) …:2443  ← inside an Array.map
      setRef            ← composing another ref
        …repeating
```

`setRef` inside an `Array.map`, recursing, is Radix's `composeRefs`. So a
**composed ref callback is being rebuilt and re-invoked every render**, and one
of the refs in the chain sets state. That is a render loop by construction, not
a data problem: no query, atom, or effect appears anywhere in the trace.

## Prime suspect

`packages/agenta-ui/src/InfiniteVirtualTable/components/ColumnVisibilityTrigger.tsx`
around lines 115-120:

```tsx
<Popover open={open} onOpenChange={setOpen}>
    <SimpleTooltip title={...}>
        <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
    </SimpleTooltip>
    …
```

Two `asChild` layers (`SimpleTooltip`, then `PopoverTrigger`) collapse onto one
button, so Radix composes both refs onto the same node. The existing comment
states this is deliberate — "each `asChild` clones down to the same button, so
both sets of handlers compose onto it" — which is exactly the arrangement that
loops if any link in the chain does not forward its ref: Radix rebuilds the
composed ref each render, React detaches and reattaches, the setter fires again.

CodeRabbit flagged this same line independently on PR #5961 ("Forward refs
through composed tooltip triggers"), reasoning that `PopoverTrigger` and
`DropdownMenuTrigger` do not forward refs under React 18. Two independent
routes to the same location is the strongest signal we have.

## Why it appeared now

The bug is older than this stack; the code path is new. Deleting the antd
`<Table>` branch (`InfiniteVirtualTableInner`) means every consumer now renders
`VirtualTable` and its chrome, including this trigger. Nothing about the trigger
changed — it simply became reachable on pages that previously took the antd
branch.

This also predicts the `/observability` vs `/evaluations` split: confirm which
page mounts `ColumnVisibilityTrigger` with a tooltip (`variant="icon"`) and
which does not.

## Step 1 — confirm before changing anything

Do not fix on the strength of a stack trace alone. Reproduce it in a test,
where the loop is a two-second signal instead of a page reload:

`packages/agenta-ui/tests/unit/ColumnVisibilityTrigger.render.test.tsx`

```tsx
// @vitest-environment jsdom
render(<ColumnVisibilityTrigger controls={controls} variant="icon" />)
// assert console.error carries no "Maximum update depth"
```

`controls` is required — the component destructures `controls.leafKeys`, so a
bare `<ColumnVisibilityTrigger />` throws a TypeError that looks like a pass.
Build a real one from `useColumnVisibilityControls`, or hand-roll the minimum
shape. `variant="icon"` matters: that is the branch that renders the tooltip.

A red test here confirms the diagnosis. A green one means the loop needs a
second component in the tree and the repro has to grow — start from whatever
`/evaluations` renders that `/observability` does not.

## Step 2 — pick the fix

**Option A: forward the ref through `SimpleTooltip`.** Correct if it is the
non-forwarding link. Narrow, keeps the current DOM, and fixes every other
nested-`asChild` use of the tooltip at once. Verify by reading `SimpleTooltip`
first — if it already forwards, A is not the answer and B is.

**Option B: stop nesting two `asChild` triggers.** Give the tooltip its own
wrapper element so only one Slot chain reaches the button. Structurally
guaranteed to break the loop and does not depend on any component's ref
behaviour, but adds a DOM node that can shift layout in an icon-sized control,
and loses the "both handler sets on one node" property the comment wanted.

Prefer A if `SimpleTooltip` turns out not to forward refs. Fall back to B only
if A cannot be made to work, and check the button's box afterwards.

Not acceptable: `key` churn, a `useMemo` around the trigger, or any change that
makes the loop merely less likely. The failure is structural.

## Step 3 — verify

1. the new unit test goes green
2. `/evaluations` loads in a browser and the console has no "Maximum update
   depth"
3. `/observability` still renders — same trigger, and the regression risk of a
   ref change lands there too
4. the column-visibility popover still **opens** on both, since that is what the
   trigger exists for. Note: Radix opens on `pointerdown`; a synthetic
   `.click()` will not open it and will read as a false failure
5. `pnpm lint-fix` and the package typechecks

## Blast radius

`ColumnVisibilityTrigger` is exported from `@agenta/ui/table` and rendered by
every table with column settings. A ref fix is low risk; the wrapper-element
fix changes DOM and wants a visual check on an icon-variant trigger.

## Open question worth settling on the way

The same nested-`asChild` shape may exist elsewhere. Once the fix is known,
grep for `asChild` inside `SimpleTooltip` across `web/packages` and fix the
class, not the instance.
