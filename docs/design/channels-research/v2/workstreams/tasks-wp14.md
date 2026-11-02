# WP14 — Tasks

Owned by the runner team. This checklist covers the parts visible from
channels' side — confirming the current refusal, and the observable contract
the fix must preserve for WP4 — not the runner's internal implementation
choices, which are the runner owner's to sequence.

## Confirm the current behaviour

- [ ] Verify `SessionTurnInUse` is still raised at the two sites named in
      `specs-wp14.md` (`core/sessions/streams/service.py`'s `command()`
      fast-path and `_start_turn()` race-safe recheck) and still maps to HTTP
      409 in `apis/fastapi/sessions/router.py` — these citations are the
      starting point for the fix, and should be re-verified against current
      `main` before work begins, since this document does not own that file.

## Decide the mechanism (runner owner's call, not specified here)

- [ ] Choose queue-behind-the-running-turn, fold-into-the-running-turn, or a
      policy that picks between them. Record the choice and its rationale
      wherever the runner team keeps design decisions — this spec deliberately
      does not prescribe one.
- [ ] If queueing: define ordering (FIFO per session), and what a caller
      observes while queued (does the call block, return a queued-status
      response, or something else).
- [ ] If folding: define how a second submission's content is merged into a
      turn already in flight, and what the caller observes for its own turn
      identity if the fold means there is no longer a distinct one.

## Implement

- [ ] Replace the refusal at both `SessionTurnInUse` raise sites with the
      chosen sequencing behaviour.
- [ ] Preserve `force=True` (steer) semantics — cancelling the current holder
      and proceeding immediately — as a distinct path from the new
      queue/fold behaviour, since callers that want steer today must keep
      getting it.
- [ ] Remove or repurpose `SessionTurnInUse` and its 409 mapping once no code
      path raises it, or keep it for a narrower case if one remains (e.g. an
      explicit non-sequencing caller that still wants fail-fast).

## Verify the channels contract holds

- [ ] Run WP4's existing test suite unmodified against the fixed runner —
      the retry-on-refusal path should simply stop firing, with no assertion
      in WP4 changed to make this pass.
- [ ] Confirm a burst of mentions against one running turn is now sequenced
      rather than retried, and every mention is still processed exactly once
      (no drop, no duplicate) — the same guarantee WP4's retry loop provided,
      now provided earlier in the stack.
- [ ] Confirm no channels file is touched by this work. If a channels file
      needs to change to make this land, that is a signal the mechanism chosen
      leaked a decision into WP4 that belongs in the runner instead — stop and
      reconsider before merging.

## Definition of done

A submission arriving during a running turn is sequenced rather than refused,
and the caller does not have to retry to get it accepted. WP4 needs no revisit:
its retry-on-refusal code stops firing on its own and requires no code change
to keep passing its existing tests.
