# Implementation plan

Layered bottom-up so each phase is independently testable. The engine (Composio) is verified;
the work is the Agenta-native wrapper and the translation.

## Phase 0 — Spike and verify (done)

- Confirmed `COMPOSIO_SEARCH_TOOLS` runs via `POST /tools/execute/{slug}` (no MCP session).
- Confirmed the response carries tools + alternatives + inline schemas + plan + pitfalls +
  per-user connection state.
- Confirmed connection state is per `user_id`, and Agenta sets Composio `user_id = project_id`.
- All recorded in `research.md`. Decisions to settle before Phase 1: D1-D6 in `status.md`.

## Phase 1 — Adapter method

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

## Phase 2 — Core discovery service and translation

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

## Phase 3 — REST endpoint

Add `POST /tools/discover` to `api/oss/src/apis/fastapi/tools/router.py`, project-scoped via the
existing auth dependency (gives `project_id`).

- Request/response models in `api/oss/src/apis/fastapi/tools/models.py`.
- Caching: cache the tool/schema half (per use_case, provider) with the existing 5-min TTL;
  re-resolve connection state fresh each call (it changes when a user connects). Split keys or
  short TTL for the connection part.
- Add a worked example to `api/oss/tests/manual/tools/tools.http`.

## Phase 4 — Agent-facing tool

Expose `find_capabilities` to harnesses through the gateway/builtin tool path, consistent with
[`../agent-creation-skills/custom-tools-design.md`](../agent-creation-skills/custom-tools-design.md).

- The tool calls `POST /tools/discover` with the run's caller auth (project scope flows
  through).
- Register it where builder tools are defined (SDK `agenta.sdk.agents`, service tool wiring,
  runner `buildCustomTools`). Decide reserved provider (`tools.agenta.*`) vs builtin name (D1).
- The builder agent's `agents_md` documents the discover -> resolve-connections -> create ->
  test loop.

## Phase 5 — Live end to end and a replay test

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
- Keep docs in sync (the `keep-docs-in-sync` skill): update the `search_tools` stub in
  agent-creation-skills to point here, and the interface inventory when the endpoint lands.
- Branch and PR via GitButler stacked lane (never a worktree), base `big-agents`.
