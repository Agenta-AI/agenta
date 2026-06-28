# Status

Source of truth for this project. Update as work proceeds.

## Current state — 2026-06-27

D1-D6 settled (Mahmoud: "go with the recommendations"). Phases 1-3 plus the server side of
Phase 4 landed on PR #4884. Phase 1-2: the Composio adapter search, the Composio→Agenta
translation, connection-state reporting, structured guidance, the v1 action-only scope +
trigger note, the cache split, a recorded-fixture replay test, and the setup-agent skill. Phase
3: `POST /tools/discover`. Phase 4 (server side): the `tools.agenta.find_capabilities` reserved
tool is routable over `/tools/call` (`_call_agenta_tool` → `discover_capabilities`). The one
remaining piece is the **SDK-side reserved-tool declaration/resolution** — how an agent config
surfaces `find_capabilities` and how `platform.resolve_tools` emits its `CallbackToolSpec`. That
rides the in-flight direct-call-tools "platform-op catalog" seam (which adds `CallbackToolSpec.call`
and a platform-op mechanism), so building it separately now would duplicate/conflict; it is
deferred to that seam. The runner needs no change (it forwards the call_ref opaquely).

- [x] Phase 0: spike + verify (`research.md`)
- [x] Design + field-usefulness analysis (`design.md`)
- [x] Use-case walkthrough with real outputs (`use-case-walkthrough.md`)
- [x] Decisions D1-D6 settled (recommendations accepted)
- [x] Phase 1: adapter method (`ComposioToolsAdapter.search_capabilities`)
- [x] Phase 2: core service + translation (`ToolsService.discover_capabilities`,
      `core/tools/discovery.py`, the discovery DTOs, the D6 cache split) + unit tests
- [x] Phase 3: REST endpoint `POST /tools/discover` (`CapabilitiesQuery` →
      `discover_capabilities` → `CapabilitiesResult`; `DiscoveryUnsupportedError` → 422)
- [~] Phase 4: agent-facing reserved tool `tools.agenta.find_capabilities` — SERVER side wired
      (`/tools/call` `_call_agenta_tool` route + the canonical reserved-tool spec in
      `discovery.py`); SDK-side declaration/resolution PENDING (rides direct-call-tools platform-op)
- [ ] Phase 5: live E2E + replay-fixture upgrade from a real captured run

The setup-agent skill (plan.md:76) shipped in this PR:
`skills/discover-and-wire-tools/SKILL.md` (the discover -> resolve-connections -> create ->
test loop). Testing it with a subagent and the `/debug-local` exploratory QA (plan.md:84) are
orchestrator follow-ups once the SDK reserved-tool declaration lands.

## What landed in Phases 3-4 (router + reserved tool, file map)

- `api/oss/src/apis/fastapi/tools/router.py` — `POST /tools/discover` route + handler
  (`discover_capabilities`, `VIEW_TOOLS`, `DiscoveryUnsupportedError` → 422); `_call_agenta_tool`
  + the `tools.agenta.` prefix branch in `call_tool` (server side of the reserved tool).
- `api/oss/src/apis/fastapi/tools/models.py` — `CapabilitiesQuery` request model.
- `api/oss/src/core/tools/discovery.py` — the reserved-tool constants/spec
  (`AGENTA_TOOL_CALL_REF_PREFIX`, `FIND_CAPABILITIES_*`, `parse_find_capabilities_arguments`).
- docs: `documentation/tools.md`, the interface inventory
  (`cross-service/runner-to-tool-callback.md`, `in-service/tool-models-and-resolution.md`,
  `interfaces/README.md`), and a worked example in `api/oss/tests/manual/tools/tools.http`.

## Remaining: the SDK reserved-tool declaration/resolution (the only open piece)

For a setup agent to actually call `find_capabilities`, the SDK must emit a `CallbackToolSpec`
for it so it reaches the runner as a custom tool. The server already accepts the call. The spec
the SDK needs to emit is fixed and lives in `core/tools/discovery.py`:

- `call_ref = "tools.agenta.find_capabilities"` (`FIND_CAPABILITIES_CALL_REF`)
- `name = "find_capabilities"`, `description = FIND_CAPABILITIES_DESCRIPTION`
- `input_schema = FIND_CAPABILITIES_INPUT_SCHEMA` (`use_cases[]` required; `provider`,
  `limit_alternatives` optional)
- the shared `ToolCallback` to `{api}/tools/call` (same as gateway/reference tools)

It belongs on the direct-call-tools platform-op seam (a config kind / reserved name that
`platform.resolve_tools` recognizes and resolves to the above), not a parallel mechanism. No
runner change.

## What landed in Phase 1 (file map)

- `api/oss/src/core/tools/providers/composio/adapter.py` — `search_capabilities` (the
  `POST /tools/execute/COMPOSIO_SEARCH_TOOLS` call).
- `api/oss/src/core/tools/providers/composio/dtos.py` — typed `ComposioSearchResult`
  (results, tool_schemas, toolkit_connection_statuses); `status_message` deliberately dropped.
- `api/oss/src/core/tools/dtos.py` — the Agenta-native response DTOs (`CapabilitiesResult`,
  `Capability`, `DiscoveredTool`, `ConnectionRequirement`, `CapabilityGuidance`,
  `ToolConnectionState`, `ConnectAffordance`).
- `api/oss/src/core/tools/discovery.py` — pure Composio→Agenta translation (slug split,
  guidance slug-rewrite, alternatives cap, trigger detection).
- `api/oss/src/core/tools/service.py` — `discover_capabilities` orchestration: cached search +
  fresh connection-state join + translate; `_discovery_connection_state` / `_connection_auth_state`.
- `api/oss/src/core/tools/exceptions.py` — `DiscoveryUnsupportedError`.
- `api/oss/tests/pytest/unit/tools/test_discovery.py` + `fixtures/composio_search_tools.json`
  — recorded-fixture replay + translation + connection-state + cache-split tests.

## Implementation note — connection-state source (small refinement of the design)

The design's state machine reads `ready` as "Composio `has_active_connection: true` AND a valid
`gateway_connections` row." The implementation derives `ready` from our own rows only (active +
valid + a usable provider connection — exactly what `resolve_connection_by_slug` accepts at
invoke time). Reason: D6 caches the tool/schema half, so the Composio per-user status in that
blob would go stale; our DB row is always fresh (the OAuth callback sets `is_valid`) and is the
authority for whether the tool will actually resolve. The two agree when `user_id = project_id`
(research.md §3), so this is a freshness refinement, not a behavior change. The cached blob has
`toolkit_connection_statuses` stripped to keep it project-agnostic.

## Key verified facts (do not relitigate)

- `COMPOSIO_SEARCH_TOOLS` is a plain `POST /tools/execute/{slug}` call. No MCP session.
- One call returns tools + alternatives + inline schemas + plan + pitfalls + connection state.
- Connection state is per `user_id`; Agenta sets Composio `user_id = str(project_id)`
  (`gateway/connections/service.py:172,324`). So pass `project_id` to get the project's state.
- No rerank, no embeddings on our side. Composio does the semantic ranking. (Explicit ask.)

## Decisions (all SETTLED 2026-06-27 — Mahmoud: "go with the recommendations")

- **D1 — endpoint + tool naming. SETTLED.** New `POST /tools/discover` endpoint, agent tool as
  reserved `tools.agenta.find_capabilities` (out of the Composio namespace). Both landed
  server-side in this PR; only the SDK-side reserved-tool declaration remains.
- **D2 — translate vs pass through. SETTLED: translate fully** to Agenta concepts (`integration`
  + `action`, connection slugs, our `POST /tools/connections/` affordance). The raw Composio
  slug rides along only as an opaque `provider_action`; plan/pitfalls are guidance text with
  slugs rewritten to `integration.action`. Implemented in `core/tools/discovery.py`.
- **D3 — report vs act on connections. SETTLED: report + affordance.** Report the connection
  state and return the create affordance; do not auto-create (a human approves OAuth). The
  connection state machine in `design.md` is implemented as `ToolConnectionState`.
- **D4 — agents_md draft. SETTLED: structured guidance now.** Return plan + pitfalls as
  structured `guidance` and let the setup agent compose `agents_md` (the new skill teaches it).
  A ready-made `agents_md` draft is a later convenience (Phase 6).
- **D5 — triggers in scope? SETTLED: scope v1 to action tools.** Composio has NO semantic
  search for triggers (`COMPOSIO_SEARCH_TRIGGERS` 404; the tool search ignores trigger
  phrasing; only keyword `/triggers_types` + `COMPOSIO_LIST_TRIGGERS` exist, see research.md
  §4). v1 returns action tools and flags a trigger-shaped use case with a clear note
  (`Capability.note` + top-level `notes`); the listen side is a follow-up over the keyword
  triggers catalog (Phase 6). Implemented as `discovery.looks_like_trigger`.
- **D6 — connection-state freshness vs caching. SETTLED: split.** Cache the tool/schema half
  (the expensive search) project-agnostically; recompute connection state fresh from
  `gateway_connections` every call so it flips the moment a user connects. Implemented in
  `ToolsService._cached_search` (strips per-project state before caching) +
  `_discovery_connection_state`. See the implementation note above on the connection-state
  source.

## Risks / things to watch

- Latency: the endpoint runs an LLM internally (few seconds). Acceptable for a setup-time call;
  not for a hot path. Cache the tool/schema half.
- `session.id` returned `"body"` for `generate_id: true`. A quirk; harmless for one-shot use,
  but verify before relying on session continuation.
- Plan/pitfall text references Composio slugs; map to friendly `integration.action` names
  before showing the agent so nothing Composio leaks.
- Multiple connections per toolkit per project are possible; pick the active/valid one when
  resolving the slug.

## Links

- Parent design note (the `search_tools` stub this implements):
  [`../agent-creation-skills/custom-tools-design.md`](../agent-creation-skills/custom-tools-design.md)
- Create/invoke loop already verified: [`../agent-creation-skills`](../agent-creation-skills)
