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

## CU-A-2 — `F34`: a missing `bot_token` sends `Bearer None`

- [ ] `_bot_token` returns `None` and the adapter interpolates it anyway. Fail fast
  locally, the way `_signing_secret` already raises when its key is absent.
- [ ] Reachable today because nothing writes `connection.data` (`F6`), so a
  half-configured connection currently fails with a misleading Slack error.

## CU-A-3 — `F30`: two implementations of the forwardfill range read

- [ ] `select_forwardfill_range` duplicates `compose_input`'s inline read, and **not
  faithfully**: `compose_input` branches on `resolution.policy.forwardfill` and the
  helper does not. **Not a substitution** — swapping one for the other as-is changes
  behaviour when forwardfill is off.
- [ ] Either delete the helper and keep the inline read, or move the policy branch
  into the helper and have `compose_input` call it. Decide, do not leave both.
- [ ] WP18 wires fill, so settling this first avoids wiring the wrong one.

## CU-A-4 — `F35`: `_StubTransport` and its five tests

- [ ] WP16 reports five of WP6's stub-backed tests as subsumed by fake-backed
  equivalents. **Confidence on that finding is `medium` deliberately** — it is
  WP16's reading of its own work. Check each of the five side by side before
  deleting anything.
- [ ] If a stub test asserts something the fake does not, keep it and say which.

## CU-A-5 — `F27`: the composition root cannot be imported outside a container

- [ ] `entrypoints/routers.py` fails at import: `env.alembic.cfg_path_core` defaults
  to `/app/...` and the ini hardcodes `script_location = /app/...`, so overriding the
  env var alone is not enough.
- [ ] Make `script_location` relative to the ini, or resolve it from the package.
- [ ] **This is why `F1` and `F36` were both missable.** No test can assert the
  composition root's wiring while nothing can import it. Fixing it is what lets
  WP18's work be guarded by a test rather than by inspection.

## CU-A-6 — `F14`: 30 misfiled unit tests

- [ ] **Re-measure before acting: the symptom is already gone.** With nothing running,
  the unit layer is 2443 passed / 52 skipped — the Postgres-dependent tests skip
  cleanly rather than erroring, because the `postgres_reachable()` guard added for
  `F22` covers them. Only two files under `unit/` still reference it.
- [ ] What remains is placement, not breakage: a unit test should not need a Postgres
  probe at all. Move them to `integration/`, or make them hermetic. No markers — the
  layer is decided by folder.
- [ ] **Lowest priority item in this ledger.** They came from `main`, they are not
  channels' tests, nothing is failing. If checking with the owners stalls, defer it
  rather than holding wave 4.

## CU-A-7 — `CU-2` missed the gateway DTO

- [ ] `core/gateway/connections/dtos.py:23` still carries `(F4)`. The wave-3 sweep
  scoped itself to the channels paths, and channels' own additions to a *shared*
  gateway file fell outside them. Strip the citation, keep the constraint.
- [ ] Grep once for design citations in channels' edits to shared files, not only in
  `core/channels/**` — that is the gap this one slipped through.

## CU-A-8 — housekeeping

- [ ] `findings.md` header still says `Branch: channels-c2` and "at checkpoint C2".
  Update it to C3.
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
