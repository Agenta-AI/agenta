# Findings: Channels

> Branch: `channels-c3`
> Opened on: `2026-08-07` at checkpoint C2, carried through C3
> Effective path: `docs/design/channels-research/v2`

## Sources

- Wave-1 merge defects: `workstreams/c1-merge-notes.md`
- Per-package ledgers: `workstreams/tasks-wp{1..8}.md`
- Wave-2 package reports (WP4, WP5, WP6, WP7, WP8), C2 merge
- Wave-3 package reports (WP0, WP9, WP10, WP13, WP15, WP16), C3 merge
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
- Status: `closed`
- Closed by: `CU-2`. 109 citation lines across 43 files — not the 77 estimated here,
  which counted source only and missed the test tree. Zero remain; verified
  comment-only by AST comparison with docstring nodes stripped, and the unit layer
  was unchanged at 2344 passed / 52 skipped.
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


### F2. No scheduler drives `channels.outbox.poll`

- ID: `F2`
- Origin: `WP5`
- Severity: `P1`
- Confidence: `high`
- Status: `superseded`
- Superseded by: `F31` and `WP18` — the answer is the third option this finding
  listed. The outbox subscribes to `streams:sessions` and `poll_turn` is deleted,
  so no scheduler is ever needed.
- Category: `Completeness`
- Summary: The outbox worker exposes a poll entry point, but nothing invokes it
  repeatedly. WP5 searched for a taskiq periodic-task primitive to copy and
  found none in this codebase.
- Files: `api/oss/src/tasks/taskiq/channels/outbox_worker.py`
- Suggested Fix: Decide the mechanism (taskiq scheduler, an external cron, or
  riding WP0's session events once they land). WP5 built against polling
  deliberately so the source can be swapped.
- Related: `F3` — WP0's arrival changes this.

### [CLOSED] F3. WP0 (session events) is unowned and blocks WP5's final form

- **Verified closed.** Both publishes, the stream consumer and the outbox's
  turn-event handler are merged and wired in the stream entrypoint; `poll_turn`
  exists nowhere in the tree. Wave 5 had listed this as work still to do.

- **Resolved in part:** WP0 is built and merged (wave 3) — it is no longer unowned.
  What remains is `F31`: the stream has no registered consumer, which is `WP18`.
- ID: `F3`
- Origin: `planning`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
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
- Status: `resolved`
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
- Resolution: a second adapter with real HMAC now passes the shared suite, and the suite's connection became injectable (`F44`).


### F6. No route writes the `connection.data` keys the Slack adapter reads

> **Widened by `F47`.** This is not only Slack's four keys nor only a missing
> route: no channel declares a credential schema, and no channel has an
> onboarding flow. Read `F47` first.

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

### F47. No channel declares its credential schema, and no channel has an onboarding flow

- ID: `F47`
- Origin: `wave-4 review`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: **`F6` understates this.** It reads as "no route writes four Slack
  keys" — a plumbing gap. The real gap is two structural ones, and they apply to
  every channel, in-process and bridged alike:
  1. **No channel declares what credentials it needs.** `ChannelCapabilities`
     declares `fill`, `rendering` and `identity` — what a channel can *do* — and
     nothing about what it must be *given*. Each adapter reads private keys off
     `connection.data` that exist only in its own source.
  2. **No channel has an onboarding flow.** Nothing creates a connection with
     credentials in it, for any channel.
- Evidence:
  - Slack reads `signing_secret`, `bot_token`, `bot_user_id`, `team_id`; the
    bridge reads `secret` and `delivery_url`. **Six key names, zero documented.**
    The bridge package stated plainly that it invented its two.
  - `api/oss/src/core/channels/adapters/slack/manifest.py` exists and builds a
    real Slack app manifest — and **nothing calls `build_slack_manifest`**. A
    generator written for a flow that was never built.
  - The contract suite had to hardcode one platform's credential field names
    because there is no schema to consult (`F44`).
- Files: `api/oss/src/core/channels/dtos.py` (no credential declaration),
  `api/oss/src/core/channels/adapters/slack/manifest.py` (uncalled),
  `api/oss/src/apis/fastapi/channels/models.py` (no create/edit route)
- Suggested Fix: two distinct pieces, and the first blocks the second.
  - **A declared credential schema per channel**, alongside the capability
    declaration and normalised the same way: field name, whether it is secret,
    and whether it is required. Then `connection.data` has a contract, a config
    UI can be generated from it, and the contract suite can build a valid
    connection for any adapter rather than for one.
  - **Per-channel onboarding, which does not generalise.** Slack is an app
    manifest plus OAuth; Telegram is a bot token from a chat with BotFather, no
    OAuth at all; Discord is an application with a bot user and a gateway intent;
    a bridge is a shared secret and a delivery URL the operator holds on both
    ends. A single "connect a channel" flow cannot cover these — what generalises
    is the *schema*, not the ceremony.
- Notes: **This is the difference between the two transports, correctly located.**
  A bridge is self-hosted, so its operator can be handed a secret and a URL and
  set both env-side; that is why it appears to need no onboarding. A first-party
  channel cannot work that way — the credential comes from the platform, through
  a flow only the platform defines. The *ingress* mechanism is uniform (one
  `_ingest`, no branch on channel); **provisioning is where they genuinely
  differ**, and nothing in the design covers it for either.

### F54. Bridge credentials cannot go through the vault at all

- ID: `F54`
- Origin: `wave-5 M3`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: The nested channel-secret kind covers `slack` and `agenta`. A bridge
  connection's credentials are a `secret` and a `delivery_url`, and no inner kind
  names them, so the write path raises when asked to store one. The connection can
  be created only by leaving its credentials somewhere the vault is not.
- Files: `api/oss/src/core/secrets/enums.py`,
  `api/oss/src/core/secrets/dtos.py`,
  `api/oss/src/core/channels/service.py`
- Suggested Fix: a `bridge` inner kind with those two fields. Cheap; it was missed
  because the bridge has no setup UI and nothing exercised its write path.
- Notes: found by the hydration work, which reads back whatever the write path can
  store and therefore noticed what it cannot.

### F55. Routing does not refuse an archived or inactive agent

- ID: `F55`
- Origin: `wave-5 M3`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: `fetch_agent`, `fetch_agent_by_slug`, `fetch_default_agent` and `resolve`
  never filter on `deleted_at` or the active flag. Archiving a connection now
  cascades `deleted_at` onto its agents, and nothing downstream declines to route to
  them — so teardown removes a bot from the configuration surface while leaving it
  answering.
- Files: `api/oss/src/dbs/postgres/channels/dao.py`,
  `api/oss/src/core/channels/service.py`
- Suggested Fix: filter archived and inactive rows in the routing reads. Assert that
  archiving a connection stops its agents answering — the archive path is what makes
  this reachable, so it needs the test that proves teardown is a teardown.
- Notes: the gap predates the archive route; the archive route is what makes it
  matter.

### F58. The connection create model demands a field the service overwrites

- ID: `F58`
- Origin: `wave-5 CU-C`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `ChannelConnectionCreate.external_key` was required, directly under a
  comment reading *"derived, never taken from the caller"*. A caller could not know
  the value, and whatever it sent was overwritten, so every create answered 422
  until a meaningless value was invented to satisfy the model.
- Fix: optional on the create shape; the service still always derives it.
- Notes: found by the first acceptance run. No unit test caught it, because the
  unit tests construct the DTO in Python rather than over the wire.

### F59. The acceptance check for the exit condition never configures an agent

- ID: `F59`
- Origin: `wave-5 CU-C`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: The end-to-end check creates a connection and posts a message, then
  waits for an answer. It never creates an agent, and never grants one. `resolve`
  therefore has nothing to route to, so no turn opens and no answer is ever posted.
  The test cannot pass as written, and its failure says "no reply within the
  timeout" — which reads like a broken pipeline rather than missing setup.
- Files: `api/oss/tests/pytest/acceptance/channels/test_agenta_channel_live.py`
- Suggested Fix: the setup needs a bound workflow revision, an agent referencing
  it and marked default, and one `ALLOW` grant by kind. That is real work: the
  agent must actually invoke, so the check also needs a runtime that can answer.
- Notes: **this is why the exit condition is not yet demonstrated.** Everything
  before the invoke is verified against the real stack — the write path, the public
  ingress at 202, and a space created on first contact with no pre-created row. The
  part from invoke to answer has still never run.

### F56. The rendering vocabulary in the design was never built, and the built one is undesigned

- ID: `F56`
- Origin: `wave-5 CU-B`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: `rendering.md` specifies six node types — `text`, `buttons`, `select`,
  `fields`, `table`, `image` — each with a declared text fallback, and states that
  this vocabulary is what stops the surface drifting into one platform's feature
  set. The implemented outbound vocabulary is `RenderPart` with
  `type: Literal["text", "button", "card"]`. So **four of the six designed nodes do
  not exist**, `buttons` is singular rather than grouped (the DTO's own docstring:
  *"One part per button, so a grouped multi-option part is never used"*), and `card`
  is implemented while appearing in no design document.
- Evidence: found when a surface was built from `rendering.md` and rendered nothing
  the API emits. A real answer arrives as several separate `button` parts plus
  `text`; the surface's grouped-node renderers matched none of it, so a choice could
  not be clicked — the one thing that surface exists to prove.
- Files: `api/oss/src/core/channels/render/dtos.py`,
  `api/oss/src/core/channels/render/render.py`,
  `docs/design/channels-research/v2/rendering.md`
- Suggested Fix: settle which vocabulary is real, in one direction, and make the
  other match. Two consequences either way: the capability declaration's
  per-node fallback story rests on the designed vocabulary, and `card` needs a
  designed meaning or removal.
- Notes: the surface now renders the live shape, so the exit condition is
  reachable — that is a workaround at the consumer, not a resolution. Nothing was
  wrong with either vocabulary in isolation; they were simply never reconciled, and
  a document that reads as current is how that survived four checkpoints.

### F57. The generated API client predates the channels connection shape

- ID: `F57`
- Origin: `wave-5 CU-B`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: The generated TypeScript client types the connections query response as
  the old shared gateway shape (`provider_key`, `integration_key`, `is_active`) and
  has no type for the channels connection at all. Seven routes that now exist are
  absent from it, and the grant type has no `kind` field, predating kind-based
  grants. Every web consumer therefore hand-writes its calls and validates at the
  boundary.
- Files: `web/packages/agenta-api-client/src/generated/api/types/`
- Suggested Fix: regenerate against a running API. It could not be done in this wave
  because regeneration needs a deployment.
- Notes: two web pages were reading fields the API had stopped returning, which the
  stale types could not catch — a generated client that lags is worse than none,
  because it type-checks a shape that no longer exists.

### F52. Slack slash commands are parsed as noise and silently dropped

- ID: `F52`
- Origin: `wave-5 M2`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: Slack posts a slash command as flat form-encoded fields with no
  `payload=` wrapper. The adapter's payload parser handles raw JSON and a
  `payload` form field only, so a slash command falls through to `{}` and
  `parse_event` classifies it as platform noise. It is acked and discarded.
- Evidence: found while wiring the connection-grain locator; the parser's two
  branches are the whole of its input handling.
- Files: `api/oss/src/core/channels/adapters/slack/adapter.py`
- Suggested Fix: recognise the flat form shape. Worth settling alongside the
  command grammar, since a slash command and a `!command` are the same intent
  arriving two ways — the same convergence the choice mechanism already uses.
- Notes: predates this wave. Not a regression.

### F53. Slack's enterprise-install payload shape is reconstructed, not observed

- ID: `F53`
- Origin: `wave-5 M2`
- Severity: `P2`
- Confidence: `low` — that is the finding
- Status: `open`
- Category: `Correctness`
- Summary: A connection's identity now composes from `api_app_id` plus whichever
  of `enterprise_id`/`team_id` applies, read from the event's `authorizations`
  with flat and nested fallbacks. Those field positions were derived from
  documentation, not from a captured payload. If the real shape differs, an
  org-wide install composes a key that matches no stored connection and every
  event refuses with a bare 401 — which is indistinguishable from a bad secret.
- Files: `api/oss/src/core/channels/adapters/slack/adapter.py`
- Suggested Fix: capture one real payload of each install kind and assert against
  it. Until then treat the org-wide path as unproven, and note that the failure
  mode is silent by design, so nothing will report it.
- Notes: the wave that proves Slack end to end is the place this gets settled;
  filed now so it is not discovered as a mystery 401 instead.

### F51. Every DM is silently refused: permission can only be granted to a space that already exists

- ID: `F51`
- Origin: `C4 design read`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: `resolve` default-denies when no `channel_spaces` row matches the event's
  composed space key, so permission is encoded as *"somebody pre-created a row"*.
  That is only expressible for `topic` spaces. A `private` space is one per user and
  comes into existence when someone talks; a `group` space is an ad-hoc set of
  people. So an agent can never answer a DM unless an operator pre-approved that
  exact DM — and a DM opened after setup could not have been.
- Evidence: `service.py` `resolve()` returns `None` with the comment *"default-deny:
  no configured space means the agent may not answer here, regardless of
  addressing"*. `capabilities.md` declares `spaces.private: true` for Slack.
  `classify_space_kind` correctly maps `is_im` to `PRIVATE`, so the event is
  understood and then refused. `channel_grants.space_id` is `nullable=False`, so a
  grant cannot name a kind.
- Files: `api/oss/src/core/channels/service.py`,
  `api/oss/src/dbs/postgres/channels/dbas.py`
- Suggested Fix: `grants.md` — space rows get created on first contact and authorise
  nothing; grants carry `effect` (allow/deny) and match by `kind` or by `space_id`,
  evaluated deny-first with default-deny unchanged.
- Notes: The refusal is silent by design (D17), so this presents as a bot that works
  in channels and ignores DMs with no diagnostic anywhere. Enumerating DMs is not a
  workaround: `conversations.list` does return them, but pre-approving every existing
  DM still leaves every future one refused.

### [CLOSED] F50. `space_locator` and `thread_locator` are computed by every adapter and dropped by the ingress

- **Fixed by deleting both fields.** Key composition takes the declared subset of
  the one `external_locator` per grain, which makes a per-grain locator redundant
  by construction rather than merely unused.

- ID: `F50`
- Origin: `C4 design read`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `ChannelInboundEvent` declares `space_locator` and `thread_locator`, and
  every adapter fills them. `_ingest` copies only `external_locator` into
  `ChannelInboxEventData`, which has no field for the other two. Both grains then
  compose from the one surviving locator via `identity.keys[grain]`. So the two
  fields are written, never read in production, and cannot affect behaviour.
- Evidence: `ingress.py` builds `ChannelInboxEventCreate` with
  `data=ChannelInboxEventData(external_locator=inbound.external_locator,
  processed=inbound.processed)` — the other two are not referenced.
  `ChannelInboxEventData` has exactly two fields. Both `compose_external_key` calls
  in `service.py` (SPACE and THREAD) pass `event.data.external_locator`. Attribute
  reads of `.space_locator` / `.thread_locator` outside assignment occur **only in
  tests**.
- Files: `api/oss/src/apis/fastapi/channels/ingress.py`,
  `api/oss/src/core/channels/dtos.py`, `api/oss/src/core/channels/service.py`
- Suggested Fix: decide whether they become real — carried into `data` and composed
  per grain from their own locator — or are deleted. Either is defensible; the
  current state is not, because it reads as though grain-specific locators are
  load-bearing when nothing consumes them.
- Notes: This is what makes `F28` unable to bite. `F28` reports that backfilled
  events all carry the request's `thread_locator` rather than their own — a real
  bug in a field no production code reads. Fixing `F28` without fixing this changes
  nothing observable. They should be resolved together, and this one first.

### [CLOSED] F49. The adapter interface declares a `verify_signature` nobody implements or calls

- **Fixed.** `verify_signature(*, request, connection)` with `connection` required;
  all three adapters match, the constructor-held connection and its
  `connection or self._connection` fallback are gone, and `grep` finds no adapter
  signature differing from the interface's.

- ID: `F49`
- Origin: `C4 design read`
- Severity: `P1`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `ChannelAdapterInterface.verify_signature` is declared
  `(*, headers, body) -> str`. All three adapters implement
  `(*, headers, body, connection=None)`, and the ingress calls it **with**
  `connection`. The declared contract therefore describes a method that does not
  exist in any implementation, and a new adapter written against the interface as
  documented would break at the ingress.
- Evidence: `interface.py` declares two parameters; `slack/adapter.py`,
  `bridge/adapter.py` and `mock/adapter.py` each declare three, with
  `conn = connection or self._connection`. `ingress.py` passes
  `connection=connection`.
- Files: `api/oss/src/core/channels/adapters/interface.py`, all three adapters
- Suggested Fix: declare `connection` on the interface. It is not optional in
  practice — the ingress always passes it, and the fallback exists only for
  single-tenant construction.
- Notes: The contract suite does not catch it because it calls
  `verify_signature(headers=…, body=…)` and every adapter defaults the third
  parameter. That is the same shape as `F45`: **the suite exercises a construction
  production does not use.** Fourth instance of that defect shape.

### [CLOSED] F48. The interface's keyword-only check cannot see sync methods, and hardcodes the method count

- **Fixed.** The check walks `ast.FunctionDef` and `ast.AsyncFunctionDef`, and the
  expected count derives from `ChannelAdapterInterface.__abstractmethods__`. A test
  asserts the guard fails on a sync method with a positional parameter.

- ID: `F48`
- Origin: `C4 design read`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Test-coverage`
- Summary: `test_every_method_parameter_after_self_is_keyword_only` walks
  `ast.AsyncFunctionDef` only, so it skips every synchronous method on the
  interface, and asserts `checked == 7` against a hardcoded number. The interface
  has **eight** abstract methods; `installation_hint` is the sole sync one and is
  therefore unchecked. Any sync method added later is unchecked and the count
  assertion still passes.
- Evidence: the test filters `if not isinstance(node, ast.AsyncFunctionDef):
  continue`, then asserts `checked == 7`. `interface.py` carries eight
  `@abstractmethod`s, seven `async def` and one `def`.
- Files: `api/oss/tests/pytest/unit/channels/test_channel_adapter_interface.py`
- Suggested Fix: walk `ast.FunctionDef` and `ast.AsyncFunctionDef`, and derive the
  expected count from the abstract methods on the class rather than hardcoding it —
  so adding a method updates the guard instead of silently evading it.
- Notes: A guard that skips exactly the method most recently added is worse than no
  guard, because the green run reads as coverage. Found while checking what
  constrains an interface change; it constrains less than it appears to.

### F46. `integration_key` must be globally unique, because its lookup is unscoped

- ID: `F46`
- Origin: `wave-4 WP17`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: `get_project_and_connection_by_external_id` resolves on the
  `(provider_key, integration_key)` pair with `LIMIT 1`, **no project scope and no
  deterministic ordering**. So `integration_key` must be unique across every
  tenant, not merely within a project — otherwise an inbound event can resolve to
  another tenant's connection.
- Evidence: found as a genuinely nondeterministic test failure — a fixture reusing
  a fixed `integration_key` across concurrent xdist workers returned `202` while
  the row landed under a *different* test's project. Fixed in the fixture by
  minting a unique id, but the underlying lookup is unchanged.
- Files: `api/oss/src/core/channels/service.py`, the channels DAO's
  `by_external_id` query
- Suggested Fix: decide whether the cross-tenant uniqueness is an invariant to
  enforce (a unique constraint on `(provider_key, integration_key)`) or whether the
  lookup should carry a scope. Silence is the risk: nothing today prevents a
  collision, and the failure is a cross-tenant read.
- Notes: This is the bridge decision's load-bearing assumption — `integration_key`
  is what distinguishes one bridge from another under the shared `bridge` provider
  key. It is worth an explicit constraint rather than a convention, since a
  third-party bridge author chooses the value.

### [CLOSED] F45. The stateless adapter registration refuses every request, Slack included

- **Both halves now closed.** Verification was fixed earlier; the per-connection
  declaration is fixed here. `fetch_capabilities` takes the connection through the
  service to the adapter, the bridge reads the connection's own recorded
  declaration instead of a constructor-held one, and every reachable call site
  passes the connection it already had. The `strict=True` xfail this finding left
  on the two-bridge acceptance test is removed, so that test now asserts the fixed
  behaviour rather than the defect.
- **What this cost to find:** the acceptance tests still constructed the adapter
  with the deleted `capabilities=`/`connection=` arguments, so the suite would have
  raised at construction on the first deployment. Two green unit-only runs did not
  see it, which is the pattern this project keeps hitting.

- ID: `F45`
- Origin: `wave-4 WP17`
- Severity: `P0` — blocks C4's exit condition, and Slack ingress is broken today
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: The adapter registry holds **one instance per channel key**, with
  capabilities baked in at construction, and nothing threads a per-request
  connection into `verify_signature` or `fetch_capabilities`. A bridge adapter
  registered the way Slack is — stateless, shared, no connection held — therefore
  **refuses every bridge request**, and a second bridge's space is validated
  against the first bridge's declaration.
- Evidence: two acceptance tests, real signed HTTP against real Postgres and two
  real bridge subprocesses, failing deterministically (3 runs, no flakiness), now
  `xfail(strict=True)` so they turn red the moment this is fixed:
  - `assert response_a1.status_code == 202` → actual **401**, raised before bridge
    B is ever reached. `_ingest` calls `verify_signature(headers=..., body=...)`
    with no `connection`; the adapter falls back to `self._connection`, which is
    `None` for a shared instance.
  - `ChannelLocatorIncomplete: Locator for bridge is missing declared space key
    field: chat_id` — bridge B's locator uses `room_id`, but
    `fetch_capabilities(channel="bridge")` returns bridge A's baked-in
    declaration, indifferent to which connection asked.
- Files: `api/oss/src/apis/fastapi/channels/ingress.py:113-120`,
  `api/oss/src/core/channels/adapters/bridge/adapter.py:76-85`,
  `api/oss/src/core/channels/service.py:469-471`
- Suggested Fix: not a patch — a design decision, and the same chicken-and-egg
  `F37` already named. The connection must reach `verify_signature` before the
  connection is known, so either the credential carries enough to resolve it
  first, or the bridge arm resolves a candidate connection before verifying. The
  Slack arm must not be forced through whichever order is chosen.
- **Widened after review: this is not bridge-specific — Slack has it too.**
  `routers.py:1070` registers `SlackAdapter()` with no connection, so
  `self._connection is None` and `verify_signature` raises **before reading any
  header**. Proven directly against the adapter as the composition root builds it:
  `SlackAdapter().verify_signature(...)` → `ChannelSignatureInvalid`, unconditional.
  No correctly-signed Slack request can pass either. The deployed endpoint answers
  401, which is indistinguishable from a genuine bad-signature refusal — which is
  why nothing caught it.
- **Why every test missed it, which is the transferable part:** the Slack ingress
  seam test constructs `SlackAdapter(connection=connection, ...)` — *with* a
  connection — while production registers it *without* one
  (`test_channels_ingress_slack_seam.py:103`). The test proves a configuration the
  composition root never builds. That is the `F1`/`F36` shape a third time, and its
  sharpest form yet: not an unreachable function, but a **reachable** one tested
  only in a shape nothing constructs.
- Resolution (verification half): the ingress now resolves a **candidate**
  connection from the body's unverified installation claim, then verifies against
  that connection's secret and requires the verified id to match it. Both adapters
  gained `installation_hint(body)`, defaulted on the interface so no adapter
  breaks. An unresolvable claim raises `ChannelSignatureInvalid`, identical to a
  bad signature, so the route is not an oracle for which installations exist.
  Proven: two real bridge subprocesses, two credentials, interleaved signed events
  behind the one route, each authenticating to its own connection — that test was
  strict-xfail and is now a passing assertion.
- **Still open (capabilities half):** `fetch_capabilities` keys on the channel
  string, so a second bridge's space is validated against the first's declared
  locator fields. Six call sites across three files, and it only bites with a
  second bridge installed, so it was left out of the verification fix rather than
  widened into it. The second two-bridge test stays strict-xfail and is the guard.
- Three fixtures had to change, and that is the finding within the finding: two
  built the adapter **with** a connection while production builds it without, and
  a third set `provider_key="agenta"`/`integration_key="slack"` when the lookup
  queries `provider_key == channel AND integration_key == external_id` — inverted.
  All three now mirror the composition root, which is what makes them guards.
- One security regression was introduced and caught mid-fix: acking an
  unresolvable claim with `detail="No connection found"` before verifying leaked
  exactly what the contract forbids. The pre-existing ack was reachable only
  *after* verification; moving the lookup earlier changed its meaning. Caught by
  a mismatch test expecting 401.
- Notes: The adapter and the contract decision are each correct in isolation; what
  is missing is the composition wiring that lets them serve any installation at
  all, let alone two. It took a real out-of-process counterpart to surface it,
  which is the argument for that package existing — and the Slack half fell out
  only on review, because the same registration was never questioned.

### F44. The contract suite's egress connection was hardcoded to one platform's credential names

- ID: `F44`
- Origin: `wave-4 WP12`
- Severity: `P2`
- Confidence: `high`
- Status: `resolved`
- Category: `Test design`
- Summary: `F39` fixed the suite's credential-less connection by supplying
  credentials — but named them `signing_secret`/`bot_token`, Slack's own fields,
  from a private non-parameterised helper. So an adapter whose credentials are
  named differently still could not satisfy the egress assertions, and the
  comment left behind claimed `data` "carries whatever credentials an adapter
  needs", which was false for every adapter but one.
- Evidence: the bridge adapter had to declare `controls.update` and
  `buttons.max` **false** for its suite run and assert both separately, because
  its credentials are `secret`/`delivery_url`. Its only alternatives were to
  adopt Slack's field names as its own (a lie) or read a
  constructor-held connection instead of the one passed at call time — a
  cross-installation credential leak the contract forbids.
- Files: `api/oss/tests/pytest/unit/channels/contract/test_channel_adapter_contract.py:41`
- Resolution: the connection is now a keyword parameter on
  `run_contract_suite`, defaulting to the previous value via
  `default_suite_connection()`, and threaded through all three egress
  assertions. A test drives the suite with an adapter reading a differently-named
  credential and asserts it arrives.
- Notes: **This was my own fix at CU-A, half-done.** `F39` was diagnosed as "the
  suite supplies no credentials" when it was really "the suite dictates the
  credential shape" — supplying Slack's names satisfied Slack and nothing else.
  The package that hit it refused to weaken the suite or contort its adapter, and
  reported it instead: the correct call, and the reason the gap surfaced at all.

### [CLOSED] F43. `worker_queues.py` still builds a `channels-outbox` queue with no producer

- **Removed**, with the task worker that registered no task. No env file names the
  queue explicitly, so nothing selects one that no longer exists.

- ID: `F43`
- Origin: `wave-4 WP18`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Simplification`
- Summary: With `poll_turn` deleted, nothing enqueues onto `queues:channels-outbox`;
  the taskiq wrapper is kept importable but registers nothing, so the broker is
  provably inert rather than gone.
- Files: `api/entrypoints/worker_queues.py:129-136`, `:142`, `:274-294`, `:429`
- Suggested Fix: delete `_build_channels_outbox_broker`, drop `channels-outbox`
  from `ALL_QUEUES` and `_BUILDERS`, drop `MAXLEN_QUEUES_CHANNELS_OUTBOX`, and the
  now-unused worker imports.
- Notes: Left unfixed because the file is outside the package's owned paths — the
  right call. The exact removal is recorded so it is a deletion, not a rediscovery.

### [CLOSED] F42. `worker_queues.py`'s adapter registry never got the mock adapter

- **Fixed at the cause.** Three composition roots each built the registry by hand,
  which is why they drifted; one factory now builds it for all three, so adding an
  adapter is one edit. A root that builds its own registry again is the regression.

- ID: `F42`
- Origin: `wave-4 WP18`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `_build_channels_service()` in the queue-worker composition path still
  registers only `{"slack": SlackAdapter()}`, while the API composition root and
  the stream-worker builder both register `mock` too. Nothing in the queue path
  needs `mock` today, so it is inconsistent rather than broken.
- Files: `api/entrypoints/worker_queues.py:227`
- Notes: **There are three composition roots, and they drift independently.** That
  is the structural cause of `F1` and `F36`, restated: a registry built in one
  place and not another is exactly the defect a green per-package suite cannot
  see. Worth treating as one fixture rather than three literals.

### F41. The Redis stream round trip for turn events is unproven

- ID: `F41`
- Origin: `wave-4 WP18`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Testability`
- Summary: The outbox now consumes `streams:sessions` via a registered
  `StreamConsumer`, and both halves are tested — payload routing at unit level,
  thread lookup against real Postgres — but the actual
  `publish_turn_started()` → `XADD` → `XREADGROUP` → consumer path has never run.
- Evidence: Redis has no host-published port in this environment, and no existing
  channels test touches Redis directly; every one drives worker methods.
- Files: `api/entrypoints/worker_streams.py`, `api/oss/src/tasks/asyncio/channels/outbox.py`
- Notes: Same shape as `F1`, `F36` and `F31` — each half works, and nothing proves
  they meet. This is the honest residue of `F31` rather than its closure, and it is
  a deployment-verification item: the queue and stream consumers logging their
  subscriptions is exactly what `CU-C-1` checks.

### F40. `ConnectionProviderKind` has no `BRIDGE` member, so a bridged connection cannot exist

- ID: `F40`
- Origin: `wave-4 WP19 review`
- Severity: `P1`
- Confidence: `high`
- Status: `resolved`
- Category: `Correctness`
- Summary: The bridge `source` decision settles the channel key for a bridged
  platform as the single fixed literal `bridge`, with the bridge's own identity
  carried in `integration_key`. That reasoning holds, but the key cannot be
  constructed: `provider_key` is typed `ConnectionProviderKind`, a three-member
  enum (`COMPOSIO`, `AGENTA`, `SLACK`) with no `BRIDGE`.
- Evidence: `ChannelConnection(provider_key="bridge", ...)` raises
  `ValidationError: Input should be 'composio', 'agenta' or 'slack'`. Verified
  directly against the tree at `481b5a2672`.
- Files: `api/oss/src/core/gateway/connections/dtos.py:20`
- Suggested Fix: Add `BRIDGE = "bridge"`, then re-check every `.value` call site
  and confirm a new member cannot leak into the *connections* provider registry
  (composio/agenta), which is a different registry from channels'. The DB column
  is `String`, not `Enum(...)`, so no migration follows.
- Notes: **The package reported "No change needed" and its tests passed**, because
  the new ingress tests fake the service and never construct a real
  `ChannelConnection` — zero references to it or to `provider_key` in that file.
  This is the project's recurring shape: an interface asserted about a faked
  collaborator that differs from the real one. It is also why the seam rule asks
  for the assertion to be recorded *even when tests pass* — the passing suite is
  what made the gap invisible.
- Resolution: `BRIDGE = "bridge"` added, with a comment recording that the
  specific bridge lives in `integration_key` rather than in a per-bridge member.
  All **eight** `.value` call sites re-checked (the first pass had found four):
  two in the tools router, three in the triggers service, three in the
  connections service. None is reachable with a bridge connection today, because
  connection creation runs only through the Composio OAuth path — and the failure
  mode if one ever were is a typed `ProviderNotFoundError`, not a silent `None`,
  which is now pinned by a test. Column confirmed `String`, not `Enum(...)`, so
  no migration. Channels unit 339 → 345; tools + triggers green at 232.
- Notes on the fake that hid it, worth generalising: the fakes asserted a
  **behavioural** interface — method names and return shapes — but never the
  **data** interface, the validated Pydantic field the value must pass through.
  A fake built from the same method signatures as the real collaborator can still
  diverge on a field type it never touches.

### F39. The shared adapter contract suite hands every adapter a credential-less connection

- ID: `F39`
- Origin: `wave-4 CU-A`
- Severity: `P2`
- Confidence: `high`
- Status: `resolved`
- Category: `Test design`
- Summary: `_fake_connection()` in the shared contract suite built a
  `ChannelConnection` with no `data` at all, so every adapter's suite run drove
  egress with no credentials. It passed only because the Slack adapter tolerated
  a missing `bot_token`. Any adapter that validates its own credentials — which
  is the correct behaviour — fails this suite for a reason that is the suite's
  fault, not the adapter's.
- Evidence: fixing `F34` immediately broke
  `test_slack_adapter_passes_wp2_contract_suite`, raising
  `ChannelConnectionIncomplete` from `_call`. The suite's own Slack-specific
  `_connection()` did set `bot_token`; the shared one did not.
- Files: `api/oss/tests/pytest/unit/channels/contract/test_channel_adapter_contract.py:41`
- Resolution: the shared connection now carries `signing_secret` and
  `bot_token`. Fixed at CU-A of wave 4.
- Notes: This is the seam shape the wave model predicts — a faked collaborator
  whose asserted interface was weaker than the real one. It matters beyond the
  fix because the suite is the contract every future adapter is held to,
  including WP12's bridge adapter: as written it would have taught the next
  adapter that credential validation is optional.

### F38. Nothing parses a button click: `ChannelEventKind.ACTION` is unreachable

- ID: `F38`
- Origin: `wave-4 prep`
- Severity: `P1`
- Confidence: `high`
- Status: `open`
- Category: `Completeness`
- Summary: `ChannelEventKind.ACTION` exists ("button click, reaction") and the Slack
  manifest requests `interactivity`, but no code path handles an interaction payload.
  `SlackAdapter.parse_event` returns `None` unless
  `payload["type"] == "event_callback"`; a Slack button click arrives as
  `type: "block_actions"`. So every click is silently dropped, and no event of kind
  `ACTION` can ever be produced.
- Evidence: `adapter.py:125` — `if payload.get("type") != "event_callback": return
  None`. `grep -rn "block_actions"` across `core/channels/` and
  `apis/fastapi/channels/` returns nothing. `manifest.py:42` requests the scope
  regardless.
- Files: `api/oss/src/core/channels/adapters/slack/adapter.py:125`,
  `api/oss/src/core/channels/dtos.py:39`
- Suggested Fix: A package, not a clean-up item. But the shape is small, because **an
  action is a message whose text the agent pre-wrote**, and the existing pipeline
  already carries everything it needs:

  - `ChannelInboxEventProcessed` is `{content, sender}`. A click normalises to exactly
    that: `content` is the button's payload, `sender` is the clicker. The event enters
    the same inbox log, the same dedup, the same `dispatch_event`.
  - **The click is already addressed** — the agent that posted the button is known from
    the thread the message sits in, so no sigil is needed. That is the one asymmetry
    with a text message: addressing comes from the *locator*, not the content.
  - So the button's `value` is a **pre-written message body**. Everything the turn needs
    — which agent, which thread, which prior message, which command — is either in the
    locator (agent, thread, message) or in the value (the intent).

  What that leaves genuinely new:

  1. **A parse branch for `block_actions`.** Slack posts interactivity form-encoded
     (`payload=<json>`), not as JSON — a different decode from the events path.
  2. **A route decision.** Slack sends interactions to a separately-configured URL. It
     can share `/channels/slack/events/` or take its own literal path; either way it is
     a `_PUBLIC_ENDPOINTS` line.
  3. **What the value means.** If the value is a message body, a click needs no new
     concept at all — it composes a turn like any message. If it is instead an
     *answer to an open approval*, it must resolve against something the outbox is
     waiting on. **That mechanism already exists** — `SessionInteractionsService`
     (`core/sessions/interactions/service.py`) has `create_interaction`,
     `transition_interaction` and `cancel_session_pending`, and WP9's `!stop` already
     reaches into that domain. So this is a *transition call*, not a new subsystem, and
     the answer to "small or large" is small.
  4. **`external_id` for dedup.** Slack retries interactions; the click needs a stable
     id so the ledger drops the second one.

  Scope it before wave 4 ends, because C6 depends on it.
- Notes: **This blocks C6's exit condition** — "an approval resolves from a button
  click without opening a browser" cannot be met, and no fake would have caught it
  because outbound rendering is complete and correct. Found by chasing `F13`, which
  asks whether the button's `value` should carry WP5's `value` or its `id`: **that
  question cannot be answered until the inbound path exists**, since the answer is
  whatever the inbound path reads. `F13` is therefore blocked on this, not
  independently fixable.

### F13. Slack button rendering drops WP5's `value`

- ID: `F13`
- Origin: `C2 merge`
- Severity: `P3`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- **Blocked on `F38`.** "Self-consistent as long as the inbound action path also reads
  `id`" assumed such a path exists. It does not — nothing parses a button click at all,
  so there is no reader to be consistent with and no way to decide this correctly yet.
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
- Status: `resolved`
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
- Resolution: the bridge adapter exists and implements the full adapter contract.


### F27. The alembic config paths are container-absolute, so `entrypoints.routers` cannot be imported locally

- ID: `F27`
- Origin: `pre-existing`
- Severity: `P3`
- Confidence: `high`
- Status: `open (deferred by decision — out of wave-4 scope)`
- Category: `Testability`
- Summary: Importing `entrypoints.routers` outside the container fails at
  module scope. `env.alembic.cfg_path_core` defaults to `/app/...`, and the
  ini it points at hardcodes `script_location = /app/oss/databases/...`, so
  even overriding the env var is not enough — the ini's own path must be
  rewritten too.
- Evidence: **corrected at CU-A of wave 4 — the error first recorded here was
  not the real one.** Reproduced: `alembic.util.exc.CommandError: No
  'script_location' key found in configuration`, raised from
  `oss/databases/postgres/migrations/core/utils.py:23`, which runs
  `ScriptDirectory.from_config` at import time. The cause is that
  `Config('/app/...')` finds **no file at all** outside a container, so the
  config is empty and `script_location` is *absent* rather than wrong. The ini's
  own absolute `script_location` is a second, independent problem that only
  surfaces once the first is fixed.
- Files: `api/oss/databases/postgres/migrations/core/alembic.ini:5`,
  `api/oss/src/utils/env.py:616-620`,
  `api/oss/databases/postgres/migrations/core/utils.py:23`
- Suggested Fix: Resolve the env default from the package location rather than
  `/app` (this alone fixes the import), and separately make `script_location`
  ini-relative via alembic's `%(here)s`. Both were prototyped and verified at
  CU-A — the composition root imported cleanly and reported
  `adapters: ['slack']`, i.e. `F36` as data — then **reverted**: migration config
  is not wave-4 scope and carries deployment risk disproportionate to a
  test-ergonomics gain. `%(here)s` resolves to the same `/app/...` path under
  both Dockerfiles (`WORKDIR /app`, `api/oss` copied to `/app/oss`), so the
  change is inert in production, but it stays a deliberate decision for its
  owners rather than a side effect of channels work.
- Notes: Found while verifying CU-1. Worked around with a rewritten ini in a
  scratch directory; the repo was not changed. The cost is that no test can
  assert the composition root's wiring, which is exactly the class of defect
  `F1` was: four disconnections that every green suite missed because nothing
  imports this module.

### [CLOSED] F28. Backfilled events all carry the request's locator, not their own

- **Fixed, and this finding was more serious than filed.** It is not a bug in a
  field nothing reads: `external_locator` is read, so a thread reply returned by a
  space-level history read composed to the space's thread key instead of its own.
  Two tests asserted the defect as intended behaviour and now assert the fix.

- ID: `F28`
- Origin: `wave-2`
- Severity: `P2`
- Confidence: `high`
- Status: `fixed`
- Category: `Correctness`
- Summary: `SlackAdapter.fetch_history` sets `external_locator=locator` on every
  event it returns — the locator it was *called* with. So each backfilled
  message points at the conversation, not at itself, and no two of them are
  distinguishable by locator. `thread_locator` has the same shape problem:
  `{**locator} if locator.get("thread_ts")` copies the request's `thread_ts`
  rather than deriving the message's own.
- Evidence: `adapter.py:268-269` inside the message loop. Contrast
  `parse_event`, which calls `build_locator(team=..., channel=...,
  thread_ts=...)` per event. `mapping.py:38-47` exists precisely to build a
  per-message locator and `fetch_history` does not call it.
- Files: `api/oss/src/core/channels/adapters/slack/adapter.py:268`,
  `api/oss/src/core/channels/adapters/slack/mapping.py:38`
- Suggested Fix: Build the locator per message from `message.get("ts")` via
  `build_locator`, as `parse_event` does. WP6 owns the file.
- Notes: Found by the `F25` comment sweep while reading, not by a test — the
  backfill path's tests assert the returned events' content and count, not
  their locators, so a shared locator passes. **Not an idempotency hazard:**
  `compose_idempotency_key` derives from row identity and `updated_at`, never
  from the locator, so this cannot collide two sends. The cost is that a
  backfilled event cannot be addressed or threaded individually — which is
  `WP10`'s subject matter, so settle it before WP10 builds on the backfill
  path.
- **Now confirmed by test, not by reading.** WP16's stateful fake seeds two
  messages with distinct `ts`, calls `fetch_history` once, and asserts both
  returned events carry an identical `external_locator` *and* an identical
  `thread_locator` while `first_ts != second_ts`. Two tests pin it:
  `test_fetch_history_external_locator_is_the_call_locator_not_per_message` and
  `test_fetch_history_thread_locator_does_not_vary_per_reply`, in
  `tests/pytest/unit/channels/slack/test_slack_over_fake.py`. **Those tests
  currently assert the bug**, so fixing the adapter means updating them in the
  same change — they are the regression guard, and a fix that leaves them green
  has not fixed anything.

### F37. The wire contract identifies which bridge called, and nothing consumes it

- ID: `F37`
- Origin: `C3`
- Severity: `P1`
- Confidence: `high`
- Status: `resolved`
- Category: `Design`
- Summary: One `/channels/bridge/events/` route for every bridge is correct and
  deliberate — the multiplicity belongs in the **wire contract**, and the
  contract already carries it: the inbound envelope has
  `"source": "bridge/acme-wecom"`, and `bridge.hello` declares
  `bridge.name: "acme-wecom"`. What is missing is any statement of what core
  *does* with either. The contract never says `source` selects the connection,
  never says how a bridge name maps to a channel key, and nothing in the code
  reads `source` at all. So the single route is right and the demultiplexing
  step behind it is unspecified.
- Evidence: `source` appears in `contract.md` only twice — the CloudEvents field
  list at line 91 and the example at line 116 — with no semantics attached.
  `grep -rn source` across the channels core finds one comment, no read. The
  ingress consequently passes the literal `channel="bridge"`
  (`ingress.py:104`), so `registry.get("bridge")` and
  `get_project_and_connection_by_external_id(channel="bridge", ...)`
  (`service.py:518`) both key on that constant — which is the *symptom*, not the
  defect.
- Files: `docs/design/channels-research/v2/contract.md` (§3, §5),
  `api/oss/src/apis/fastapi/channels/ingress.py:104`,
  `api/oss/src/core/channels/service.py:518`
- Suggested Fix: **Specify it in the contract first**, then implement. The
  contract must answer: is `source` authoritative for demultiplexing, or is the
  credential? What is the channel key for a bridged platform — `bridge/<name>`,
  or a key the bridge declares at `hello`? Is `source` trusted, or verified
  against the credential (it arrives in the signed body, so it is
  tamper-evident but self-asserted)? Only then does the ingress change follow,
  and it is a small one.
- Notes: The ordering matters and is the whole point of this finding. Resolving
  the channel from the credential is one design; keying on `source` is another;
  making the credential authoritative and `source` a cross-check is a third.
  Picking one in `ingress.py` without writing it down means the first
  third-party bridge author has to read our code to discover the protocol.
  **A second constraint that rules out the naive fix:** `_ingest` looks the
  adapter up *before* verifying, but a credential-derived channel is not known
  *until* verification — so the bridge arm cannot keep that order regardless of
  which design wins.
  Not reachable in production today because no bridge adapter exists (`F26`), so
  this is cheap now and expensive after the first bridge ships. `routers.py`'s
  comment "the bridge route resolves its own at runtime" describes the intent,
  not the code.
- Resolution: the wire identity rule is decided in the contract and implemented: the credential is authoritative and the claimed source is a required cross-check.


### F36. C3 merges green with four of five new capabilities unreachable

- ID: `F36`
- Origin: `C3`
- Severity: `P1`
- Confidence: `high`
- Status: `resolved`
- Category: `Correctness`
- Summary: The five-way merge produced 2443 passing tests, zero conflicts and
  zero failures — and **nothing outside its own module calls** `run_backfill`,
  `select_forwardfill_range`, `parse_command` or `dispatch_command`.
  `core/channels/commands.py` is imported by nothing at all, and `MockAdapter`
  appears nowhere in `api/entrypoints/`. Only WP0's publisher is wired, and
  `F31` records that its stream has no consumer.
- Evidence: per-symbol grep across `api/oss/src/` and `api/entrypoints/`
  excluding each symbol's own definition and module: `run_backfill` 0,
  `select_forwardfill_range` 0, `parse_command` 0, `dispatch_command` 0,
  `publish_turn_started` 2. `grep -rn "MockAdapter" api/entrypoints/` → 0.
  `channels_adapter_registry` at `routers.py:1072` lists `slack` only.
- Files: `api/entrypoints/routers.py`,
  `api/oss/src/tasks/asyncio/channels/inbox.py`,
  `api/oss/src/core/channels/{commands,fill}.py`
- Suggested Fix: A checkpoint wiring pass, the same shape as `CU-1` — the call
  sites live in `inbox.py` and `routers.py`, files no package owns. Registering
  `mock` is one line; the command and backfill call sites need the ordering
  decisions in `F29` and `F32` settled first.
- Notes: **The test arithmetic is exactly right** — 2344 + 26 + 21 + 25 + 11 +
  16 = 2443 — so no test was shadowed or lost, and every package genuinely works
  in isolation. That is the point worth keeping: a green merge measured
  reachability nowhere, and the per-package suites cannot measure it by
  construction, because each one calls its own entry point directly. `F1` was
  this defect for wave 2 and was found by inspecting the composition root, not
  by a suite; the same inspection is now a required step at every checkpoint
  rather than something remembered.
- Resolution: wave 4 connected every capability; the mock adapter, commands, fill and the outbox stream consumer all have callers. Two composition roots still drift (`F42`).


### F35. `_StubTransport` and its five tests are now subsumed

- ID: `F35`
- Origin: `wave-3`
- Severity: `P3`
- Confidence: `medium`
- Status: `resolved (partly refuted)`
- Category: `Simplification`
- Summary: WP6's `_StubTransport` answers any request with the next canned body.
  Five of its tests were reported as subsumed by fake-backed equivalents.
  **Three were; two were not.** Checked side by side at CU-A: post-then-edit and
  both refusal-vs-empty-page tests have fake equivalents asserting held state,
  and were deleted. Content splitting and page-size clamping have **no**
  fake-backed equivalent — no fake test references `MAX_CHARS`/the 4001-char
  split, and none asserts the outbound `limit` — so both were kept, and
  `_StubTransport` stays for them.
- Resolution: three tests deleted, two kept, at CU-A of wave 4. The `medium`
  confidence was correct: the finding was a package's reading of its own work,
  and 2 of 5 claims did not hold.
- Files: `api/oss/tests/pytest/unit/channels/slack/` (WP6's stub tests and
  WP16's `test_slack_over_fake.py`)
- Suggested Fix: Remove `_StubTransport` and those five tests at a cleanup pass.
  Confidence is `medium` deliberately: "subsumed" is WP16's reading of its own
  work, and the claim deserves a side-by-side check per test before anything is
  deleted. WP16 did not delete them, which was correct — it does not own them.
- Notes: The reason to prefer the fake is not coverage count. A stub that
  answers anything passes a call to the wrong endpoint with the wrong payload in
  the wrong order; that is what let `F28` live undetected in a green suite.

### F33. The Slack adapter ignores `Retry-After` entirely

- ID: `F33`
- Origin: `wave-3`
- Severity: `P2`
- Confidence: `high`
- Status: `open`
- Category: `Correctness`
- Summary: On a `429` with `ratelimited` and a `Retry-After` header, the adapter
  raises immediately. `_call` reads only `response.json()` and raises on
  `ok: false`; it never inspects headers, so the retry hint is dropped. There is
  no backoff and no retry anywhere on the egress path.
- Evidence: `adapter.py:288-303`. WP16's
  `test_ratelimited_with_retry_after_propagates_as_an_error_with_no_retry`
  forces the response and asserts exactly **one** request was sent.
- Files: `api/oss/src/core/channels/adapters/slack/adapter.py:288`
- Suggested Fix: Decide where retry belongs. The taskiq outbox worker already
  retries a failed task, so honouring `Retry-After` in-adapter may be the wrong
  layer — but dropping the header silently means the broker retries on its own
  schedule against a platform that told us exactly when to come back.
- Notes: The test asserts current behaviour deliberately rather than pretending
  a retry exists. Under sustained rate limiting the outbox will burn its retry
  budget at the wrong cadence; whether that is acceptable is a decision, not an
  oversight to leave unrecorded.

### F34. A missing `bot_token` sends the literal header `Bearer None`

- ID: `F34`
- Origin: `wave-3`
- Severity: `P3`
- Confidence: `high`
- Status: `resolved`
- Category: `Correctness`
- Summary: `_bot_token` returns `None` when `connection.data` has no
  `bot_token`, and the adapter interpolates it into the header anyway, sending
  `Authorization: Bearer None`. Slack answers `invalid_auth` — a well-formed but
  wrong token — rather than anything naming the real cause.
- Evidence: WP16's fake classifies it as `invalid_auth`, not `not_authed`,
  because the header is present and syntactically valid.
- Resolution: fixed at CU-A of wave 4. `_bot_token` now returns `str` and raises
  the new `ChannelConnectionIncomplete(channel, field)` when the token is absent,
  matching how `_signing_secret` already fails. The test that pinned the old
  behaviour now asserts the local failure and that nothing reached the fake.
- Files: `api/oss/src/core/channels/adapters/slack/adapter.py`
- Suggested Fix: Fail fast locally when `bot_token` is absent, the way
  `_signing_secret` already raises `ChannelSignatureInvalid` when its key is
  missing.
- Notes: Reachable today because nothing yet writes `connection.data` (`F6`), so
  the first operator to configure a connection incompletely gets a misleading
  Slack error instead of a local one. Cheap to fix while `F6` is still open.

### F29. Backfill has never run: nothing in the dispatch chain calls `fetch_history`

- ID: `F29`
- Origin: `wave-3`
- Severity: `P1`
- Confidence: `high`
- Status: `resolved`
- Category: `Correctness`
- Summary: `run_backfill` exists (WP10) and `SlackAdapter.fetch_history` exists
  (WP6), but no code path connects them. Grepping the whole of
  `api/oss/src/` for `run_backfill`, `select_forwardfill_range` or any import of
  `core/channels/fill.py` returns **nothing outside the module itself**, and
  neither `service.py` nor `inbox.py` ever calls `fetch_history` or
  `mark_space_backfilled`. So `space.flags.is_backfilled` is read but never set,
  and no space has ever been backfilled.
- Evidence: `grep -rn "run_backfill\|select_forwardfill_range" api/oss/src/`
  matches only `core/channels/fill.py`. `grep -n "fetch_history\|
  mark_space_backfilled" service.py inbox.py` returns no hits; the only
  `is_backfilled` reference is a read at `service.py:762`.
- Files: `api/oss/src/core/channels/fill.py`,
  `api/oss/src/tasks/asyncio/channels/inbox.py`,
  `api/oss/src/core/channels/service.py`
- Suggested Fix: Call `run_backfill` from the dispatch chain after `resolve()`
  and before `open_turn`. There is a real ordering tension to settle first:
  backfill must run before the turn opens, but its refusal `Status` wants a
  trigger row that does not exist yet. Decide whether to open the trigger first
  or hold the status.
- Notes: The same shape as `F1` — a package built, green in isolation, and never
  connected. `F1` was found by inspecting the composition root; this one was
  found because WP10 reported its own code as uncalled rather than assuming
  someone else would wire it. Worth stating plainly: a passing suite for
  `fill.py` proves the function works, not that backfill happens.
- Resolution: wired at wave 4: `_run_backfill` is called from the dispatch chain after resolve and before compose, and the refusal status is held rather than persisted.


### F32. `!use:<id>` cannot switch threads: the service exposes no way to create one

- ID: `F32`
- Origin: `wave-3`
- Severity: `P2`
- Confidence: `high`
- Status: `resolved`
- Category: `Correctness`
- Summary: The `!use:<id>` command is specified to point a new thread row at a
  named earlier session. `ChannelsService` exposes only `query_threads`,
  `close_thread` and `enqueue_output` for threads — `create_thread` exists on the
  **DAO interface** but has no service method in front of it, and `commands.py`
  may not call a DAO directly (layering). So WP9 could implement the validation
  half (refusing an id outside the caller's own scope) and not the switch.
- Evidence: `grep -n "def .*thread" core/channels/service.py` returns
  `query_threads` (430), `close_thread` (446), `enqueue_output` (809) — no
  create. `core/channels/interfaces.py:300` declares `create_thread` on the DAO.
- Files: `api/oss/src/core/channels/service.py`,
  `api/oss/src/core/channels/interfaces.py:300`,
  `api/oss/src/core/channels/commands.py`
- Suggested Fix: Add the missing service method (a `switch_thread`, or widen
  `close_thread`) in WP1's file. Note `!new` works only because closing the
  current row makes the next `resolve()` open a fresh one — that indirection is
  unavailable for `!use`, which must target a *specific* prior session.
- Notes: WP9 reported the gap instead of reaching into the DAO or inventing a
  service method, which is the behaviour the ownership rule is for. It also
  corrects a briefing error of mine: `_parse_sigil` lives in
  `core/channels/service.py:859` (parsing the **agent** sigil), not in the inbox
  worker. The command sigil is a separate vocabulary, so the two parses stay
  separate functions run in sequence — agent sigil first, since it decides which
  thread exists at all.
- Resolution: scoped to validation-only, deliberately, rather than left half-working; the thread-switch half is unimplemented and stated as such.


### F31. `streams:sessions` has no registered consumer, so turn events are published into nothing

> **Superseded by `F41`.** A consumer is registered now; what remains unproven is
> the wire round trip, which `F41` states precisely.

- ID: `F31`
- Origin: `wave-3`
- Severity: `P1`
- Confidence: `high`
- Status: `resolved`
- Category: `Correctness`
- Summary: WP0 publishes `turn_started` / `turn_ended` to `streams:sessions`, but
  `worker_streams.py`'s `ALL_STREAMS` is `("records", "events", "spans")` — no
  `sessions` entry — and `SessionEventsWorker` is referenced by nothing outside
  its own module and tests. The events are written and never read.
- Evidence: `api/entrypoints/worker_streams.py:52` for `ALL_STREAMS`; the three
  `stream_name=` registrations at lines 75/84/116 cover spans, records and
  events only. `grep -rn "SessionEventsWorker" api/` matches only the class
  definition.
- Files: `api/entrypoints/worker_streams.py`,
  `api/oss/src/tasks/asyncio/sessions/events_worker.py`
- Suggested Fix: A checkpoint edit, like `F1` — `worker_streams.py` is a
  composition-root file no package owns. Add the `sessions` builder and stream
  entry. Note WP0's consumer is explicitly a proof-of-observability scaffold,
  not the production consumer.
- **The real consumer is the channels outbox worker, and it is already written.**
  `ChannelsOutboxWorker` has `on_turn_started` and `on_turn_ended` as distinct
  methods (`outbox.py:101` and `:136`); `poll_turn` only *infers* which to call,
  by re-reading the thread, re-reading `latest_turn`, and branching on
  `turn.end_time is None`. WP0's event carries `kind` directly, so the whole
  inference deletes and the two handlers are driven by the payload — which is
  precisely the "deleted, not disabled" exit condition. So this is not "write a
  consumer", it is "subscribe the consumer that exists".
- **A correctness gain, not only a tidy-up:** `latest_turn` can return a
  different turn than the one whose tick is being handled, so the poll path can
  act on the wrong turn under concurrency. An event carrying its own `turn_id`
  cannot.
- Notes: Two distinct things must both happen — the stream needs a registered
  consumer group (this finding), and the outbox must subscribe instead of
  polling. WP0 unblocked the dependency; it did not complete the swap, and said
  so. Note the entrypoint is `worker_streams.py`, not `worker_queues.py`: this is
  a Redis **stream**, not a taskiq queue, so it is a different composition root
  from the one `CU-1` edited.
- Also: WP0's payload is **not** zlib-compressed, while the sibling `records`
  and `events` streams are. A consumer that copies a sibling's
  `zlib.decompress` will fail on this stream. Worth pinning before WP5 writes
  its consumer.
- Resolution: a `sessions` stream consumer is registered in the stream-worker composition. Superseded by `F41` for the untested wire round trip.


### F30. `select_forwardfill_range` duplicates `compose_input`'s range read, and not faithfully

- ID: `F30`
- Origin: `wave-3`
- Severity: `P2`
- Confidence: `high`
- Status: `resolved`
- Category: `Simplification`
- Summary: A forwardfill range-select helper was asked for "called
  from WP4's `compose_input` path". `compose_input` already implements that read
  inline, so the tree now holds two implementations — and they are **not
  equivalent**: `compose_input` branches on `resolution.policy.forwardfill`,
  taking the addressing event alone when forwardfill is off, whereas
  `select_forwardfill_range` always returns the full range.
- Evidence: `service.py:733-754` calls `fetch_latest_trigger` then
  `query_events_since` directly, with the `if not resolution.policy.forwardfill`
  branch. `fill.py`'s helper has no such branch.
- Files: `api/oss/src/core/channels/service.py:733`,
  `api/oss/src/core/channels/fill.py`
- Suggested Fix: Either delete the helper and keep the inline read, or move the
  policy branch into the helper and have `compose_input` call it. Not a
  substitution: swapping one for the other as-is would change behaviour when
  forwardfill is off.
- Resolution: fixed at CU-A of wave 4, by the second option. `compose_input`
  now calls `select_forwardfill_range` and keeps the policy branch, narrowing
  the returned range to the addressing event when forwardfill is off. Both
  branches stay covered; no test count changed, so the guard is
  `test_forwardfill_off_returns_addressing_event_alone` rather than arithmetic.
- Notes: WP10 built to the spec's literal ask and reported the duplication
  rather than editing `service.py`, which it does not own — the right call. The
  spec is the thing that was stale, not the implementation.

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
- **Confirmed on a deployed stack at C3**, which is more than the structural
  check above: `worker-queues` logs
  `selected=[webhooks, triggers, interactions, evaluations, channels-inbox,
  channels-outbox]` and `Listening on queue=` for both new queues, against a
  real Redis, with no config change. The predicted "starts on the next deploy"
  held. Still not exercised — no message has travelled the path even now, which
  is what `F36` is about.
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
