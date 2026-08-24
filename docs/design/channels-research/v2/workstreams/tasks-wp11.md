# WP11 tasks — Slack over the bridge

## Fixtures

- [ ] Build the mention fixture: an addressing event in a Slack thread with
  no prior history.
- [ ] Build the follow-up fixture: a second message in the same thread with
  no re-addressing.
- [ ] Build the button-click fixture: an approval interaction resolved by a
  click.
- [ ] Build the backfill-eligible fixture: a thread with prior messages
  predating the first addressing, against an install with `channels:history`
  granted.
- [ ] Build the backfill-refused fixture: the same shape, against an install
  with the permission denied.
- [ ] Build the over-limit approval fixture: more options than
  `buttons.max`.
- [ ] Build the over-length message fixture: content exceeding `max_chars`.
- [ ] Build the unavailable-agent fixture: a sigil naming a slug that does
  not exist, one that exists but is ungranted, and one that is not on the
  connection's roster — three fixtures, one per D17 cause.
- [ ] Build the retry-delivery fixture: the same outbound command delivered
  twice to simulate at-least-once transport behaviour.
- [ ] Build the ordering fixture: a backfilled batch and a live trigger for
  the same thread, delivered out of wall-clock order.

## Harness

- [ ] Implement `harness.py`'s in-process run: drive WP6's `SlackAdapter`
  directly against a fixture and record the observable outcome (thread,
  content, edit-vs-new, degradation applied, refusal text).
- [ ] Implement `harness.py`'s bridged run: drive the same fixture through
  WP12's bridge wire, fronting the same underlying Slack adapter code
  running as the bridge process, and record the same observable shape.
- [ ] Implement the recording format so both runs produce directly
  comparable structures — no adapter-specific fields that would need
  translation before comparison.

## Assertions

- [ ] Implement `assertions.py`'s thread-identity check.
- [ ] Implement `assertions.py`'s content-equality check (exact, no fuzzy
  matching).
- [ ] Implement `assertions.py`'s edit-vs-new check (exactly one message,
  edited, never a stray second post).
- [ ] Implement `assertions.py`'s degradation-equality check (buttons vs.
  numbered text, split vs. unsplit).
- [ ] Implement `assertions.py`'s refusal-text equality check across all
  three D17 causes.
- [ ] Implement `assertions.py`'s idempotency check (no double-post on
  retry).
- [ ] Implement `assertions.py`'s ordering check (per-thread order
  preserved across the wire).

## Run and reconcile

- [ ] Run every fixture through both adapters via the harness.
- [ ] For each divergence found: identify whether the fault is in WP12
  (transport, envelope, signing, idempotency, receipt) or in `contract.md`
  itself (the wire shape cannot express what the in-process adapter did).
- [ ] File and track each divergence as a fix against WP12's owned files or
  as a proposed `contract.md` change — never as a change to
  `assertions.py`'s equivalence definition.
- [ ] Re-run the full fixture set after each fix until every scenario passes
  with no loosened assertion.

## Report

- [ ] Record, alongside the passing suite, an explicit statement that
  generality was not exercised — one platform, two transports — and that
  `contract.md` remains unpublished pending a non-Slack channel (this is a
  statement to carry forward into WP12's own checkpoint record, not a
  finding this package can resolve itself).

## Definition of done

Restating `plan.md` WP11's exit condition verbatim: **the bridged adapter
and the in-process adapter are observationally indistinguishable on the same
Slack install, and every difference found has been fixed in the bridge or
the contract rather than accommodated in the harness.**
