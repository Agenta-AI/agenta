# Context

## The reported UX issue

Reported by Mahmoud on 2026-06-09.

1. The user opens a trace in the playground (trace drawer > "Playground"
   button). The playground is linked to the application, and the trace inputs
   appear as a test case row. Functionally this is the same state as creating
   test cases manually in the playground: local draft rows, no connected test
   set.
2. The user then connects ("syncs") a test set from the Test set dropdown.
3. Expected: a modal asking whether to keep the playground test cases and add
   them (as unsaved rows) to the loaded test set, so the user can review them
   alongside the test set rows and later sync them back into the test set.
4. Actual: the playground silently replaces the draft rows with the test set
   rows. The trace-derived test case is lost with no warning.

## Why this matters

The trace-to-playground flow exists so users can take a real production input
and iterate on it. A natural next step is "add this interesting case to my
test set". Today that path destroys the case at the exact moment the user
tries to combine it with the test set. There is no undo.

## Goals

- Never silently destroy meaningful draft rows on test set connect.
- Offer "keep and add": connect the test set, append the previous draft rows
  as unsaved additions, and let the user sync them back via the existing
  "Sync changes" commit flow.
- Offer "discard": today's replace behavior, but explicit.
- Cover both trace-derived rows and manually created rows. The system does not
  distinguish them (see research.md), and the expectation is the same.

## Non-goals

- Changing the existing connected-mode "Change test set" guard
  (TestsetDisconnectConfirmModal). It already prompts with Save / Discard.
  Unifying the two prompts can come later.
- Changing the "Add to test set" drawer flow (trace > testset directly).
- Persisting kept rows automatically. Kept rows stay unsaved until the user
  syncs, by design ("temporarily added").
- Chat playground multi-row support. Chat mode has a deliberate single-row
  gate (see research.md); v1 keeps chat behavior as is.

## Related memory

The repo memory note "Recent Prompts green dots bug" is unrelated. No prior
planning doc covers this area; `docs/design/` has no playground testset doc.
