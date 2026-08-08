# CU2 tasks — clean-up before wave 4

Findings that no wave-4 package owns, done in `channels-c3` before any worktree is
launched. Same shape as [`tasks-cu.md`](tasks-cu.md), which covered the wave-3
clean-up and is closed.

**Verify with the canonical configuration only.** From the **repo root** — the
wrapper appends the component to `$PWD`, so running it from inside `api/` fails:

```
load-env hosting/docker-compose/ee/.env.ee.dev
py-run-tests --logs --api -uia
```

`--logs` tees stdout **and** stderr to `tests.<component>.logs`. Failure detail goes
to stderr, so a bare `> file` keeps the summary and loses every traceback.

---

## CU2-1 — `F13`: Slack button rendering drops `value` — **BLOCKED, do not attempt**

- [ ] **Blocked on `F38`**: nothing parses a button click, so there is no inbound
  reader to be consistent with and the question cannot be answered. Leave `F13` open
  and spend no time on it. Recorded here so the next reader does not re-derive this.

- [ ] **The loss is at the call site, not in the renderer.** `mapping.py:93` faithfully
  emits `option["value"]`; `adapter.py:335` builds that options list as
  `{"label": b.get("label", ...), "value": b.get("id", "")}` — so WP5's own `value` is
  dropped one frame earlier and the button carries the `id` instead.
- [ ] Decide whether that is a bug or the intended contract **before changing it**: it
  is self-consistent as long as the inbound action path also reads `id`. Check that
  path first. If it reads `id`, the fix may be to document the mapping and pin it with
  a test rather than to change the payload.
- [ ] Either way, pin it: WP16's fake can now assert the posted block, so assert
  against the fake's stored message rather than a request log.

## CU2-2 — `F34`: a missing `bot_token` sends `Bearer None`

- [ ] `_bot_token` returns `None` and the adapter interpolates it anyway. Fail fast
  locally, the way `_signing_secret` already raises when its key is absent.
- [ ] Reachable today because nothing writes `connection.data` (`F6`), so a
  half-configured connection currently fails with a misleading Slack error.

## CU2-3 — `F30`: two implementations of the forwardfill range read

- [ ] `select_forwardfill_range` duplicates `compose_input`'s inline read, and **not
  faithfully**: `compose_input` branches on `resolution.policy.forwardfill` and the
  helper does not. **Not a substitution** — swapping one for the other as-is changes
  behaviour when forwardfill is off.
- [ ] Either delete the helper and keep the inline read, or move the policy branch
  into the helper and have `compose_input` call it. Decide, do not leave both.
- [ ] WP18 wires fill, so settling this first avoids wiring the wrong one.

## CU2-4 — `F35`: `_StubTransport` and its five tests

- [ ] WP16 reports five of WP6's stub-backed tests as subsumed by fake-backed
  equivalents. **Confidence on that finding is `medium` deliberately** — it is
  WP16's reading of its own work. Check each of the five side by side before
  deleting anything.
- [ ] If a stub test asserts something the fake does not, keep it and say which.

## CU2-5 — `F27`: the composition root cannot be imported outside a container

- [ ] `entrypoints/routers.py` fails at import: `env.alembic.cfg_path_core` defaults
  to `/app/...` and the ini hardcodes `script_location = /app/...`, so overriding the
  env var alone is not enough.
- [ ] Make `script_location` relative to the ini, or resolve it from the package.
- [ ] **This is why `F1` and `F36` were both missable.** No test can assert the
  composition root's wiring while nothing can import it. Fixing it is what lets
  WP18's work be guarded by a test rather than by inspection.

## CU2-6 — `F14`: 30 misfiled unit tests

- [ ] 30 tests under `unit/` open external connections; the layer rule says a unit
  test may use nothing external. They also collide over shared resources.
- [ ] Move them to `integration/`, or make them hermetic. Do not add markers — the
  layer is decided by folder.
- [ ] Not channels' own tests, and they arrived from `main` — check with the owners
  before moving, and say so if that blocks.

## CU2-7 — `CU-2` missed the gateway DTO

- [ ] `core/gateway/connections/dtos.py:23` still carries `(F4)`. The wave-3 sweep
  scoped itself to the channels paths, and channels' own additions to a *shared*
  gateway file fell outside them. Strip the citation, keep the constraint.
- [ ] Grep once for design citations in channels' edits to shared files, not only in
  `core/channels/**` — that is the gap this one slipped through.

## CU2-8 — housekeeping

- [ ] `findings.md` header still says `Branch: channels-c2` and "at checkpoint C2".
  Update it to C3.
- [ ] `F10` is deferred by decision (the doubled catalog path is now baked into both
  regenerated clients). Leave it open, and note that fixing it means a second client
  regeneration.

### Done when

- [ ] Every item above is fixed, or explicitly deferred with a reason recorded in
  `findings.md`.
- [ ] Canonical run green from the repo root: api / sdk / services, plus
  `ts-run-tests --logs --runner -ui` with only `F21`'s 19 known failures in their
  three usual files.
- [ ] `F27` fixed, or the reason it was not stated plainly — WP18's exit condition
  leans on it.

---

## After CU2: fan out

Five worktrees, but **only two can start in parallel**. The rest are ordered:

| Order | Worktree | Package | Blocked by |
| --- | --- | --- | --- |
| 1 | `channels-wp18` | connect wave 3 | — |
| 1 | `channels-wp19` | the bridge `source` contract | — (a design decision first) |
| 2 | `channels-wp12` | the bridge adapter | WP19's decision |
| 3 | `channels-wp17` | the test-drive process | WP18 + WP12 |
| 4 | `channels-wp11` | in-process vs bridged Slack | WP17 |

WP18 and WP19 are genuinely independent: one wires existing code, the other writes a
protocol section. **WP19 should be settled as a document before its code is written**,
so it can start immediately and hand its decision to WP12.

Every agent: read `c1-merge-notes.md` first, stay inside owned paths, write back
verbatim any edit it cannot make, and record the interface it asserted whenever it
faked a collaborator — **even when its tests pass**. That rule has caught every
cross-package defect in this project so far.

**No design-process citations in code, comments, docstrings or commit messages.**
`WP18`, `(F37)`, `(D9)`, `§2.4`, `specs-wp18.md` — none of it. State the constraint,
drop the reference. `CU-2` removed 109 such lines; four of five wave-3 briefs omitted
this rule and every one of them reintroduced them.

## Then C5

Merge in the order above into a `channels-c5` worktree, resolve the seams, get the
canonical run green. **Then** the exit condition: a message enters through a channel
the platform does not know about, becomes a turn, and an answer comes back out, with
no credentials of any kind.

Expect seam defects. Every checkpoint so far has produced them, and each was
invisible to a green per-package suite: three at C1, four on C2's first integration
run, and at C4 the discovery that four of five merged capabilities had no callers at
all.
