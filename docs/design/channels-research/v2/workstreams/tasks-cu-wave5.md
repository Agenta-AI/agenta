# Wave 5 — clean-up ledger

Three phases, per [wave5.md](wave5.md). Clean-up work belongs to no package and is
done at the checkpoint, not in a worktree.

The history justifies all three: 13 of this project's findings came from clean-up
and verification phases against 14 from the packages themselves.

---

## CU-A — before any package

### The guards that lie

Each reads as coverage it does not provide. Packages get written against them, so
these come first.

- [x] **`F42`** — `worker_queues.py`'s adapter registry never got the mock adapter.
      **Fixed at the cause:** three composition roots each built the registry by
      hand, so one factory now builds it for all three and a new adapter is one
      edit rather than three.
- [x] **`F43`** — `worker_queues.py` builds a `channels-outbox` queue with no
      producer. **Removed**, along with the task worker that registered no task;
      the outbox rides the session-turn stream. No env file names the queue
      explicitly, so nothing selects a queue that no longer exists.
- [x] **`F50`** — `space_locator` and `thread_locator` were written by every adapter
      and read by no production code. **Deleted.** Key composition takes the
      declared subset of the *one* locator per grain, which is what makes a
      per-grain locator redundant by construction rather than merely unused.
- [x] **`F28`** — backfilled events all carried the request's locator rather than
      their own. **Fixed**, and the ledger's framing of it was wrong: this is not a
      bug in a field nothing reads. `external_locator` *is* read, so a thread reply
      returned by a space-level read composed to the space's thread key instead of
      its own. Two tests asserted the defect as intended behaviour and now assert
      the fix; the fake workspace learned to stamp a thread parent the way the
      platform does, without which the fix has no way to fail.
- [ ] **`F48`** — the keyword-only AST check walks `ast.AsyncFunctionDef` only and
      asserts `checked == 7`. The interface has eight abstract methods; the one sync
      method is invisible to it. Walk `FunctionDef` too and derive the count from
      `__abstractmethods__`. **Moved to WP21**, which owns the file and changes the
      method set in the same pass.
- [ ] **The normaliser is bypassed**, and **Slack declares `text.max_chars: 4000`**
      where `capabilities.md` specifies 3000. **Moved to WP21** for the same reason:
      it owns `normalise.py` and the Slack declaration, and its task list already
      carries both. Doing them here would be an edit to a file a package owns.

### The reconciliation debt

Package specs are written from these documents. The last round of designing started
from stale premises for exactly this reason, so this is a prerequisite rather than
tidying.

- [x] `entities.md` §1 — says the connection is reused and takes no
      channels-specific columns. Superseded by `channel-connections.md`.
- [x] `entities.md` §2.5 — grants are instance-level only. Superseded by `grants.md`.
- [x] `provisioning.md` — credentials encrypted on the connection; the Slack setup
      shape assumed throughout. Corrected by `journeys.md` §0.
- [x] `capabilities-v2.md` §1 — the credential schema as a new field-list mechanism.
      The nested secret kind already is the stored contract.
- [x] `architecture.md` §8.1 — *"there is no shared vendor app to compromise"*.
      **Rewritten**, not annotated: it now states the posture of each installation
      model separately and says what the hosted app costs.

### What the reconciliation found

- [x] **WP0 is done and wave 5 said it was not.** The publish calls, the stream
      consumer and the outbox's turn-event handler are all merged, wired in the
      stream entrypoint, and `poll_turn` does not exist anywhere in the tree.
      Dropped from the wave; the merge graph loses a branch.

---

## CU-B — after the final merge (M4), before deploy

### Reachability

Green merges have hidden four disconnections twice. A passing suite is not evidence
that two packages meet.

Intermediate merges (M1–M3) each checked their own package's new symbols. This phase
checks the **seams**, which could not be checked before both sides had landed.

- [ ] Every symbol each package introduced, grepped for callers **outside its own
      module**.
- [ ] The Agenta adapter reaches every composition root. One factory now builds the
      registry, so this is a check that WP24 edited that factory rather than any
      root — a root that builds its own registry again is the regression.
- [ ] `_PUBLIC_ENDPOINTS` carries all four spellings of
      `/channels/agenta/events/`.
- [ ] The connections routes are mounted and reachable.
- [ ] The outbox still consumes session events and `poll_turn` is still absent —
      inherited from wave 3, so this is a regression check, not a deliverable.
- [ ] `grep -rn "agenta"` across `ingress.py` and `tasks/asyncio/channels/` returns
      only the route registration.

### Seams

- [ ] WP22 and WP23 agree on the connection DTO — one wrote it, the other consumes
      it.
- [ ] WP24's read route and WP25's poller agree on the payload shape.
- [ ] The contract suite still passes against all four adapters after WP21's change,
      built as the composition root builds them.

---

## CU-C — what the deployment finds

The first integration run against a real stack found four defects last time. Budget
for it.

- [ ] Acceptance suite against the deployed stack.
- [ ] The C5 exit condition, run by hand: create a bot, open a conversation, send,
      read the answer, click a choice. No platform credentials.
- [ ] **Diagnostic, not a gate:** create a Slack connection through WP23's generic
      write path with real credentials and DM the bot. Grants by kind land in WP22,
      so a DM should resolve for the first time. If Slack is broken in some new way,
      wave 6 learns it before building a setup UI on top.
- [ ] Anything found here that outlives the wave goes to `review-findings.md` with
      file and line, not into this ledger.

---

## Reached

C5 is reached when the four conditions at the end of [wave5.md](wave5.md) hold —
demonstrated on the merged base, not reported by the packages.
