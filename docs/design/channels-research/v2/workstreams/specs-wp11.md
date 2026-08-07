# WP11 — Slack over the bridge

A differential test, not a second channel. WP6's Slack adapter is run twice
against the same real Slack install — once in process, once out of process
behind WP12's wire contract — and the two runs are held to the same
observable outcome. The in-process run **is** the expected output; there is
no independent oracle and none is needed, because both runs face the same
platform, the same events and the same capability declaration. Any observed
difference is therefore the bridge's or the contract's fault, never a
platform disagreeing with itself.

**What this buys and what it does not.** It proves the wire transport is
correct — signing, delivery, receipts, ordering, idempotency all survive a
round trip through HTTP and back. It proves **nothing** about whether WP2's
port shape generalises to a platform that is not Slack: a contract built and
verified against one platform can be shaped around that platform's quirks
without anyone noticing, since there is nothing here to disagree with it. The
studied platforms in `channels.md` disagree with each other enough —
tokenisation, visibility gating, threading, editing, identity scope — that
only a second *platform* behind the bridge, not a second *transport* of the
same platform, can expose that. That review is deferred to whichever
follow-up channel ships next; it is explicitly not this package's job.

## Files

New, under WP11's owned path (`tests/.../channels/differential/`, per
`workstreams/README.md`):

- `tests/.../channels/differential/harness.py` — drives one Slack install
  through both adapters and records observable outcomes from each
- `tests/.../channels/differential/fixtures.py` — the shared event fixtures
  (mention, follow-up, button click, backfill-eligible thread, degraded
  rendering case) fed identically to both runs
- `tests/.../channels/differential/assertions.py` — the equivalence
  assertions: same thread, same content, same edit-in-place, same
  capability-driven degradation, same refusal text
- `tests/.../channels/differential/test_parity.py` — the test cases
  themselves, one per scenario in `fixtures.py`

No file outside `tests/.../channels/differential/` is edited by this
package. This package does not modify WP6 or WP12's code directly — a
divergence found here is reported and fixed by whichever of those two owns
the file at fault, per `workstreams/README.md`'s ownership table, even
though the fix lands in this package's own PR discussion. (In practice: WP11
patches WP6/WP12 files only if governance allows a single cross-owned
commit at this checkpoint; otherwise it opens the fix as a dependent PR
against the owning package. Either way, nothing is ever accommodated in the
harness — see "Contracts this package must honour.")

## Interfaces

The harness treats both adapters as `ChannelAdapterInterface` implementations
and drives each through the **same** call sequence:

1. Deliver an identical inbound event (mention, follow-up message, button
   click) to both — one path through WP6's in-process adapter directly, one
   path through WP12's bridge wire fronting the same WP6 adapter code running
   as the bridge process.
2. Observe the outbound result from both: which thread received a reply,
   what content was posted, whether an existing message was edited versus a
   new one created, how an over-limit approval or over-length message
   degraded, and what refusal text (if any) was produced.
3. Assert the two observations are the same under `assertions.py`.

The harness does not invent a third representation of "correct" — it
compares the in-process adapter's own recorded outcome, taken directly, as
the fixture the bridged run must match.

## Contracts this package must honour

- **This is a differential test, and the in-process behaviour is the
  expected output.** The harness must never hardcode an independently
  reasoned "correct" answer for a scenario — it always derives the expected
  outcome by running the in-process adapter first and capturing what it
  actually did. A divergence is by definition the bridge's, because nothing
  else varies between the two runs.
- **A second platform is a different unknown and is out of scope here.**
  Running anything other than Slack behind the bridge in this package would
  conflate "is the contract wrong" with "is this platform simply different,"
  which is exactly the confusion a first bridge cannot afford (`plan.md`
  WP11, `contract.md` §7). This package tests Slack, only Slack, twice.
- **Every difference found must be fixed in the bridge or the contract,
  never accommodated in the harness.** If the bridged run diverges from the
  in-process run, the fix is a change to WP12's envelope, signing, or
  delivery logic, or to `contract.md` itself if the wire shape cannot express
  what the in-process adapter did — never a special case in `assertions.py`
  that treats the two outcomes as equivalent when they were not. Loosening
  an assertion to make a divergence pass is the one failure mode this
  package exists to prevent.
- **State plainly what this does not buy.** This package's own test report
  and any documentation it produces must say, in the same breath as "parity
  achieved," that the port's generality was not exercised — one platform
  over two transports has met one platform (`contract.md` §7). This is not
  a caveat to bury; it is why `contract.md` stays unpublished after this
  package is done (WP12's own checkpoint condition).

## Tests

("Tests" here are the differential scenarios themselves — this package's
entire deliverable is a test suite.)

- **Same thread.** A mention in a Slack thread produces a reply in that same
  thread under both adapters; a follow-up without re-addressing lands in the
  same thread under both.
- **Same posted content.** The text (and any structured parts) of the reply
  match byte-for-byte between the in-process and bridged runs, modulo
  nothing — no allowance for "close enough."
- **Same edit-in-place.** A turn that posts an indicator and later edits it
  into the final answer produces exactly one edited message under both
  adapters, never a stray second message under either.
- **Same capability-driven degradation.** An approval exceeding
  `buttons.max` degrades to numbered text identically under both; a message
  exceeding `max_chars` splits identically under both.
- **Same refusal text.** A backfill refusal, a grant refusal, and an
  unavailable-agent refusal each produce identical wording under both
  adapters (D17 — one sentence, indistinguishable across causes, and that
  indistinguishability itself must survive the bridge).
- **Idempotency survives the wire.** A simulated retry of one delivery
  command does not double-post under the bridged run, matching the
  in-process run's single post.
- **Ordering survives the wire.** A backfilled batch delivered ahead of a
  live trigger in one thread arrives in the same order under both adapters.

## Out of scope

- Building the bridge transport itself (WP12) — this package only drives it.
- Building or modifying the Slack adapter's own behaviour (WP6) — this
  package only exercises it twice.
- Any assertion about a non-Slack platform, or about whether WP2's port
  would need to change for one — explicitly deferred to the first follow-up
  channel (`plan.md` "Not packages": "expect WP2 and WP5 to change; that is
  the follow-up working, not failing").
- Publishing `contract.md` externally — gated separately, and later, on a
  non-Slack channel shipping (WP12's own checkpoint condition).
- Load or scale testing of the bridge transport — this package asserts
  behavioural equivalence, not throughput.

## Checkpoint

WP11 feeds **C5 — the bridge is proved**, and runs *after* WP12 within that
checkpoint — it cannot start until WP12 exists to run WP6's adapter behind
(`plan.md`: "Ordered within the checkpoint, because WP11 runs WP6's adapter
behind WP12's wire and cannot start until it exists"). `plan.md`'s exit
condition for C5, quoted verbatim:

> the bridged Slack adapter and the in-process one are observationally
> indistinguishable on the same install — same thread, same content, same
> edit-in-place, same degradation, same refusal text. Every difference found
> was fixed in the bridge or the contract, never accommodated in the
> harness.
>
> The contract is still not published here. That waits on a non-Slack
> channel, which is a follow-up rather than a package.

WP11's own done condition (`plan.md` WP11), quoted verbatim:

> the bridged adapter and the in-process adapter are observationally
> indistinguishable on the same Slack install, and every difference found
> has been fixed in the bridge or the contract rather than accommodated in
> the harness.
