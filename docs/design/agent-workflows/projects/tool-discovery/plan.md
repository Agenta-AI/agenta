# Implementation plan

Layered bottom-up so each phase is independently testable. The engine (Composio) is verified;
the work is the Agenta-native wrapper and the translation.

> **Status (2026-06-27):** Phases 1-2 landed on PR #4884 (with the setup-agent skill, see
> below). Phases 3-4 (the `POST /tools/discover` endpoint and the reserved
> `tools.agenta.find_capabilities` tool) are DEFERRED: they touch
> `api/oss/src/apis/fastapi/tools/router.py` and the SDK `tools/models.py`, owned by a
> concurrent Workstream-B task. They resume once those files are free. See `status.md`.

## Phase 0 — Spike and verify (done)

- Confirmed `COMPOSIO_SEARCH_TOOLS` runs via `POST /tools/execute/{slug}` (no MCP session).
- Confirmed the response carries tools + alternatives + inline schemas + plan + pitfalls +
  per-user connection state.
- Confirmed connection state is per `user_id`, and Agenta sets Composio `user_id = project_id`.
- All recorded in `research.md`. Decisions to settle before Phase 1: D1-D6 in `status.md`.

## Phase 1 — Adapter method (DONE)

Add `search_capabilities` to `ComposioToolsAdapter`
(`api/oss/src/core/tools/providers/composio/adapter.py`, near `execute` at L164).

- Input: `use_cases: list[str]`, `user_id: str`.
- Body: `{"user_id": user_id, "arguments": {"queries": [{"use_case": u} for u in use_cases],
  "session": {"generate_id": true}}}` to `/tools/execute/COMPOSIO_SEARCH_TOOLS`.
- Parse into a typed Composio DTO in
  `api/oss/src/core/tools/providers/composio/dtos.py` (results, tool_schemas,
  toolkit_connection_statuses).
- Unit test with a recorded fixture (the real response captured in Phase 0). No live LLM in
  CI.

## Phase 2 — Core discovery service and translation (DONE)

Landed as `ToolsService.discover_capabilities` plus the pure translation module
`api/oss/src/core/tools/discovery.py` and the response DTOs in `core/tools/dtos.py`.

Add to `api/oss/src/core/tools/service.py` (or a focused `ToolDiscoveryService`):

- Call `adapter.search_capabilities(use_cases, user_id=str(project_id))`.
- Translate each `tool_slug` -> `{integration, action}` (inverse of `_to_composio_slug`,
  `catalog.py:210-228`). Keep the raw slug as `provider_action`.
- Attach `input_schema` and `description` from `tool_schemas`.
- Reconcile connection state: for each integration, query `gateway_connections` for the project
  (existing connections service) to get the slug; use Composio's `has_active_connection` as the
  validity check. Emit `ready` / `needs_auth` / `needs_input` (needs_auth vs needs_input from
  the integration `auth_schemes` already in our catalog).
- Build the Agenta response DTOs (`design.md` contract): `capabilities[]`, `connections[]`,
  `guidance`, `ready`.
- Unit tests for translation and the three connection states (fixtures, no network).

## Phase 3 — REST endpoint (DONE)

`POST /tools/discover` is wired in `api/oss/src/apis/fastapi/tools/router.py`
(`discover_capabilities`), project-scoped via the existing auth dependency (gives `project_id`),
`VIEW_TOOLS`. The handler calls `ToolsService.discover_capabilities(...)` (built in Phase 2) and
returns `CapabilitiesResult`; `DiscoveryUnsupportedError` maps to 422.

- Request model `CapabilitiesQuery` in `api/oss/src/apis/fastapi/tools/models.py`; the response
  is the core `CapabilitiesResult` DTO directly (the agent-facing contract from `design.md`).
- Caching (D6) is implemented in the core service (Phase 2): `ToolsService._cached_search`
  caches the tool/schema half project-agnostically with the standard 5-min TTL and recomputes
  connection state fresh each call. The endpoint just calls `discover_capabilities`.
- Worked example added to `api/oss/tests/manual/tools/tools.http`.

## Phase 4 — Agent-facing tool (SERVER side DONE; SDK declaration PENDING)

Expose `find_capabilities` to harnesses, consistent with
[`../agent-creation-skills/custom-tools-design.md`](../agent-creation-skills/custom-tools-design.md).

- **Server side (DONE):** the reserved `tools.agenta.find_capabilities` tool (D1, out of the
  Composio namespace) is routable over `/tools/call` — `call_tool` dispatches the `tools.agenta.`
  prefix to `_call_agenta_tool`, which runs `discover_capabilities` and returns the
  `CapabilitiesResult` as the tool result. The canonical reserved-tool spec (call_ref,
  input_schema, description) lives in `core/tools/discovery.py`.
- **SDK declaration/resolution (PENDING):** the only open piece. For an agent config to carry
  the tool, the SDK resolver must emit a `CallbackToolSpec` with `call_ref =
  tools.agenta.find_capabilities` + the shared `ToolCallback`. This belongs on the in-flight
  direct-call-tools "platform-op catalog" seam (which adds `CallbackToolSpec.call` and a
  platform-op mechanism); building a parallel mechanism now would duplicate/conflict. **The
  runner needs no change** — it forwards the `call_ref` opaquely (no `buildCustomTools` change).
- The setup agent learns the discover -> resolve-connections -> create -> test loop from the
  **skill shipped in this PR** (plan.md:76): `skills/discover-and-wire-tools/SKILL.md`. The
  skill is the teaching surface (not an `agents_md` blob); it pairs with `create-agenta-agent`.
  Testing the skill with a subagent is an orchestrator follow-up.

## Phase 5 — Live end to end and a replay test

> Phase 1 already ships a recorded-fixture replay test
> (`api/oss/tests/pytest/unit/tools/test_discovery.py` + `fixtures/composio_search_tools.json`,
> shapes taken verbatim from the 2026-06-27 live capture). Phase 5 upgrades it with a freshly
> captured pair once the endpoint is live, and adds the live walkthrough below. A `/debug-local`
> exploratory QA of the live endpoint (plan.md:84) is an orchestrator follow-up after Phase 3/4
> land — it is not run from the implementation subagent.

- Run on the dev stack with a project that has GitHub `ready` and Slack `needs_auth`. Confirm
  `find_capabilities` returns the right states and a usable `tool` config.
- Feed the discovered tools into `create_workflow` -> `invoke_workflow` (verified in
  agent-creation-skills) and confirm the worker runs.
- Capture the Composio response as a replay fixture (`agent-replay-test` skill) so the
  contract is pinned without a live LLM.

## Phase 6 — Follow-ups (separate slices)

- Trigger/listen parity: extend discovery to Composio's trigger search and our `/triggers/...`
  subsystem so the "listen" fragment resolves to a subscription (D5).
- Optional `agents_md` auto-draft from plan + pitfalls (D4).
- Optional `manage_connection` helper tool (design note #6) so the agent can initiate a
  connection without composing the raw `POST /tools/connections/` body.

## Testing and conventions

- API tests: `cd api && py-run-tests` (see root `AGENTS.md`). Lint: `ruff format` then
  `ruff check --fix` in `api/` before committing.
- Keep docs in sync (the `keep-docs-in-sync` skill): DONE for Phase 3/4 — `documentation/tools.md`
  (the new "Tool discovery" section + Where-this-lives rows + status note), the interface
  inventory (`cross-service/runner-to-tool-callback.md` third call_ref grammar,
  `in-service/tool-models-and-resolution.md` reserved-tool note, the `interfaces/README.md` index
  row), and a worked example in `api/oss/tests/manual/tools/tools.http`. The reverse pointer from
  the `search_tools` stub in `agent-creation-skills/custom-tools-design.md` to this project is
  DEFERRED: that file is owned by the still-open #4863 lane, so its owner adds the pointer there
  rather than this PR editing
  another lane's file. This project's README/design already link to it.
- Branch and PR via GitButler stacked lane (never a worktree), base `big-agents`.
