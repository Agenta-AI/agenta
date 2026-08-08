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
- **Verified state at `5d6af1f774`, against a from-scratch EE deployment** —
  all four suites, every layer:

  | Suite | Unit | Integration | Acceptance |
  | --- | --- | --- | --- |
  | api | 2372 pass (4 fail, `F14`) | 40 pass, **1 fail (`F18`)** | 751 pass |
  | sdk | 1974 pass | 146 pass | 124 pass |
  | services | 100 pass | 15 pass | 145 pass |
  | runner | 2070 pass (19 fail, `F21`) | — | — |

  `F18` is the only channels failure anywhere. Acceptance needs
  `AGENTA_API_URL=http://localhost/api` (the `/api` prefix — bare `http://localhost`
  reaches the web app and returns HTML 500s) and `AGENTA_AUTH_KEY`, readable
  from the running api container.
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
- Deployment happens at checkpoints only, never per work package.

## Open Findings

### F18. An addressing event is never attached to its space, so the agent sees empty input

- ID: `F18`
- Origin: `first integration run`
- Severity: `P0`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: `compose_input` builds the turn's content from
  `query_events_since(space_id=...)`, but the ingress writes every inbound event
  with `space_id=None` — it cannot do otherwise, since the space is resolved
  later, during `resolve()`. Nothing ever back-fills the column, so the query
  matches no rows and the agent is invoked with empty content.
- Evidence:
  - `apis/fastapi/channels/ingress.py:143-151` constructs
    `ChannelInboxEventCreate` with no `space_id`; the field defaults to `None`
    (`core/channels/dtos.py:475`).
  - `core/channels/service.py:736-757` — `compose_input` reads via
    `query_events_since`.
  - `dbs/postgres/channels/dao.py:932-935` — that query filters
    `space_id == space_id`.
  - `test_resolve_sigil_creates_thread_and_open_turn_writes_started_row` fails
    `assert turn_input.content == event.data.processed.content` with `[] ==
    [{'type': 'text', ...}]`.
- Files: `api/oss/src/core/channels/service.py`,
  `api/oss/src/apis/fastapi/channels/ingress.py`,
  `api/oss/src/dbs/postgres/channels/dao.py`
- Cause: The event row is written before the space exists, and no write path
  attaches the two afterwards. Every unit test covering this used a fake DAO
  whose query ignored `space_id`, so the gap was invisible until a real table.
- Suggested Fix: Have `resolve()` attach the resolved space to the addressing
  event (a new DAO write), or have `compose_input` locate events by
  `connection_id` + locator rather than `space_id`. The first keeps the query
  cheap and the column meaningful; it needs a method on WP1's DAO.
- Notes: Not fixed at C2 — adding a write path to the frozen DAO mid-checkpoint,
  against a live deployment, is a bigger change than a checkpoint fix should
  make unilaterally. It blocks any end-to-end turn, so it should lead C3.
- Related: `F1` — until the entrypoints are wired, no production path reaches
  this code, which is why it surfaced in a test rather than a deployment.

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
- Summary: A unit test may read env values but must not open a connection to
  anything (see `Decisions`). 30 files under `oss/tests/pytest/unit/` construct
  a `TransactionsEngine`, an async engine, an `ObjectStore`, or a Redis client.
  They pass when selected alone and fail in a full-layer run, because they
  share one database with no per-test isolation — so the layer is not just
  mislabelled, it is order-dependent.
- Evidence:
  - 30 files match `TransactionsEngine|create_async_engine|engine.session()|ObjectStore|redis`
    under `unit/`: 18 in `sessions/`, 3 in `events/`, 2 in `triggers/`, 2 in
    `git/`, the rest in `mounts/`, `utils/` and evaluation.
  - `unit/git/` alone: 31 passed on both `channels-c1` and `channels-c2`.
  - Full `--layer unit`: 4 failed on **both** branches (C1 with 5 errors, C2
    with 3) — the failures track the run mode, not the branch.
  - The failure is `asyncpg.exceptions.ForeignKeyViolationError`: rows another
    test removed.
- Files: 30 under `api/oss/tests/pytest/unit/`, mostly `sessions/`
- Suggested Fix: Move each to `integration/` (one external dependency, still
  unit-like) or `acceptance/` (point-like or flow-like end to end). Outside
  channels' scope — raise with the owners rather than fixing here.
- Notes: **Corrects an earlier diagnosis in this record**, twice over. These
  were first reported as erroring for want of a reachable Postgres — wrong,
  they reach one fine and collide over shared state. And the scope was given as
  `git/` + `sessions/`; it is 30 files across seven areas. **No channels unit
  test is among them** — verified, all 259 use fakes.

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

## Closed Findings

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
