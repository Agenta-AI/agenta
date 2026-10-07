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

**Status: done.** Four gaps, not three — see `F1` (closed) for the as-built record.

### Current state, verified

- `api/entrypoints/routers.py:1058` — `ChannelAdapterRegistry(adapters={})`. **The
  registry is empty**, so `registry.get("slack")` raises `ChannelNotSupported`
  today. WP6's adapter exists and is unreachable.
- `api/entrypoints/routers.py:1071` — `dispatch_task=None`. Nothing enqueues an
  inbound event, so the ingress writes a row and stops.
- `api/entrypoints/worker_queues.py:311-314` — the broker map has four entries
  (`webhooks`, `triggers`, `interactions`, `evaluations`) and no channels entry.
  Neither the inbox nor the outbox worker is consumed.
- **A fourth gap, not in `F1`'s original description:** `ChannelsRouter` — WP8's
  entire configuration surface — was never imported or mounted. Only
  `ChannelsIngressRouter` was.

### Tasks

- [x] Register the Slack adapter into `channels_adapter_registry` (or construct the
  registry with it). Confirm `registry.get("slack")` resolves after the change.
- [x] Build the channels-inbox producer broker and set
  `channels_ingress.dispatch_task` to the inbox worker's dispatch entry point.
  Mirror the `_triggers_dispatcher` / `_triggers_worker` block already in this
  file — do not invent a new pattern.
- [x] Build the channels-outbox producer broker and construct the outbox worker.
- [x] Add `_build_channels_inbox_broker()` and `_build_channels_outbox_broker()` to
  `worker_queues.py`, and register both in the broker map beside the existing four.
  Use `TrimOnAckRedisStreamBroker` and `stable_consumer_name(...)` as
  `_build_triggers_broker` does.
- [x] Confirm every `MAXLEN_QUEUES_*`-style constant the new brokers need exists;
  add it where the others live rather than inlining a literal.
- [x] Apply the three edits **serially**, verifying after each: WP4's inbox first
  (it defines the dispatch task WP3's router consumes), then WP5's outbox, then
  WP8's router registration.
- [x] WP8's configuration router must be mounted. Check the OpenAPI schema, **not**
  `app.routes` — FastAPI defers expansion behind `_IncludedRouter`, so `app.routes`
  will not show an included router.
- [x] Confirm nothing was added to `_PUBLIC_ENDPOINTS`. WP8's routes are
  authenticated; only WP3's literal per-channel ingress paths belong there.
- [x] Fix the catalog path while in this file if it is the cheaper moment (`F10`:
  `specs-wp8.md` says `/catalog/channels/`, `entities.md` §9 says `/catalog/`, and
  the router already mounts under `/channels` — so the spec's version reads
  `/channels/catalog/channels/`). If it turns out to be more than a one-line
  change, leave it and say so.
  **Left as-is:** it is not a one-line change in this file. The path is built in
  `apis/fastapi/channels/router.py` (WP8's file, two routes), so fixing it here
  is impossible and fixing it there is a spec decision, not a wiring edit. `F10`
  stays open; the schema now confirms the doubled segment
  (`/channels/catalog/channels/`) rather than inferring it.

### CU-1 done when

- [x] `registry.get("slack")` resolves; `dispatch_task` is not `None`; the broker
  map has channels entries.
- [x] WP8's routes appear in the OpenAPI schema. 22 channels paths, up from the 2
  ingress routes.
- [x] Canonical run green: api unit / integration / acceptance, sdk, services. The
  one known error is `unit/sessions/test_turns_dao.py` (`F14`, arrived from main,
  passes in isolation) and the 19 runner failures (`F21`).
- [x] **An end-to-end path exists for the first time.** Say plainly in the report
  whether it was actually exercised or only wired — "wired" is not "works", and
  claiming the latter without evidence is the failure mode this project keeps
  hitting.
  **Wired, not exercised.** No message has travelled the path. The evidence is
  structural: the registry resolves, the dispatch task is a real
  `AsyncTaskiqDecoratedTask`, both queues exist, the routes are in the schema.
  Nothing here proves a Slack event produces a reply — that needs a deployment
  and a real event, or WP15/WP16's harnesses.

---

## CU-2 — `F25`: the comment sweep

**Status: done.** Zero citations remain in channels source and tests; the unit layer
is unchanged at 2344 passed / 52 skipped.

77 comment lines document the *project* rather than the code. Useful while packages
were built in isolation; noise now, and false in places.

Scope: `api/oss/src/core/channels/`, `api/oss/src/dbs/postgres/channels/`,
`api/oss/src/apis/fastapi/channels/`, `api/oss/src/tasks/{asyncio,taskiq}/channels/`,
plus the channels test files.

**Measured, not estimated: 109 citation lines across 43 files.** The 77 above counted
source only; the test tree carries the rest, and a test docstring naming the package
that wrote it ages exactly the way a source comment does.

**Verify comment-only by AST, not by reading the diff.** Parse each file before and
after, strip docstring nodes, compare. A sweep that "only touched comments" is a claim
worth mechanising — docstrings are AST nodes, so a naive AST compare flags them and a
naive diff read misses a real edit buried in reflowed prose.

### Rules

- [x] **Design-process identifiers → drop.** `WP4`, `WP7`, `(F18)`, `(D17)`, `(D9)`,
  `§2.4`. Where the comment states a real constraint, **keep the constraint and drop
  the citation** — do not delete the sentence with the reference.
- [x] **Stale dev/test state → drop.** Two known:
  `core/channels/service.py:46` ("a module that does not exist yet in this
  worktree") and `apis/fastapi/channels/ingress.py:20` ("WP1's service and WP2's
  registry — not yet implemented in this worktree"). Both modules are merged in the
  same tree; both comments are now false. CU-1 may make more of these stale — sweep
  after it, not before.
- [x] **Fixed-bug commentary → keep the mechanism, drop the story.** "the ingress
  wrote this row before any space existed; attach it now" earns its place. "(F18).
  Before the refusal paths below" does not.
- [x] **Verbose comments restating the code → drop or trim to one line.** House rule
  is one terse line; rationale belongs in the PR or in `findings.md`.
- [x] Test docstrings are in scope. A docstring naming the package that wrote the
  test ages the same way the source comments do.

### CU-2 done when

- [x] No `WP\d`, `(F\d`, `(D\d` or `§` citation remains in channels source or tests.
  Grep for each and report the count as zero rather than asserting it.
- [x] No comment claims something is unimplemented, absent, or "not yet" when it is
  present in the tree.
- [x] Canonical run still green — a comment sweep should change no behaviour, so any
  test that moves is a signal something real was deleted.
  Unit layer identical before and after: 2344 passed, 52 skipped.

### What the sweep turned up

Two files were **not** comment-only, and the AST check is what caught them — both
legitimate, because the citation sat inside a string the code evaluates: a Slack
message body in the live acceptance test, and an assertion message in the contract
suite. A diff read would have skipped past both.

It also found a real defect by reading rather than by testing: `F28`, where
`fetch_history` gives every backfilled event the *request's* locator instead of
deriving one per message. That is `WP10`'s ground, so it is in that package's
coordination points now rather than waiting for C4.

Two design docs disagreed with the tree and were corrected: `launch.md` still had a
section headed "WP0 — not ours", and `plan.md` still described `F1` as three held
diffs when it was four gaps.

---

## After CU: fan out

**Done.** All six fast-forwarded to `d2bb2f0b6c` (CU-1 + CU-2), `origin` only,
baseline re-verified after the move: 259 channels unit tests pass with nothing
running.

They had branched from `2cbdeba3e8`, before CU. Launching six agents against a
tree lacking the wiring their work assumes would have wasted the wave, so the
fast-forward is a precondition, not a tidy-up.

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
