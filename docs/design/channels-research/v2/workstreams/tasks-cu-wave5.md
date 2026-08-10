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

- [ ] **`F48`** — the keyword-only AST check walks `ast.AsyncFunctionDef` only and
      asserts `checked == 7`. The interface has eight abstract methods; the one sync
      method is invisible to it. Walk `FunctionDef` too and derive the count from
      `__abstractmethods__`.
      *(WP21 owns the file; if WP21 has started, it lands there instead.)*
- [ ] **`F42`** — `worker_queues.py`'s adapter registry never got the mock adapter.
      Three composition roots drift independently; check all three.
- [ ] **`F43`** — `worker_queues.py` builds a `channels-outbox` queue with no
      producer.
- [ ] **The normaliser is bypassed.** `normalise_capabilities` documents itself as
      "one function, one place this logic exists" and only the bridge calls it.
      Slack's `fetch_slack_capabilities` does `model_validate` direct, so its
      declaration is never clamped.
- [ ] **Slack declares `text.max_chars: 4000`**, where `capabilities.md` specifies
      3000 — 4000 is client-side guidance, 3000 is the enforced Block Kit ceiling and
      what the renderer must respect. Fix with the normaliser item above.
- [ ] **`F50`** — `space_locator` and `thread_locator` are written by every adapter
      and read by no production code; only tests touch them. Decide: carry them into
      `data` and compose per grain from their own locator, or delete them.
- [ ] **`F28`** — backfilled events all carry the request's locator rather than their
      own. This is a bug *in* a field nothing reads, so fixing it changes nothing
      observable until `F50` is settled. **Resolve `F50` first**, then this.

### The reconciliation debt

Package specs are written from these documents. The last round of designing started
from stale premises for exactly this reason, so this is a prerequisite rather than
tidying.

- [ ] `entities.md` §1 — says the connection is reused and takes no
      channels-specific columns. Superseded by `channel-connections.md`.
- [ ] `entities.md` §2.5 — grants are instance-level only. Superseded by `grants.md`.
- [ ] `provisioning.md` — credentials encrypted on the connection; the Slack setup
      shape assumed throughout. Superseded by `journeys.md` §0.
- [ ] `capabilities-v2.md` §1 — the credential schema as a new field-list mechanism.
      The nested secret kind already is the stored contract.
- [ ] `architecture.md` §8.1 — *"there is no shared vendor app to compromise"*. There
      will be one; the posture must state what is true of **each** model rather than
      claiming the stronger one for both.

A supersession note at the top of each is the minimum. A rewrite is better where the
document is short.

---

## CU-B — after the final merge (M4), before deploy

### Reachability

Green merges have hidden four disconnections twice. A passing suite is not evidence
that two packages meet.

Intermediate merges (M1–M3) each checked their own package's new symbols. This phase
checks the **seams**, which could not be checked before both sides had landed.

- [ ] Every symbol each package introduced, grepped for callers **outside its own
      module**.
- [ ] The Agenta adapter registered in **every** composition root — `routers.py` and
      `worker_queues.py` both. `F42` is this same defect, already merged green once.
- [ ] `_PUBLIC_ENDPOINTS` carries all four spellings of
      `/channels/agenta/events/`.
- [ ] The connections routes are mounted and reachable.
- [ ] The outbox consumes session events; `poll_turn` is **gone**, not merely
      unused.
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
