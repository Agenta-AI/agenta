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

- [x] Every symbol each package introduced, grepped for callers **outside its own
      module**. All reached.
- [x] The Agenta adapter reaches every composition root. **One** construction of
      `ChannelAdapterRegistry` exists in the tree — the factory — so no root can
      drift again.
- [x] `_PUBLIC_ENDPOINTS` carries all four spellings of `/channels/agenta/events/`.
- [x] The connections routes are registered — six of them, on the channels router.

      **Limit, not a pass:** `routers.py` pins a container path for its alembic
      config, so the composition root cannot be imported outside Docker. Route
      *mounting* is therefore evidenced by the router-level tests plus the
      deployment, not by anything runnable here. Worth stating rather than implying
      a stronger check than was made.
- [x] The outbox still consumes session events and `poll_turn` is still absent.
- [x] `grep -rn "agenta"` across `ingress.py` and `tasks/asyncio/channels/` returns
      only the route registration — five lines, all of it the route. `_ingest` has
      no channel-specific branch.

### Seams

- [x] WP22 and WP23 agree on the connection DTO. Create composes `external_key`
      *before* extracting the recorded locator, so the two cannot disagree, and the
      missing-field path raises a domain error rather than a `KeyError`.
- [x] WP24's read route and WP25's poller agree on the payload shape — field for
      field, including the direction literals. The **request** seam agrees too: the
      surface posts `project`/`bot`/`user`/`text`, and the adapter reads the first
      two in `connection_locator` and the last two in `parse_event`.
- [x] The contract suite passes against all four adapters, built as the composition
      root builds them — and now derives its identity fixtures from each adapter's
      own declared field names, which is what makes that claim mean anything.

### What CU-B found

- [x] **Two web pages were reading fields the API had stopped returning.** The
      connection response changed shape mid-wave and no web consumer was updated, so
      the settings page showed a blank channel and a blank installation column. A
      third bug sat beside them: the status column read a flag that does not exist,
      so it was always false.
- [x] **The new surface could not render a real answer.** It was built from the
      design's node vocabulary, and the API emits a different one. Fixed at the
      consumer; the divergence itself is filed, because it is the more serious half.
- [x] Suites green on the merged base: **2670 API unit, 276 web unit**, 0 xfailed.
      Integration and acceptance are written and unrun — they need the deployment.

---

## CU-C — what the deployment finds

The first integration run against a real stack found four defects last time. Budget
for it.

- [x] Integration suite against the deployed stack: **59 pass**, after four
      failures. One was a real defect — the default-grant index was declared over
      two nullable columns, so a second default agent in one space did not collide.
      Three were test defects, one of them the enum name-versus-value confusion an
      earlier checkpoint had already recorded once.
- [x] Acceptance suite: **12 pass, 3 skip, 1 fail**, after five failures. Two more
      real defects: a grain fed to the session-scope vocabulary, which raised for
      any platform without threads before the clamp built for that case could run;
      and the bridge calling its one identity by two names, storing it outside the
      recorded locator so the ownership check could never match.
- [ ] **The C5 exit condition is NOT demonstrated.** The end-to-end check never
      configures an agent or a grant, so nothing routes and no answer is ever
      posted. Verified against the real stack up to that point: the connection
      write path, the public ingress answering 202 on an API key alone, and a space
      created on first contact with no pre-created row. From the invoke onward,
      nothing has run.
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
