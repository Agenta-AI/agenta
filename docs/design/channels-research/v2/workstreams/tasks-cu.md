# CU tasks — clean-up before wave 3

Two `findings.md` items that no work package owns, done in `channels-c2` before any
wave-3 worktree is launched. Everything here is a checkpoint edit: a collision file,
a cross-cutting sweep, or both.

**Order:** CU-1 (wiring) before CU-2 (comments), because CU-1 adds code that CU-2
then reviews. Both before fan-out.

**Verify with the canonical configuration only:**
`load-env hosting/docker-compose/ee/.env.ee.dev`, then `py-run-tests` /
`ts-run-tests` from the repo root. A result measured under a hand-set env is not
evidence.

---

## CU-1 — `F1`: wire the entrypoints

The merged tree has an ingress that logs events, a dispatcher that would route
them, a worker that would answer, and an adapter that could talk to Slack. None
are connected. WP4, WP5 and WP8 each produced their edit and handed it back
verbatim, as instructed; nobody applied them.

**The verbatim diffs are in the wave-2 agent reports, not in the repo.** They are
not recoverable from a later session's context — re-derive each edit from the code
rather than trusting a remembered diff, and treat the three facts below as the
things that must end up true.

### Current state, verified

- `api/entrypoints/routers.py:1058` — `ChannelAdapterRegistry(adapters={})`. **The
  registry is empty**, so `registry.get("slack")` raises `ChannelNotSupported`
  today. WP6's adapter exists and is unreachable.
- `api/entrypoints/routers.py:1071` — `dispatch_task=None`. Nothing enqueues an
  inbound event, so the ingress writes a row and stops.
- `api/entrypoints/worker_queues.py:311-314` — the broker map has four entries
  (`webhooks`, `triggers`, `interactions`, `evaluations`) and no channels entry.
  Neither the inbox nor the outbox worker is consumed.

### Tasks

- [ ] Register the Slack adapter into `channels_adapter_registry` (or construct the
  registry with it). Confirm `registry.get("slack")` resolves after the change.
- [ ] Build the channels-inbox producer broker and set
  `channels_ingress.dispatch_task` to the inbox worker's dispatch entry point.
  Mirror the `_triggers_dispatcher` / `_triggers_worker` block already in this
  file — do not invent a new pattern.
- [ ] Build the channels-outbox producer broker and construct the outbox worker.
- [ ] Add `_build_channels_inbox_broker()` and `_build_channels_outbox_broker()` to
  `worker_queues.py`, and register both in the broker map beside the existing four.
  Use `TrimOnAckRedisStreamBroker` and `stable_consumer_name(...)` as
  `_build_triggers_broker` does.
- [ ] Confirm every `MAXLEN_QUEUES_*`-style constant the new brokers need exists;
  add it where the others live rather than inlining a literal.
- [ ] Apply the three edits **serially**, verifying after each: WP4's inbox first
  (it defines the dispatch task WP3's router consumes), then WP5's outbox, then
  WP8's router registration.
- [ ] WP8's configuration router must be mounted. Check the OpenAPI schema, **not**
  `app.routes` — FastAPI defers expansion behind `_IncludedRouter`, so `app.routes`
  will not show an included router.
- [ ] Confirm nothing was added to `_PUBLIC_ENDPOINTS`. WP8's routes are
  authenticated; only WP3's literal per-channel ingress paths belong there.
- [ ] Fix the catalog path while in this file if it is the cheaper moment (`F10`:
  `specs-wp8.md` says `/catalog/channels/`, `entities.md` §9 says `/catalog/`, and
  the router already mounts under `/channels` — so the spec's version reads
  `/channels/catalog/channels/`). If it turns out to be more than a one-line
  change, leave it and say so.

### Done when

- [ ] `registry.get("slack")` resolves; `dispatch_task` is not `None`; the broker
  map has channels entries.
- [ ] WP8's routes appear in the OpenAPI schema.
- [ ] Canonical run green: api unit / integration / acceptance, sdk, services. The
  one known error is `unit/sessions/test_turns_dao.py` (`F14`, arrived from main,
  passes in isolation) and the 19 runner failures (`F21`).
- [ ] **An end-to-end path exists for the first time.** Say plainly in the report
  whether it was actually exercised or only wired — "wired" is not "works", and
  claiming the latter without evidence is the failure mode this project keeps
  hitting.

---

## CU-2 — `F25`: the comment sweep

77 comment lines document the *project* rather than the code. Useful while packages
were built in isolation; noise now, and false in places.

Scope: `api/oss/src/core/channels/`, `api/oss/src/dbs/postgres/channels/`,
`api/oss/src/apis/fastapi/channels/`, `api/oss/src/tasks/{asyncio,taskiq}/channels/`,
plus the channels test files.

### Rules

- [ ] **Design-process identifiers → drop.** `WP4`, `WP7`, `(F18)`, `(D17)`, `(D9)`,
  `§2.4`. Where the comment states a real constraint, **keep the constraint and drop
  the citation** — do not delete the sentence with the reference.
- [ ] **Stale dev/test state → drop.** Two known:
  `core/channels/service.py:46` ("a module that does not exist yet in this
  worktree") and `apis/fastapi/channels/ingress.py:20` ("WP1's service and WP2's
  registry — not yet implemented in this worktree"). Both modules are merged in the
  same tree; both comments are now false. CU-1 may make more of these stale — sweep
  after it, not before.
- [ ] **Fixed-bug commentary → keep the mechanism, drop the story.** "the ingress
  wrote this row before any space existed; attach it now" earns its place. "(F18).
  Before the refusal paths below" does not.
- [ ] **Verbose comments restating the code → drop or trim to one line.** House rule
  is one terse line; rationale belongs in the PR or in `findings.md`.
- [ ] Test docstrings are in scope. A docstring naming the package that wrote the
  test ages the same way the source comments do.

### Done when

- [ ] No `WP\d`, `(F\d`, `(D\d` or `§` citation remains in channels source or tests.
  Grep for each and report the count as zero rather than asserting it.
- [ ] No comment claims something is unimplemented, absent, or "not yet" when it is
  present in the tree.
- [ ] Canonical run still green — a comment sweep should change no behaviour, so any
  test that moves is a signal something real was deleted.

---

## After CU: fan out

Six worktrees already exist at `2cbdeba3e8`, `origin` only, baseline verified
(259 channels unit tests pass with nothing running).

**They branch from before CU.** Once CU-1 and CU-2 land in `channels-c2`, either
fast-forward each worktree onto the new head or note that C3's merge absorbs the
difference — do not launch six agents against a tree that lacks the wiring their
work assumes.

| Order | Worktree | Package |
| --- | --- | --- |
| 1 | `channels-wp15` | Mock channel |
| 2 | `channels-wp16` | Slack over mock (needs WP15's technique) |
| — | `channels-wp0` | Session events |
| — | `channels-wp9` | Commands |
| — | `channels-wp10` | Fill |
| — | `channels-wp13` | Web app |

WP15 → WP16 is ordered; the other four are independent. Every agent reads
`c1-merge-notes.md` first, stays inside its owned paths, writes back verbatim any
edit it cannot make, and records the interface it asserted whenever it faked a
collaborator — **even when its tests pass**.

## Then C3

Merge all six into a `channels-c3` worktree, resolve the seams, get the canonical
run green, and only then hand back for deployment. The three C1 defects and the
four found on C2's first integration run were all seam defects invisible to a green
per-package suite; expect the same shape and look for it deliberately.
