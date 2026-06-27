# Status

Source of truth for this project. Update as work proceeds.

## Current state — 2026-06-27

Planning + spike complete. No code written. The Composio engine is verified live; the design
and the use-case walkthrough are written. Awaiting decisions on D1-D6 before Phase 1.

- [x] Phase 0: spike + verify (`research.md`)
- [x] Design + field-usefulness analysis (`design.md`)
- [x] Use-case walkthrough with real outputs (`use-case-walkthrough.md`)
- [ ] Decisions D1-D6 settled
- [ ] Phase 1: adapter method
- [ ] Phase 2: core service + translation
- [ ] Phase 3: REST endpoint
- [ ] Phase 4: agent-facing tool
- [ ] Phase 5: live E2E + replay test

## Key verified facts (do not relitigate)

- `COMPOSIO_SEARCH_TOOLS` is a plain `POST /tools/execute/{slug}` call. No MCP session.
- One call returns tools + alternatives + inline schemas + plan + pitfalls + connection state.
- Connection state is per `user_id`; Agenta sets Composio `user_id = str(project_id)`
  (`gateway/connections/service.py:172,324`). So pass `project_id` to get the project's state.
- No rerank, no embeddings on our side. Composio does the semantic ranking. (Explicit ask.)

## Open decisions (need the user)

- **D1 — endpoint + tool naming. SETTLED 2026-06-27 (user approved).** New `POST /tools/discover`
  endpoint, agent tool as reserved `tools.agenta.find_capabilities` (out of the Composio
  namespace).
- **D2 — translate vs pass through.** Lean: translate fully to Agenta concepts
  (`integration` + `action`, connection slugs, our connection-create affordance); keep raw
  Composio slug only as an opaque `provider_action` and the plan/pitfalls as guidance text.
- **D3 — report vs act on connections.** Lean: report state + return the create affordance; do
  not auto-create (a human approves OAuth). Matches the connection state machine in `design.md`.
- **D4 — agents_md draft.** Return plan + pitfalls as structured `guidance` and let the setup
  agent compose `agents_md`, or also return a ready-made draft? Lean: structured now, optional
  draft later.
- **D5 — triggers in scope?** Stronger lean now, backed by a finding: Composio has NO semantic
  search for triggers (`COMPOSIO_SEARCH_TRIGGERS` 404; the tool search ignores trigger
  phrasing; only keyword `/triggers_types` + `COMPOSIO_LIST_TRIGGERS` exist, see research.md
  §4). So triggers cannot share the one-call semantic path. Lean: scope the first slice to
  action tools, return a clear "this needs a trigger subscription" note, and handle the
  listen side as a follow-up over the keyword triggers catalog (Phase 6).
- **D6 — connection-state freshness vs caching.** Cache the tool/schema half; re-check
  connection state fresh (it flips when a user connects). Lean: split cache keys, short TTL on
  the connection part.

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
