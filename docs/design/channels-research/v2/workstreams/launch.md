# Launch runbook

How the packages actually get started in parallel. `README.md` says who owns what;
this says what to run, in what order, and what to check before moving on.

Everything here targets the **first checkpoint (C1)**. Later waves follow the same
shape and are not pre-planned in detail, because C1's outcome changes them.

## Before anything starts

**C0, the seed commit, is not parallel work.** One person or one agent writes it,
on the base branch, and everything else waits for it. It is small — declarations
only — and it is the reason nothing else has to wait afterwards.

- [x] Base branch created from the **current upstream release branch** on
      `Agenta-AI/agenta` (`release/v0.110.0`) — see `README.md` "The base". Not
      `main`, not `big-agents`, not a fork. Migration head verified at
      `oss000000020`, so WP1 takes `oss000000021`.
- [x] Write `core/channels/{dtos,types,interfaces}.py` and
      `core/channels/adapters/interface.py`, complete, every body
      `raise NotImplementedError`. Verbatim from `entities.md` §4–§7 and
      `capabilities.md`.

      Run `ruff format` then `ruff check --fix` in `api/` before committing —
      pre-commit enforces both (root `AGENTS.md`).

      Exceptions go in **`types.py`**, following `sessions` rather than
      `triggers` — `entities.md` §5 states the choice and the reason. Getting
      this wrong at C0 means renaming imports in twelve worktrees.

      Two shapes had no Python definition in any design document and were
      derived at C0 from `capabilities.md` §2 and the adapter port's
      signatures: **`ChannelCapabilities`** (with its nested declaration
      models) and **`ChannelInboundEvent`**. `ChannelConnection` is an alias
      of the shared gateway `Connection`. A package that finds one of these
      wrong reports it rather than editing around it.

      `compose_external_key` and the `key`/`idempotency_key` derivations went
      to **`core/channels/utils.py`**, alongside `resolve_policy` — which is
      declared and left `NotImplementedError` for WP1.
- [x] Add the empty `channels` block to `api/entrypoints/routers.py` — imports and
      registration scaffold only, so four later packages add to a file that already
      has the domain in it.
- [x] Verify: the stubs import, type-check, and a test instantiating each DTO with
      representative values passes.

      `oss/tests/pytest/unit/channels/test_channels_seed.py`, 10 passing. It
      also asserts the four identity properties WP2's contract suite holds
      every adapter to — grain distinctness, canonicalisation, the no-threads
      `None`, and a raise on an incomplete locator — so WP2 inherits them as
      executable fact rather than prose.
- [x] Commit. **Record the SHA** — every worktree branches from exactly this commit.

      **C0 = `ec29cd2fdc`** on `channels-research`, off `release/v0.110.0`.

If C0 is wrong, every worktree inherits the error. It is worth reviewing properly
even though it does nothing.

## Wave 1 — the three packages with no dependencies

WP1, WP2 and WP3 have no dependencies on each other beyond C0's interfaces, and
together they are all of C1. Launch all three at once.

| Worktree | Package | Owns |
| --- | --- | --- |
| `channels-wp1` | Domain and schema | `core/channels/` impl, `dbs/postgres/channels/`, migration `oss000000021` |
| `channels-wp2` | Adapter port | `core/channels/adapters/{registry,normalise}.py`, contract suite |
| `channels-wp3` | Ingress | `apis/fastapi/channels/ingress.py`, the `_PUBLIC_ENDPOINTS` line |

Each starts with: read `specs-wp{k}.md`, work `tasks-wp{k}.md` top to bottom, stay
inside the owned paths, and **stop at the checkpoint** rather than reaching into
another package's files to finish something.

WP3 is deliberately tiny — verify, write one row, answer 202. If it grows routing
or resolution, that is WP4's work leaking in and the review should reject it.

## Wave 2 — five packages, launched from C1

All five branch from `channels-c1` (not from a wave-1 package branch, and not
from a rebase — C1 carries the merged result plus the three cross-package fixes).

| Worktree | Package | Feeds |
| --- | --- | --- |
| `channels-wp4` | Inbox worker — routing, resolution, detached invoke | C2 |
| `channels-wp5` | Outbox worker — fold, render, post, receipt | C2 |
| `channels-wp7` | Identity links — platform user → Agenta account | C2 |
| `channels-wp6` | Slack adapter — the first real channel | C3 |
| `channels-wp8` | Configuration API — the non-public routes | C3 |

**Read `c1-merge-notes.md` before starting.** C1's three defects were all seam
defects — two packages each internally consistent and mutually incompatible. The
same shape is likely again, and WP6 in particular consumes the capability
declaration whose vocabulary was the first of them.

### Coordination points, not blockers

- **WP7 writes no migration.** Its identity tables are content inside WP1's
  `oss000000021` — the single line still open on WP1's ledger. WP7 hands over its
  column shape and someone appends to that revision; never a new one.
- **WP5 rides polling on purpose.** Its final form needs WP0's session events,
  which are not channels work and not ours to schedule. Polling keeps C2 off that
  dependency; expect rework when WP0 lands. Raise it with the sessions owner now
  rather than at C4.
- **WP4 and WP8 both touch `api/entrypoints/routers.py`**, a collision file owned
  by no package. Write the intended edit into the final report; the checkpoint
  applies them serially.

### WP0 — not ours

Session events are owned by whoever owns sessions. C4 needs them for WP5's final
form. Listed in `plan.md` so channels' dependency on it is visible, not so this
team schedules it.

## Reaching C1

C1 is reached when this runs on the merged base, not when three packages report
done. **Reached** — verified on `channels-c1` against local Docker Postgres:

- [x] Merge WP1, WP2, WP3 in that order — WP1's migration first, since the other
      two need the tables.
- [x] Apply the serialised edits: WP1's DAO/service wiring, WP3's
      `_PUBLIC_ENDPOINTS` line, both into `api/entrypoints/routers.py` as one edit.
- [x] Signed request to `POST /channels/slack/events/` → exactly one
      `channel_inbox_events` row, 202.
- [x] Unsigned request → rejected.
- [x] Redelivery of the same event → no second row.
- [x] Contract suite fails a fake adapter that lies about its declaration.
- Migration apply/downgrade is **checked by hand against local Docker Postgres**,
  never by pytest — a downgrade drops the tables, so a test doing it against a
  shared dev database destroys whatever else is using them. Not a C1 gate.

Totals on the merged base: **2513 unit, 25 integration, 802 acceptance, 0 fail.**

**Three defects the merge surfaced that no package could see alone** — the reason
C1 is a gate and not a formality:

1. `resolve_policy` indexed a *grain* vocabulary (`thread|space`) against a
   *scope* ordering (`thread|message`), so any platform without threads raised
   `ValueError` — including `contract.md`'s own bridge example.
2. The migration created lowercase enum labels while `Column(Enum(X))` persists
   member names, so every insert failed. Every other enum in the database is
   uppercase.
3. WP3's ingress called two service methods WP1 never implemented, under names
   WP1 had spelled differently. Both packages were green in isolation.

**Instead of rebasing the package worktrees**, C1 carries the whole result: the
three ledgers are closed here, and wave 2 branches from `channels-c1`.

## Wave 3 — launched from C2, after two checkpoint fixes

All branch from `channels-c2`, which carries the five wave-2 packages, the C2
fixes, and a merge of `main` at `origin/main` = `e73fb2efce` (the v0.110.0
release). Verified green on that merge: api 2652 unit / 43 integration / 802
acceptance, sdk 2003/146/118, services 100/15/145.

**The checkpoint numbering in `plan.md` drifted from what happened.** It assigns
WP6 and WP8 to C3, but both merged at C2 — they were ready together and there was
no reason to hold them. So C3 is a *verification* checkpoint over merged code
("Slack works"), not a merge of new packages, and wave 3 is `plan.md`'s C4 set
plus the two items below.

### Before launching: two things no package owns

Both are `findings.md` items that sit in the gap between packages, and both must
land first because wave 3 builds on them.

1. **`F1` — nothing wires the entrypoints.** WP4, WP5 and WP8 each produced the
   `api/entrypoints/routers.py` and `worker_queues.py` edits and handed them back
   verbatim, as instructed. No package applies them, and no wave-3 spec mentions
   either file — checked. So the merged tree has an ingress that logs events, a
   dispatcher that would route them, and a worker that would answer, none
   connected. Apply the three diffs serially (WP4 first: it defines the dispatch
   task WP3's router consumes). **Until this lands, nothing runs end to end and
   C3 cannot be verified at all.**
2. **`F25` — the comment sweep.** 77 comment lines cite work packages, findings
   and design sections; a few assert worktree state that is now false. Cheapest
   while the merge is fresh, and it touches every file wave 3 will edit.

`F18` was the third item here and is **done** — `resolve()` now attaches an
inbound event to its resolved space, so `compose_input` can see it. Without that
fix WP9 could not parse a command from content that was never read, and WP10
could not extend a backlog that resolved to nothing.

### The packages

| Worktree | Package | Owns |
| --- | --- | --- |
| `channels-wp15` | Mock channel — an in-process adapter for a channel that does not exist | `core/channels/adapters/mock/` |
| `channels-wp9` | Commands — `!new`, `!stop`, `!sessions`, `!use:<id>` | command parsing + dispatch |
| `channels-wp10` | Fill — backfill range read, forwardfill one-time fetch | `core/channels/` fill paths |
| `channels-wp13` | Web app — the configuration surface over WP8 | `web/` only |

**WP15 is new and goes first.** Slack was built before any mock, so several
capability paths are proved only against a test fixture (`WellBehavedFakeAdapter`)
rather than an adapter, and `capabilities.md`'s unsupported arms — no threads, no
buttons, no history — have nowhere to be exercised. A `mock` adapter whose
declaration is a test parameter is that home, and it is the second first-party
adapter that proves the port is a port rather than Slack's shape with an interface
drawn around it. It also unblocks `F5`: WP2's contract suite asserts signature
behaviour with a fixed fake header scheme that no real-HMAC adapter can satisfy,
and a `mock` adapter makes the suite's own shape the thing under discussion.

WP9, WP10 and WP13 are independent by construction — `plan.md` groups them
because none sits on another's critical path. WP13 is the only one touching
`web/`, so it cannot collide with the others at all.

### Coordination points, not blockers

- **WP9 and WP4 both parse the message.** WP4 already ships `_parse_sigil` for
  addressing; WP9 owns the `!command[:arg]` grammar. One of them should own both,
  and the checkpoint decides which — not WP9 unilaterally.
- **WP10 cannot meet its stated exit condition without WP0.** "WP5's polling is
  deleted, not disabled" needs session events, which are not ours and not
  scheduled. Until then WP10's forwardfill and WP5's poll loop coexist. Raise it
  with the sessions owner now rather than at the checkpoint.
- **WP13 inherits WP8's open questions in its own surface.** `F10` (the catalog
  path contradiction), `F11` (wire DTOs in the core module) and `F12` (an invented
  request model) all live in the routes WP13 consumes. Settle them before WP13
  builds against a shape that then moves.
- **WP13 is the first package to write `connection.data`.** `F6` records that
  nothing currently does, and that the four keys the Slack adapter reads
  (`signing_secret`, `bot_token`, `bot_user_id`, `team_id`) have no design-doc
  basis. Pin them in a document before writing the form that fills them.
- **WP15 and WP6 both answer to the contract suite.** If fixing `F5` changes the
  suite, WP6's Slack adapter must still pass it — the suite is shared, so a change
  made for `mock` is a change to Slack's acceptance criteria too.

### Still not ours

WP0 (session events) gates WP10's final form. WP11/WP12 (the bridge) are C5;
note that `mock` over the bridge is a cheaper first bridged channel than Slack,
since it removes the platform as a variable — see `plan.md`'s WP12 ordering note.

## Rules for anyone working a package

1. **Own your paths.** If the task needs a file you do not own, that is a
   checkpoint conversation, not a commit.
2. **Rebase at checkpoints only.** Continuous rebasing spends the package's time on
   other people's churn; a merge point is where that pain belongs.
3. **The design documents win.** A spec that disagrees with `entities.md` is a bug
   in the spec — report it rather than implementing around it.
4. **Do not invent names.** Every DTO, column, method and route already exists in
   `entities.md`. A name that is not there is a hallucination.
5. **Stop at the checkpoint.** A package that runs ahead into the next one's work is
   the thing that makes parallel work slower than serial.
