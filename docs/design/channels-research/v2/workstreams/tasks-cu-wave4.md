# CU tasks — wave 4

## A wave is a cycle, not a fan-out

Wave k runs from C(k-1) to Ck. It has **three clean-up phases**, and they do different
work:

| Phase | When | What it is |
| --- | --- | --- |
| **CU-A** | before the packages | unblock: fix what a package would otherwise trip over, or build on wrongly |
| **CU-B** | after the merge, before deploying | seams: what only appears when packages meet, plus reviews and the canonical run |
| **CU-C** | after deploying | what only a real stack shows, plus the follow-ups the deployment earns |

So the full shape is:

```
CU-A  →  packages (in dependency order)  →  merge into channels-c4
      →  CU-B  →  deploy  →  CU-C  →  Ck reached
```

**This is not ceremony — the history says the post-merge phases find as much as the
packages do.** Of the findings in this project, 14 came from work packages and **13 came
from clean-up and verification phases**: 5 from the C2 merge, 3 from the first
integration run against a real deployment, 3 from the test-layer audit, 2 from C3. The
C2 merge itself was conflict-free and green and still yielded four defects on its first
integration run, every one invisible to a passing unit suite.

Treating CU-B and CU-C as optional is how a green merge gets mistaken for a reached
checkpoint — which is exactly what happened at C3 (`F36`).

**Verify with the canonical configuration only.** From the **repo root** — the wrapper
appends the component to `$PWD`, so running it from inside `api/` fails:

```
load-env hosting/docker-compose/ee/.env.ee.dev
py-run-tests --logs --api -uia
```

`--logs` tees stdout **and** stderr to `tests.<component>.logs`. Failure detail goes to
stderr, so a bare `> file` keeps the summary and loses every traceback.

**Where we are, precisely.** A branch named `channels-ck` holds Ck, so `channels-c3`
holds wave 3's six merged packages and wave 4 merges into `channels-c4`. C3's packages
are in, but **C3's exit condition is not met** — "each command works in a real space"
and "WP5's polling is deleted" are both still false, because `F36` left four of five
capabilities with no callers. That is what wave 4 fixes.

---

# CU-A — before the packages

Unblock work the packages would otherwise trip over. Every item here is something a
package would either hit as a wall or build on wrongly.

## CU-A-1 — `F13`: Slack button rendering drops `value` — **BLOCKED, do not attempt**

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

## CU-A-2 — `F34`: a missing `bot_token` sends `Bearer None` — **DONE**

- [x] `_bot_token` now returns `str` and raises `ChannelConnectionIncomplete`
  (new, in `core/channels/types.py`) when the token is absent, matching
  `_signing_secret`. A new exception type rather than reusing
  `ChannelSignatureInvalid`, which would have named the wrong cause.
- [x] The test that pinned the old behaviour asserted `invalid_auth` from the
  fake; it now asserts the local failure and that nothing reached the fake.
- [x] **This fix surfaced `F39`** — the shared contract suite was driving every
  adapter with no credentials at all, and passed only because Slack tolerated it.

## CU-A-3 — `F30`: two implementations of the forwardfill range read — **DONE**

- [x] Kept the helper as the shared range read; `compose_input` now calls it and
  keeps the policy branch, narrowing the range to the addressing event when
  forwardfill is off. The helper stays policy-free, which is what makes it
  reusable by the fill path WP18 wires.
- [x] No cycle: `fill.py` imports only interfaces and dtos, never `service.py`.
- [x] Both branches still covered; `test_forwardfill_off_returns_addressing_event_alone`
  is the guard. **No test count changed**, so this refactor rests on that named
  test rather than on arithmetic — worth stating, since an unchanged count is not
  by itself evidence.

## CU-A-4 — `F35`: `_StubTransport` and its five tests — **DONE, 3 of 5**

- [x] Checked all five side by side. **Three were subsumed, two were not** — the
  `medium` confidence was right, and deleting all five would have lost coverage.
- [x] Deleted: post-then-edit, refusal-vs-empty-page, empty-page-not-a-refusal.
  Each has a fake-backed equivalent asserting held state.
- [x] **Kept**: content splitting over `MAX_CHARS` and page-size clamping. No
  fake test references the 4001-char split or asserts the outbound `limit`;
  verified by grep, not by reading. `_StubTransport` stays for these two.
- [x] Arithmetic exact: 2702 → 2699 on the full unit layer, the three deletions
  and nothing else.

## CU-A-5 — `F27`: the composition root cannot be imported outside a container — **DEFERRED by decision**

- [x] **Diagnosis corrected.** The recorded error was wrong: the failure is
  `No 'script_location' key found in configuration`, because `Config('/app/...')`
  finds no file outside a container and returns an empty config. The ini's own
  absolute `script_location` is a *second*, independent problem that only bites
  once the first is fixed. `findings.md` now records both.
- [x] Both fixes were prototyped and verified — the composition root imported
  cleanly and reported `adapters: ['slack']`, i.e. `F36` visible as data — then
  **reverted**. Migration config is not wave-4 scope, and `%(here)s` plus a
  package-relative env default is a change for its owners to make deliberately,
  not a side effect of channels work. (It is provably inert in production:
  `WORKDIR /app` with `api/oss` copied to `/app/oss` makes `%(here)s` resolve to
  the identical path under both Dockerfiles.)
- [ ] **Consequence for WP18, which must be stated plainly:** its wiring cannot be
  guarded by a test that imports the composition root. `F1` and `F36` were both
  missable for this reason and the third recurrence is still possible. WP18 must
  assert as close to the seam as it can reach and say what it could not prove.

## CU-A-6 — `F14`: 30 misfiled unit tests — **DEFERRED, symptom gone**

- [ ] **Re-measure before acting: the symptom is already gone.** With nothing running,
  the unit layer is 2443 passed / 52 skipped — the Postgres-dependent tests skip
  cleanly rather than erroring, because the `postgres_reachable()` guard added for
  `F22` covers them. Only two files under `unit/` still reference it.
- [ ] What remains is placement, not breakage: a unit test should not need a Postgres
  probe at all. Move them to `integration/`, or make them hermetic. No markers — the
  layer is decided by folder.
- [x] **Re-measured at CU-A: deferred, not done.** 52 clean skips, all from two
  `conftest.py` files under `sessions/` and `git/` — neither channels'. Nothing
  fails and nothing is order-dependent. Moving other teams' tests mid-wave buys
  nothing and risks their suites, so this stays open for its owners.

## CU-A-7 — `CU-2` missed the gateway DTO — **DONE**

- [x] Swept the **full** wave-3 diff (342 changed code files) rather than the
  channels paths. Found and stripped **five** citations, not one: the gateway DTO
  `(F4)`, a `WP7`/`specs-wp7.md` comment plus a `workstreams/README.md` docstring
  in the channels migration, and `specs-wp1.md`/`specs-wp6.md` in three test
  docstrings. Constraints kept, references dropped.
- [x] Verified zero remain across all 342 files, and AST-verified comment-only
  with docstring nodes stripped.

## CU-A-8 — housekeeping — **DONE**

- [x] `findings.md` header now reads `channels-c3`, carried through C3, and the
  Sources list names the wave-3 packages and the C3 merge.
- [ ] `F10` is deferred by decision (the doubled catalog path is now baked into both
  regenerated clients). Leave it open, and note that fixing it means a second client
  regeneration.

### CU-A done when

- [ ] Every item above is fixed, or explicitly deferred with a reason recorded in
  `findings.md`.
- [ ] Canonical run green from the repo root: api / sdk / services, plus
  `ts-run-tests --logs --runner -ui` with only `F21`'s 19 known failures in their three
  usual files.
- [ ] `F27` fixed, or the reason it was not stated plainly — WP18's exit condition leans
  on it.

---

# The packages

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

# CU-B — after the merge, before deploying

Merge in the order above into a `channels-c4` worktree. **These items cannot be written
in advance** — they are what the merge produces — but the *shape* is predictable, and
naming it beforehand is what stops a green merge being read as a finished checkpoint.

## CU-B-1 — the reachability sweep

- [ ] For **every** public symbol wave 4 added or connected, grep for call sites
  **outside its own module** and report the count. `F36` was found this way and nothing
  else finds it: a per-package suite calls its own entry point directly, so it proves
  the function works and never that anything invokes it.
- [ ] Read the composition root directly for registries built empty (`adapters={}`) and
  hand-wired `None`s. Both `F1` and `F36` were exactly that.
- [ ] If `CU-A-5` fixed `F27`, this becomes a **test** rather than a sweep. Write it —
  it is the guard against a third recurrence.

## CU-B-2 — the seam review

- [ ] For each package, list every collaborator it **faked** and what it asserted about
  that collaborator's interface. Compare each against the real thing. Every
  cross-package defect in this project came from a fake whose real interface differed —
  three at C1, four on C2's first integration run.
- [ ] A passing per-package suite is not evidence two packages agree.

## CU-B-3 — the comment sweep

- [ ] No `WP\d`, `(F\d`, `(D\d` or `§` citation in any file wave 4 touched, **including
  shared files outside `core/channels/`** — that scoping gap is how `CU-A-7` slipped
  through. Grep and report zero rather than asserting it.
- [ ] Verify comment-only by AST with docstring nodes stripped, not by reading the diff.
- [ ] No comment claiming something is absent or "not yet" when it is present.

## CU-B-4 — the canonical run

- [ ] Full canonical run from the repo root, all four suites. Only `F21`'s 19 known
  failures, in their three usual files.
- [ ] Check the test **arithmetic**: baseline plus each package's additions should equal
  the total. A mismatch means a test was shadowed or lost.

### CU-B done when

- [ ] Every wave-4 symbol has a caller, or is deliberately unreached with that recorded.
- [ ] Canonical run green.
- [ ] **Say plainly whether a message travelled the path, or whether it is only wired.**

---

# CU-C — after deploying

What only a real stack shows. Deployment is `jp`'s, at checkpoints only.

## CU-C-1 — verify against the deployment

- [ ] The queue and stream consumers actually start and log their subscriptions.
- [ ] Migrations apply from an empty database (`--nuke`), by hand — never by pytest.
- [ ] The served OpenAPI schema matches expectation, checked over HTTP rather than from
  an in-process dump. My in-process dump was OSS-only once and would have deleted every
  EE resource from the regenerated clients.
- [ ] Full canonical run **against the deployment**, so integration and acceptance
  actually execute rather than skip.

## CU-C-2 — the exit condition

- [ ] C4's condition: a message enters through a channel the platform does not know
  about, becomes a turn, and an answer comes back out — **with no credentials of any
  kind**. A command works. Fill supplies context. `poll_turn` is gone from the tree.
  Two bridges coexist behind the one route.
- [ ] If it is not met, say which clause failed. A checkpoint is reached or it is not;
  there is no partial credit, and recording a near-miss as a pass is how `F36` survived.

## CU-C-3 — the follow-ups the deployment earns

- [ ] Every defect the deployment surfaced, into `findings.md` with file and line.
- [ ] Re-check any finding whose evidence was structural rather than observed — the
  deployment is the first chance to confirm or refute those.
- [ ] Decide what blocks C5 and what defers to C6.

---

## Then C4 is reached

Only after CU-C.  **Then** the exit condition: a message enters through a channel
the platform does not know about, becomes a turn, and an answer comes back out, with
no credentials of any kind.

Expect seam defects. Every checkpoint so far has produced them, and each was
invisible to a green per-package suite: three at C1, four on C2's first integration
run, and at C4 the discovery that four of five merged capabilities had no callers at
all.
