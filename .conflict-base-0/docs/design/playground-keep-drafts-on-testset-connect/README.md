# Keep playground draft rows when connecting a test set

Planning workspace for fixing the UX where draft test cases in the playground
(opened from a trace, or created manually) are silently destroyed when the user
connects a test set.

## Files

- [context.md](context.md): why this work exists, the reported UX issue, goals
  and non-goals.
- [research.md](research.md): codebase findings. The full data flow from trace
  to playground, the exact root cause of the silent data loss, the existing
  building blocks we can reuse, and the caveats (chat mode, empty initial row,
  column mismatches).
- [plan.md](plan.md): proposed fix, UX flow, implementation phases, and test
  plan.
- [status.md](status.md): current progress and open decisions. Source of truth
  for where the work stands.

## TL;DR

When the playground is in local mode (not connected to a test set) and holds
draft rows, "Connect test set" replaces those rows with the selected test set
with no warning. The guard modal that exists for "Change test set" never fires
because (a) the not-connected menu path skips it and (b) the `hasLocalChanges`
selector returns `false` by design when not connected.

The fix: detect meaningful local draft rows at connect time, ask the user
whether to keep them, and on "keep" connect to the test set then re-import the
captured rows as unsaved additions. The existing `importRows` + `commitChanges`
machinery already supports "unsaved rows on top of a connected test set, then
sync back", so no new persistence logic is needed.
