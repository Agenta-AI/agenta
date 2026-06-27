# Status

Source of truth for this project. Update as work proceeds.

## Current state — 2026-06-27

D1-D6 settled (Mahmoud: "go with the recommendations"). Implementation Phase 1 landed on PR
#4884 (the design/plan docs lane, reused for the implementation): the Composio adapter search
method, the Composio→Agenta translation, connection-state reporting, structured guidance, the
v1 action-only scope + trigger note, the cache split, a recorded-fixture replay test, and the
setup-agent skill. The REST endpoint + reserved agent tool (Phase 3/4) are deferred because
they touch `apis/fastapi/tools/router.py` and the SDK `tools/models.py`, owned by a concurrent
Workstream-B task; they resume once those files are free.

- [x] Phase 0: spike + verify (`research.md`)
- [x] Design + field-usefulness analysis (`design.md`)
- [x] Use-case walkthrough with real outputs (`use-case-walkthrough.md`)
- [x] Decisions D1-D6 settled (recommendations accepted)
- [x] Phase 1: adapter method (`ComposioToolsAdapter.search_capabilities`)
- [x] Phase 2: core service + translation (`ToolsService.discover_capabilities`,
      `core/tools/discovery.py`, the discovery DTOs, the D6 cache split) + unit tests
- [ ] Phase 3: REST endpoint `POST /tools/discover` (DEFERRED — needs `tools/router.py`)
- [ ] Phase 4: agent-facing reserved tool `tools.agenta.find_capabilities`
      (DEFERRED — needs the SDK `tools/models.py` + reserved-tool registration)
- [ ] Phase 5: live E2E + replay-fixture upgrade from a real captured run

The setup-agent skill (plan.md:76) shipped in this PR:
`skills/discover-and-wire-tools/SKILL.md` (the discover -> resolve-connections -> create ->
test loop). Testing it with a subagent and the `/debug-local` exploratory QA (plan.md:84) are
orchestrator follow-ups once Phase 3/4 land.

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
  reserved `tools.agenta.find_capabilities` (out of the Composio namespace). (Both are Phase
  3/4, deferred behind `router.py`/`models.py`.)
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
