# Findings: Channels

> Branch: `channels-c2`
> Opened on: `2026-08-07` at checkpoint C2
> Effective path: `docs/design/channels-research/v2`

## Sources

- Wave-1 merge defects: `workstreams/c1-merge-notes.md`
- Per-package ledgers: `workstreams/tasks-wp{1..8}.md`
- Wave-2 package reports (WP4, WP5, WP6, WP7, WP8), C2 merge
- Local implementation under `api/oss/src/core/channels/`,
  `api/oss/src/apis/fastapi/channels/`, `api/oss/src/tasks/*/channels/`

## Rules

- This is the cross-cutting record. A finding that belongs to exactly one work
  package stays on that package's `tasks-wp{k}.md`; anything spanning packages,
  predating the feature, or blocked on a checkpoint lands here.
- Keep non-findings context above `Open Findings`.
- Cite evidence by file and line. A finding without evidence is a suspicion —
  say so in `Confidence`.
- Record what was **verified**, not what a package reported. Three C1 defects
  were each green in isolation; a passing suite is not evidence of agreement.

## Notes

- The C2 merge of five wave-2 branches produced **zero conflicts**. Every
  package honoured the instruction to hand back collision-file diffs rather
  than apply them, so `routers.py` and `worker_queues.py` are untouched — and
  therefore nothing is wired.
- A clean merge is not agreement. Of the three seams flagged before merging,
  one was a real defect (identity attribution, now fixed), one was a
  misreading on my part (render vocabulary — different layers, not a
  disagreement), and one is a genuine gap (`connection.data` has no producer).
- Unit-layer state at `bd9c5683f9`: 259 channels tests pass, 2344 across the
  layer. The 7 failures and 45 errors under `sessions/` and `git/` reproduce
  identically on the untouched C1 baseline — verified, not assumed.
- **The first integration run against a real deployment found four defects in
  one pass** (`F4`, `F18`, `F19`, `F20`), three of them fixed in `48204802ea`.
  Every one had been invisible to a green unit suite: the fakes accepted
  `provider_key` values Pydantic rejects, ignored `space_id` when querying, and
  never produced a row with a null `updated_at`. This is the strongest evidence
  yet for the rule in `c1-merge-notes.md` — a faked collaborator is an asserted
  interface, and the assertion is only tested when something real replaces it.
- **Verified state at `3ce4be3465`, against a from-scratch EE deployment, under
  the canonical configuration** — `load-env hosting/docker-compose/ee/.env.ee.dev`
  then `py-run-tests --logs --{sdk,api,services} -uia` and
  `ts-run-tests --logs --runner -ui`:

  | Suite | Unit | Integration | Acceptance |
  | --- | --- | --- | --- |
  | api | 2655 pass | 43 pass | 802 pass |
  | sdk | 1974 pass | 146 pass | 118 pass |
  | services | 100 pass | 15 pass | 145 pass |
  | runner | 2070 pass (19 fail, `F21`) | — | — |

  `F21` (runner, not channels) is now the only failure anywhere; `F18` was fixed
  after this run and the api integration count rose 41 → 43. **That env file plus the two wrappers is the configuration of record** —
  it needs no hand-set variables, and any figure measured otherwise is not
  evidence. Several numbers earlier in this record were taken under an ad-hoc env
  and were wrong in both directions: the api unit layer was reported with 4
  failures (it has none here) and acceptance was said to need `AGENTA_API_URL` +
  `AGENTA_AUTH_KEY` (it does not — the file supplies them, and it runs 802 rather
  than the 751 a hand-set URL produced).
- The C2 redeploy confirmed the enum change end to end: `oss000000021` applied
  clean, both `kind` columns are `varchar`, `origin` and the two `state`
  columns kept their enum types, and `channelspacekind`/`channeleventkind` no
  longer exist. All 40 channels integration tests pass against it.

## Decisions

- Test layer is decided by folder, never by marker.
- **A unit test may use nothing external — no database, no object store, no
  broker, no HTTP.** Values read from the environment are fine; a *connection*
  is not. Anything needing one external dependency but still testing a single
  unit is an **integration** test. Anything point-like or flow-like end to end
  is an **acceptance** test. This is what `F14` violates.
- Migrations are verified by hand against local Docker Postgres. No pytest test
  runs `alembic upgrade`/`downgrade`, and no checklist tracks that as a gap.
- **The canonical test configuration is `load-env hosting/docker-compose/ee/.env.ee.dev`
  followed by the `py-run-tests` / `ts-run-tests` wrappers, with no hand-set
  variables.** A result measured under any other env is not evidence — a failure
  seen there may be an artifact of the invocation, and a pass there may hide one.
  Commented-out lines in that file are not a defect to route around; the wrappers
  supply what is missing.
- Deployment happens at checkpoints only, never per work package.

## Open Findings

### F25. In-code comments need a review pass before C3

- ID: `F25`
- Origin: `checkpoint`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Maintainability`
- Summary: The channels source carries comments that document the *project* rather
  than the code. They were useful while packages were built in isolation and are
  now noise at best and false at worst. Four categories, each with a different
  disposition:

  1. **Design-process identifiers → drop.** `WP4`, `WP7`, `(F18)`, `(D17)`, `(D9)`,
     `§2.4` and similar mean nothing to a reader of the merged tree. 77 comment
     lines across `core/channels/` (51), `dbs/postgres/channels/` (12),
     `tasks/asyncio/channels/` (9) and `apis/fastapi/channels/` (5). Where the
     comment states a real constraint, keep the constraint and drop the citation.
  2. **Stale dev/test-level state → drop.** Claims that were true in one worktree
     and are false now, e.g. `service.py:46` "a module that does not exist yet in
     this worktree" and `ingress.py:20` "WP1's service and WP2's registry — not yet
     implemented in this worktree". Both modules are merged in the same tree.
  3. **Fixed-bug commentary → keep the mechanism, drop the story.** A comment
     explaining *why* the code must be this way earns its place; the history of
     how it was got wrong does not. "the ingress wrote this row before any space
     existed; attach it now" is mechanism. "(F18). Before the refusal paths below"
     is storytelling.
  4. **Verbose comments that restate the code → drop or trim to one line.** The
     house rule is one terse line maximum, with rationale in the PR or here.

- Files: all of `api/oss/src/core/channels/`,
  `api/oss/src/dbs/postgres/channels/`, `api/oss/src/apis/fastapi/channels/`,
  `api/oss/src/tasks/{asyncio,taskiq}/channels/`
- Suggested Fix: One sweep before C3, while the merge is fresh. Test files are in
  scope too — a docstring naming the package that wrote the test ages the same
  way. Do not weaken a comment that records a real constraint just because it
  cites a document; rewrite it to state the constraint directly.
- Notes: Partly self-inflicted — the C2 fixes added `(F18)` citations in
  `service.py`, `interfaces.py` and `dao.py`, and the identity wiring added
  "Public since C2: WP4's dispatcher needs...". Those go first.

### F1. Nothing enqueues inbox events or schedules the outbox poll

- ID: `F1`
- Origin: `checkpoint`
- Severity: `P0`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`, `Functionality`
- Summary: WP4, WP5 and WP8 each need edits to `api/entrypoints/routers.py`,
  and WP4/WP5 also to `api/entrypoints/worker_queues.py`. All three were
  instructed to hand the diffs back rather than apply them, so the merged tree
  has an ingress that logs events, a dispatcher that would route them, and a
  worker that would answer — none connected.
- Evidence:
  - `git diff --name-status cff139770a channels-wp{4,5,8}` shows no entry for
    either entrypoint file.
  - `apis/fastapi/channels/ingress.py` takes `dispatch_task: Optional[Any] =
    None`; nothing sets it.
- Files: `api/entrypoints/routers.py`, `api/entrypoints/worker_queues.py`
- Suggested Fix: Apply the three diffs serially (they are quoted verbatim in
  the WP4, WP5 and WP8 reports), WP4 first since it defines the ingress
  dispatch task WP3's router consumes.
- Blocks: any acceptance test that drives a signed event through to an answer.

### F2. No scheduler drives `channels.outbox.poll`

- ID: `F2`
- Origin: `WP5`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: The outbox worker exposes a poll entry point, but nothing invokes it
  repeatedly. WP5 searched for a taskiq periodic-task primitive to copy and
  found none in this codebase.
- Files: `api/oss/src/tasks/taskiq/channels/outbox_worker.py`
- Suggested Fix: Decide the mechanism (taskiq scheduler, an external cron, or
  riding WP0's session events once they land). WP5 built against polling
  deliberately so the source can be swapped.
- Related: `F3` — WP0's arrival changes this.

### F3. WP0 (session events) is unowned and blocks WP5's final form

- ID: `F3`
- Origin: `planning`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: WP5 rides polling until WP0 lands. WP0 is not channels work and has
  no owner in this plan; C4 depends on it.
- Suggested Fix: Raise with the sessions owner now rather than discovering the
  dependency at C4. WP5's `poll_turn` is the designed swap seam.
- Notes: WP5 explicitly did not invent WP0's event payload shape; its
  assumption is only that the replacement dispatches to the same
  `on_turn_started`/`on_turn_ended` methods.

### [CLOSED] F4. `Connection.provider_key` is typed `{composio, agenta}` but carries channel keys

- ID: `F4`
- Origin: `pre-existing`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Fix: Added `SLACK = "slack"` to `ConnectionProviderKind`. Widening the field
  to plain `str` — which the DB column and DAO already are — was tried first
  and reverted: eight call sites in `tools/`, `triggers/` and `gateway/` read
  `provider_key.value`, and two tools unit tests failed immediately. Rewriting
  three subsystems to fix a channels defect is the wrong trade at a checkpoint.
- Commit: `48204802ea`
- Notes: The narrow fix leaves the underlying design question open — one enum
  still serves two vocabularies, and every new channel needs a member. Revisit
  when the second adapter lands.
- Verified: four integration failures resolved; 386 unit tests pass including
  `unit/tools/`.
- Category: `Correctness`, `Compatibility`
- Summary: `ConnectionProviderKind` declares only `COMPOSIO` and `AGENTA`, while
  channels code passes the channel key (`"slack"`) through the same field and
  into `adapter_registry.get()`. Pydantic rejects `"slack"` at construction, so
  every package that needed a Slack connection worked around it separately.
- Evidence:
  - `core/gateway/connections/dtos.py:20-22` — the enum.
  - `core/gateway/connections/dtos.py:61,105` — `provider_key:
    ConnectionProviderKind`.
  - `core/channels/service.py:306,512,578,845` — passed as a channel key.
  - C1's own integration fixture stores `provider_key="slack"` as a raw string
    at the DBE layer, which is more permissive than the DTO.
  - Independently hit and worked around by WP5 (`model_construct` in tests),
    WP6 (`AGENTA` as a placeholder), and C1's fixture.
- Files: `api/oss/src/core/gateway/connections/dtos.py`
- Cause: The field means "which provider" for gateway connections and "which
  channel" for channels; one enum serves two vocabularies.
- Suggested Fix: Decide whether channels get a `SLACK` member, a separate
  field, or a widened type. Three independent workarounds is the signal —
  a fourth should not be added.

### F5. WP2's contract suite cannot be passed by an adapter with real crypto

- ID: `F5`
- Origin: `WP6`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`, `Test-design`
- Summary: `run_contract_suite` asserts signature behaviour using its own fake
  header scheme (`x-fake-signature: valid`). A correct adapter rejects that
  header, so no adapter with real signature verification can pass the suite
  without weakening its own crypto.
- Evidence: WP6 ran the suite against a test-local subclass overriding only
  `verify_signature`, leaving the real HMAC path intact, and flagged the
  arrangement rather than weakening the adapter.
- Files: WP2's contract suite; `core/channels/adapters/slack/signature.py`
- Cause: The suite fixes the signature scheme instead of injecting it.
- Suggested Fix: Have the suite take signature verification from the adapter
  under test (or a per-adapter fixture pair of valid/invalid requests). Every
  future adapter hits this, so fix the suite, not each adapter.
- Notes: WP6's workaround is sound but it means the suite's two signature
  assertions currently prove nothing about the real adapter.

### F6. No route writes the `connection.data` keys the Slack adapter reads

- ID: `F6`
- Origin: `C2 merge`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: The Slack adapter reads `signing_secret`, `bot_token`, `bot_user_id`
  and `team_id` off `connection.data`. WP8's configuration API exposes
  connections read-only — no create or edit route, no `data` field — so nothing
  in the merged tree can configure a Slack connection.
- Evidence:
  - `core/channels/adapters/slack/adapter.py:50-65,293,352` — the four reads.
  - `apis/fastapi/channels/models.py` — `ChannelConnectionsQueryRequest` has
    scalar filters only; no create/edit request model exists.
  - The key names have no design-doc basis; WP6 inferred them from
    `Connection.provider_connection_id`'s existing pattern.
- Files: `api/oss/src/core/channels/adapters/slack/adapter.py`,
  `api/oss/src/apis/fastapi/channels/models.py`
- Suggested Fix: When the linking flow lands (WP13's UI / the connections
  surface), pin these four key names in a design doc first — an adapter reading
  keys nobody documented is one rename away from a silent failure.

### F7. `enqueue_output` and `deliver` are stubs; WP5 reaches past them to the DAO

- ID: `F7`
- Origin: `WP5`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Layering`
- Summary: `ChannelsService.enqueue_output` and `.deliver` still raise
  `NotImplementedError`. Rather than call stubs, the outbox worker calls
  `channels_service.channels_dao.*` directly. `specs-wp5.md` describes those DAO
  methods as "reached through the service", which is ambiguous enough to permit
  either reading.
- Files: `api/oss/src/core/channels/service.py`,
  `api/oss/src/tasks/asyncio/channels/outbox.py`
- Cause: WP1 left the methods stubbed; WP5 needed the behaviour.
- Suggested Fix: Implement the two service methods and route the worker through
  them. Router→Service→DAO applies to new domain folders, and this is one.
  WP5 left the seam clean enough that this is a small change.
- Alternatives: Adopt DAO-direct as the real contract and delete the stubs —
  but that contradicts the layering rule for new folders.

### F8. WP4 widened two signatures on WP1's frozen service

- ID: `F8`
- Origin: `WP4`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Consistency`
- Summary: `compose_input` and `open_turn` now take an `event_id` beyond
  `entities.md` §8's frozen signatures, because "the latest event in the
  space's log" is not reliably the same row once a second message races in
  between `resolve()` and `open_turn()`.
- Files: `api/oss/src/core/channels/service.py`, `docs/.../entities.md`
- Suggested Fix: The reasoning is sound and the race is real — update
  `entities.md` §8 to match the code rather than reverting. Whichever document
  loses must be corrected, or the next package inherits the stale signature.

### F9. `SessionTurnInUse` is matched by class name and is unreachable today

- ID: `F9`
- Origin: `WP4`
- Severity: `P2`
- Confidence: `medium`
- Status: `open`
- Category: `Correctness`, `Test-coverage`
- Summary: The retry-on-refusal path recognises `SessionTurnInUse` by
  `type(e).__name__` string match, deliberately, so channels never imports
  `core/sessions/*`. But that exception is raised by
  `core/sessions/streams/service.py` and is not reachable from
  `invoke_workflow_detached` — so the retry loop has never run against a real
  overlapping turn.
- Files: `api/oss/src/tasks/asyncio/channels/inbox.py`
- Confidence note: `medium` because "unreachable" is WP4's tracing of the call
  path, which I have not independently walked.
- Suggested Fix: Confirm whether an overlapping channels-originated invoke can
  produce a 409 at all. If it cannot, the retry loop is dead code and should
  say so; if it can, the string match needs an integration test.

### F10. Catalog path contradiction between two design documents

- ID: `F10`
- Origin: `WP8`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Consistency`
- Summary: `specs-wp8.md` gives `/catalog/channels/`; `entities.md` §9's worked
  router gives `/catalog/`, reasoning that "channels" should not appear twice.
  WP8 implemented its own spec and flagged the conflict rather than choosing
  silently.
- Files: `docs/.../workstreams/specs-wp8.md`, `docs/.../entities.md`,
  `api/oss/src/apis/fastapi/channels/router.py`
- Suggested Fix: `entities.md` is right — the router mounts under `/channels`,
  so the spec's path reads `/channels/catalog/channels/`. Change the route and
  correct `specs-wp8.md`.

### F11. C0 put wire request/response models in the core DTO module

- ID: `F11`
- Origin: `C0`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Layering`
- Summary: The request/response envelopes live in `core/channels/dtos.py`, but
  `api/AGENTS.md` says core DTOs never reach the wire. This is a C0
  transcription error, not a package's choice.
- Evidence: `apis/fastapi/channels/models.py` re-exports them under aliased
  names rather than forking a second definition.
- Files: `api/oss/src/core/channels/dtos.py`,
  `api/oss/src/apis/fastapi/channels/models.py`
- Suggested Fix: Move the envelopes to the FastAPI layer and drop the
  re-export. WP8's choice to re-export rather than duplicate was right — a
  forked definition is exactly the wave-1 defect shape.

### F12. `ChannelSpaceDiscoverRequest` has no design-doc basis

- ID: `F12`
- Origin: `WP8`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Consistency`
- Summary: Invented to give `POST /spaces/discover` a body, following the house
  `*Request` convention. Flagged by WP8 under the "do not invent names" rule
  even though the invention was judged necessary.
- Files: `api/oss/src/apis/fastapi/channels/models.py`
- Suggested Fix: Bless it in the spec or rename it. Low stakes; the point is
  that it entered the tree undocumented.

### F13. Slack button rendering drops WP5's `value`

- ID: `F13`
- Origin: `C2 merge`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: WP6 maps WP5's button `id` into Slack's `value` field and discards
  WP5's own `value`. Self-consistent as long as the inbound action path also
  reads `id`, but it is a lossy mapping that no test pins.
- Evidence: Verified by feeding WP5's `RenderPart` list through WP6's
  `_render_content`: `{"id": "a", "value": "ok"}` renders as
  `{"type": "button", ..., "value": "a"}` — the `"ok"` is gone.
- Files: `api/oss/src/core/channels/adapters/slack/mapping.py`
- Suggested Fix: Confirm the interaction path reads `id` back, and add a
  round-trip test. Revisit when the button-click ingress lands.

### F14. 30 unit tests open external connections, and collide over them

- ID: `F14`
- Origin: `pre-existing`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Test-design`
- Summary: A unit test must need nothing running (see `Decisions`). 30 files
  under `oss/tests/pytest/unit/` construct a `TransactionsEngine`, an async
  engine, an `ObjectStore`, or a Redis client — so they are integration tests
  filed as unit tests. **They pass under the canonical configuration**; the
  finding is the latent fragility, not a current failure.
- Evidence:
  - 30 files match `TransactionsEngine|create_async_engine|engine.session()|ObjectStore|redis`
    under `unit/`: 18 in `sessions/`, 3 in `events/`, 2 in `triggers/`, 2 in
    `git/`, the rest in `mounts/`, `utils/` and evaluation.
  - Canonical run before merging `main`: **2655 pass, 0 fail** in the unit layer.
  - Canonical run **after** merging `main` (`e73fb2efce`, v0.110.0): **2652 pass,
    1 error** — `unit/sessions/test_turns_dao.py::test_append_turn_persists_and_query_returns_turn_id`,
    which opens a `TransactionsEngine` and passes in isolation. It arrived from
    main in `a3336572b2` ("rebase session turns/streams backend onto v0.105.5").
    So the order-dependence does surface under the canonical configuration once
    the population shifts — the earlier clean runs were luck, not proof.
  - Ad-hoc runs with hand-set `POSTGRES_URI_*` did fail — 4 in `unit/git/` on
    **both** `channels-c1` and `channels-c2`, with
    `asyncpg.exceptions.ForeignKeyViolationError`. Same on both branches, so
    never channels; but also not reproducible under the real configuration.
- Files: 30 under `api/oss/tests/pytest/unit/`, mostly `sessions/`
- Suggested Fix: Move each to `integration/` (needs one runtime dep, still
  unit-like) or `acceptance/` (point-like or flow-like end to end). Outside
  channels' scope — raise with the owners rather than fixing here.
- Notes: **Corrects earlier diagnoses in this record, three times over.** First
  reported as erroring for want of a reachable Postgres — wrong, they reach one
  fine. Then as colliding over shared state and failing in any full-layer run —
  also wrong: that only happened under my own ad-hoc env, and the canonical
  configuration is green. The scope was also given as `git/` + `sessions/`; it is
  30 files across seven areas. What survives all three corrections: these tests
  open connections, which makes them misfiled by the rule, and misfiling is why a
  wrong invocation could produce failures that read as a branch regression.
  **No channels unit test is among them** — verified empirically: 259 pass with
  Postgres, Redis and the api all stopped.

### F22. Channels integration tests error instead of skipping without Postgres

- ID: `F22`
- Origin: `test-layer audit`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Test-design`
- Summary: With Postgres stopped, all 41 channels integration tests **error**
  (`OSError: Connect call failed ... 5432`) rather than skipping. The acceptance
  layer already solves this: `acceptance/conftest.py` has a
  `_postgres_reachable()` probe and an autouse fixture that skips
  database-adjacent tests. `integration/channels/conftest.py` has no such guard.
- Evidence:
  - Stack down, `--layer integration -- oss/tests/pytest/integration/channels`:
    `27 warnings, 41 errors`.
  - `oss/tests/pytest/acceptance/conftest.py:11-36` — the probe and skip that
    should be mirrored (its own comment says it exists so "a remote-stage run
    skips those instead of failing on name resolution").
  - Same run for acceptance: `3 skipped`, no errors.
- Files: `api/oss/tests/pytest/integration/channels/conftest.py`
- Cause: The integration conftest was written when a deployment was assumed
  present; the acceptance one was hardened later and the fix never moved across.
- Fix: **Applied.** The probe moved to `oss/tests/pytest/utils/postgres.py` as
  `postgres_reachable()`, with a new autouse guard in
  `oss/tests/pytest/integration/conftest.py` covering the whole layer (not just
  channels — future integration tests inherit it). The acceptance conftest now
  imports the same function instead of holding a second copy.
- Verified: Postgres stopped → **41 skipped, 0 errors** (was 41 errors).
  Postgres up with the EE URI → **40 pass, 1 fail (`F18`), 0 errors**.
- Notes: The tests themselves were correctly placed — they need a real database,
  which is what makes them integration. Only the missing-dependency behaviour
  was wrong. Worth recording one trap hit while fixing it: the probe reads
  `env.postgres.uri_core`, whose host is `postgres` by default and only becomes
  `localhost` because `py-run-tests` exports `POSTGRES_HOST`. Probing outside
  that wrapper reports unreachable against a healthy database — so the probe must
  read the env as the tests see it, and a "clean skip" observed outside the
  wrapper is a false pass.

### F24. Four test layers are empty across ee and services

- ID: `F24`
- Origin: `test-layer audit`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Test-design`
- Summary: An empty layer folder means the setup was never completed, not that
  the layer does not apply — every part needs all three. Counts of test files:

  | Part | unit | integration | acceptance |
  | --- | --- | --- | --- |
  | `api/oss` | 193 | 10 | 101 |
  | `api/ee` | 17 | **0** | 11 |
  | `sdks/python/oss` | 109 | 9 | 13 |
  | `services/oss` | 11 | 3 | 3 |
  | `services/ee` | **0** | **0** | **0** |
  | `services/runner` (ts) | 122 | 1 | 1 |

- Cause: A missing integration layer pushes its tests into `unit/` (where they
  become order-dependent — `F14`) or into `acceptance/` (where they skip on any
  machine without a full stack). Both hide coverage rather than remove the need
  for it.
- Files: `api/ee/tests/pytest/integration/`, `services/ee/tests/pytest/`
- Suggested Fix: Not channels' scope. Raise with those owners; recorded here
  because the same gap is what produced `F14` and `F22`.
- Notes: `services/runner`'s integration and acceptance layers exist but hold one
  file each against 122 unit files — thin enough to be worth a look, though not
  empty.

### F23. Channels test layering is otherwise compliant — verified, not assumed

- ID: `F23`
- Origin: `test-layer audit`
- Severity: `P3`
- Confidence: `high`
- Status: `not-a-defect`
- Category: `Test-design`
- Summary: Audited all channels tests against the repo rule (a `unit/` test may
  import anything but must need nothing *running*, including its own server).
  No violations beyond `F22`'s skip behaviour.
- Evidence:
  - **Unit: 259 pass with Postgres, Redis and the api all stopped.** The
    decisive check, not a code read.
  - Two unit files construct a `FastAPI()` and drive it via `TestClient`
    (`test_channels_ingress.py`, `test_channels_router.py`). In-process ASGI
    starts no server, and 53 of those pass with the api container stopped — so
    they are correctly unit.
  - The two seam tests use in-process ASGI **plus a real database**; the
    database is the runtime dep that makes them integration. Correct.
  - `acceptance/channels/test_slack_adapter_live.py` is `skipif`-gated on
    `SLACK_BOT_TOKEN`/`SLACK_TEST_CHANNEL`: 3 skipped, 0 errors without them.
- Notes: Recorded because "we checked and it holds" is worth keeping — the next
  person auditing this should not have to re-derive it. Also fixes a claim made
  earlier in this record that channels unit tests were clean *by inspection*;
  they are clean, but the grep behind that claim had a false positive
  (`self.requests.append` in a fake matched a `requests.` library pattern), so
  the empirical check is the evidence, not the grep.

### F21. 19 runner tests fail, unrelated to channels

- ID: `F21`
- Origin: `pre-existing`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Test-coverage`
- Summary: `ts-run-tests --runner -ui` reports 19 failures across three files:
  `commit-authorization.test.ts`, `sandbox-agent-acp-interactions.test.ts`,
  `workspace-import.test.ts`. 2070 pass.
- Evidence: The same three files, at the same count, before wave 1 and after
  the C2 redeploy. Channels ships no TypeScript — no branch in this feature
  touches `services/runner/`.
- Files: `services/runner/tests/unit/`
- Suggested Fix: Not ours. Raise with the runner owners.
- Notes: Recorded only so a red runner suite is not read as channels
  regression. One observed failure logs `ownership claim failed
  session=sess-1: network unreachable`, which suggests these also want an
  environment they do not declare — same family as `F14`.

### F26. The bridge ingress route is public and mounted, but no bridge adapter exists

- ID: `F26`
- Origin: `wave-2`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Security`
- Summary: `/channels/bridge/events/` is registered as a route and listed in
  `_PUBLIC_ENDPOINTS` (four entries, as designed), but WP12 — the bridge
  adapter — is not built. An unauthenticated POST therefore reaches a channel
  the registry cannot resolve.
- Evidence: The route appears in the OpenAPI schema after the CU-1 wiring
  (22 channels paths). `registry.keys()` returns `['slack']` only. `_ingest`
  calls `self.adapter_registry.get(channel)` before reading the body, so the
  request fails at resolution.
- Files: `api/oss/src/apis/fastapi/channels/ingress.py`,
  `api/oss/src/middlewares/auth.py`
- Suggested Fix: None needed for safety. Close it when WP12 lands by pointing a
  test at the route; until then leave the entry in place rather than
  churning `_PUBLIC_ENDPOINTS` twice.
- Notes: Verified benign rather than assumed benign: `ChannelNotSupported` is
  raised before `verify_signature`, before `parse_event` and before any DAO
  call, and `handle_channel_adapter_exceptions` maps it to 404. So the exposure
  is an unauthenticated 404 on an unimplemented channel — no write, no
  signature oracle, no 500. Recorded because "public route, no adapter" is the
  kind of pairing that stops being harmless the moment someone registers a
  permissive default adapter.

### F27. The alembic config paths are container-absolute, so `entrypoints.routers` cannot be imported locally

- ID: `F27`
- Origin: `pre-existing`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Testability`
- Summary: Importing `entrypoints.routers` outside the container fails at
  module scope. `env.alembic.cfg_path_core` defaults to `/app/...`, and the
  ini it points at hardcodes `script_location = /app/oss/databases/...`, so
  even overriding the env var is not enough — the ini's own path must be
  rewritten too.
- Evidence: `alembic.util.exc.CommandError: Path doesn't exist:
  /app/oss/databases/postgres/migrations/core`, raised from
  `oss/databases/postgres/migrations/core/utils.py:23`, which runs
  `ScriptDirectory.from_config` at import time.
- Files: `api/oss/databases/postgres/migrations/core/alembic.ini:5`,
  `api/oss/src/utils/env.py:616-620`,
  `api/oss/databases/postgres/migrations/core/utils.py:23`
- Suggested Fix: Make `script_location` relative to the ini, or resolve it from
  the package location. A repo-relative default would let the composition root
  be imported — and therefore asserted — without a container.
- Notes: Found while verifying CU-1. Worked around with a rewritten ini in a
  scratch directory; the repo was not changed. The cost is that no test can
  assert the composition root's wiring, which is exactly the class of defect
  `F1` was: four disconnections that every green suite missed because nothing
  imports this module.

## Closed Findings

### [CLOSED] F1. Nothing connected the ingress, the workers, the registry or the configuration router

- ID: `F1`
- Origin: `C1`
- Severity: `P0`
- Confidence: `high`
- Status: `closed`
- Category: `Correctness`
- Summary: The merged tree had an ingress that logged events, a dispatcher that
  would route them, a worker that would answer, and an adapter that could talk
  to Slack — none connected. Four gaps, not the three originally recorded.
- Evidence, before the fix: `ChannelAdapterRegistry(adapters={})` at
  `routers.py:1058` (so `registry.get("slack")` raised `ChannelNotSupported`);
  `dispatch_task=None` at `routers.py:1071`; no channels entry in
  `worker_queues.py`'s broker map; and `ChannelsRouter` — the whole
  configuration surface — was never imported or mounted. Only the ingress
  router was.
- Files: `api/entrypoints/routers.py`, `api/entrypoints/worker_queues.py`
- Fix: The Slack adapter is registered (stateless; the connection is passed per
  call). Two `ProducerOnlyRedisStreamBroker`s enqueue `channels.inbox.dispatch`
  and `channels.outbox.poll`; `_build_channels_inbox_broker` and
  `_build_channels_outbox_broker` consume them, mirroring
  `_build_triggers_broker`. `ChannelsRouter` is mounted under `/channels` and
  `/preview/channels`, authenticated. `ALL_QUEUES` gained the two queue names.
- Verification: `registry.keys() == ['slack']`; `dispatch_task` is
  `AsyncTaskiqDecoratedTask(channels.inbox.dispatch)`; both queues resolve; and
  22 channels paths appear in the **OpenAPI schema** — checked there, not in
  `app.routes`, which does not expand an included router.
- Notes: **Wired, not exercised.** No message has travelled the path; the
  verification is structural. That distinction is the point — the four gaps
  closed here were invisible to every green per-package suite, and a fifth
  would be too. Also worth noting no hosting change was needed: every compose
  file and the Helm chart set `AGENTA_WORKER_QUEUES` empty, which selects all
  queues, so the two new consumers start on the next deploy.
- Follow-ups: `F26` (public bridge route, no adapter) and `F27` (the
  composition root cannot be imported outside a container, which is why this
  was missable at all).

### [CLOSED] F18. An addressing event was never attached to its space

- ID: `F18`
- Origin: `first integration run`
- Severity: `P0`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `compose_input` builds the turn's content from
  `query_events_since(space_id=...)`, but the ingress writes every inbound event
  with `space_id=None` — it cannot do otherwise, since the space is resolved
  later. Nothing back-filled the column, so the query matched no rows and the
  agent was invoked with empty content on every turn.
- Evidence:
  - `apis/fastapi/channels/ingress.py:143-151` constructs
    `ChannelInboxEventCreate` with no `space_id`; the field defaults to `None`.
  - `dbs/postgres/channels/dao.py` — `query_events_since` filters on `space_id`,
    and `ix_channel_inbox_events_log` is keyed `(project_id, space_id, origin,
    id)`, so querying by locator instead would have abandoned the index.
  - `test_resolve_sigil_creates_thread_and_open_turn_writes_started_row` failed
    `assert turn_input.content == event.data.processed.content` with `[] == [...]`.
- Fix: `resolve()` now attaches the event to the space it resolved, via a new
  `attach_event_to_space` on the DAO (declared on `ChannelsDAOInterface`,
  idempotent — a redelivery re-resolving the same space is a no-op and does not
  touch `updated_at`). Placed **before** the refusal paths: an unanswered message
  still belongs to its space.
- Verified: api integration 41 → 43 pass (two new tests pin the mechanism and its
  idempotency, not just the symptom); full api suite 2655 / 43 / 802, zero
  failures.
- Notes: Two fakes broke when the interface widened — a `MagicMock` returning a
  non-awaitable, and `FakeChannelsDAO` refusing to instantiate as an abstract
  class. Both are the *good* failure mode: the fake that implements the real
  interface told us immediately, which is exactly what `c1-merge-notes.md` argues
  for.

### [CLOSED] F19. `compose_idempotency_key` crashed on every first send

- ID: `F19`
- Origin: `first integration run`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: The util called `updated_at.isoformat()` unconditionally, but
  `updated_at` is nullable with no server default (unlike `created_at`), so it
  is `None` on every freshly-inserted outbox row — i.e. on every first send.
- Evidence: `AttributeError: 'NoneType' object has no attribute 'isoformat'` in
  two outbox integration tests; `dbs/postgres/shared/dbas.py:98-101` shows the
  column has no default.
- Fix: A null `updated_at` keys off the row identity alone; later revisions key
  off their own timestamp, preserving the "one token per revision" contract.
- Commit: `48204802ea`

### [CLOSED] F20. `HarnessKind.CLAUDE_CODE` does not exist

- ID: `F20`
- Origin: `first integration run`
- Severity: `P3`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: A WP5 integration test referenced `HarnessKind.CLAUDE_CODE`; the
  enum's members are `PI`, `CLAUDE`, `AGENTA`, `CODEX`.
- Fix: Corrected to `HarnessKind.CLAUDE`.
- Commit: `48204802ea`
- Notes: A test-only bug, and a good argument for the policy that
  written-but-unrun tests are provisional until a checkpoint runs them.

### [CLOSED] F15. Turns ran as the agent's creator, not the platform sender

- ID: `F15`
- Origin: `C2 merge`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`, `Security`
- Summary: WP4 shipped with the invoking `user_id` set to
  `resolution.agent.created_by_id` because WP7 had not landed. `architecture.md`
  §5 requires the turn to run under the platform sender's linked account. WP7
  shipped `resolve_link` whose docstring names WP4 as its caller. Both were
  green alone; only the merge could connect them.
- Evidence: `tasks/asyncio/channels/inbox.py:276` before the fix, with a
  comment stating WP7 "does not exist yet" — untrue once merged.
- Files: `api/oss/src/tasks/asyncio/channels/inbox.py`,
  `api/oss/src/core/channels/service.py`
- Fix: The dispatcher takes an optional `ChannelIdentityService`, resolves the
  sender's link, and passes `user_id` to the invoke; absent a link or a
  service, it falls back to the agent's creator. `resolve_channel` became
  public so the dispatcher can fetch capabilities. Four tests added.
- Commit: `bd9c5683f9`

### [CLOSED] F16. Composing the identity key off the scope's own name

- ID: `F16`
- Origin: `C2 merge`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: Introduced while fixing `F15` and caught before commit. Slack
  declares `identity.scope: "workspace"` but locates by `team`, so
  `locator.get(capabilities.identity.scope)` returns `None` — silently, without
  raising, producing a wrong but plausible key for every Slack sender.
- Evidence: `adapters/slack/capabilities.py:28` declares `"scope":
  "workspace"`; `adapters/slack/mapping.py:44` builds `{"team": ..., "channel":
  ...}`.
- Fix: `scope_id` now comes from `capabilities.identity.keys[SPACE][0]` — the
  first declared space key, which is the field that bounds the scope. Pinned by
  `test_scope_id_comes_from_the_declared_space_key_not_the_scope_name`.
- Commit: `bd9c5683f9`
- Notes: The near-miss is the lesson: a capability vocabulary that reads
  plausibly as a locator key is exactly the shape that survives a green suite.
  Same family as C0's `ChannelKeyGrain`/`ChannelSessionScope` confusion.

### [CLOSED] F17. Suspected render-vocabulary disagreement between WP5 and WP6

- ID: `F17`
- Origin: `C2 merge`
- Severity: `P1`
- Confidence: `high`
- Status: `not-a-defect`
- Category: `Correctness`
- Summary: I reported WP5 and WP6 as disagreeing about button shape — WP5
  emitting one flat part per button, WP6 emitting a grouped `{"type":
  "buttons", "elements": [...]}`. That was a misreading: WP6's grouped form is
  its Slack Block Kit **output**, not the internal vocabulary. Its entry point
  filters `item.get("type") == "button"`, matching WP5 exactly.
- Evidence: Feeding WP5's `RenderPart` list through WP6's `_render_content`
  produced one `actions` block containing two real buttons, text preserved.
- Files: `api/oss/src/core/channels/render/dtos.py`,
  `api/oss/src/core/channels/adapters/slack/mapping.py`
- Notes: Both packages independently anchored to the contract suite's
  `post_message` fixture, which is why they agree. Kept as a closed finding
  because "we checked and it holds" is worth recording — the next person will
  otherwise re-derive the same suspicion. See `F13` for the one real defect the
  check did surface.
