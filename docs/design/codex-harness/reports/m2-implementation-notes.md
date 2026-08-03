# Milestone 2 implementation notes

Agenta tools working on the Codex harness over the internal `agenta-tools` MCP channel, plus
model-catalog pricing and the run-cost fix. Feature code written by Codex (`gpt-5.6-sol`) via
`codex exec`, orchestrated and reviewed by Opus; the replay test authored directly (test code
tightly coupled to a captured fixture). Local commits only, nothing pushed.

## Headline

Milestone 2 is complete and green. Agenta tools DELIVER and EXECUTE on Codex over the internal
`agenta-tools` loopback MCP channel, proven live on the worktree deployment: a real Codex run
called the platform `discover_tools` tool (delivered as `mcp.agenta-tools.discover_tools`, the
Codex dot naming), the runner relayed it server-side, and the tool_call + tool_result were traced.
Cost now renders non-zero (was $0.00). One live tool run is pinned as an offline replay regression
test. SDK agents unit suite 681 green, agents integration (cost_free) 8 green, runner suite 1222
green.

## The big finding: the M1 cost diagnosis was wrong (premise pivot, surfaced)

M1 reported "$0.00 cost; the curated Codex catalog needs pricing." That diagnosis is incorrect for
the RUN cost. Evidence gathered before writing any code:

- The platform run-cost calc (`api/oss/src/core/tracing/utils/trees.py` `calculate_costs`) calls
  `litellm.cost_per_token(model=...)`, reading the model from `ag.meta.response.model` OR
  `ag.data.parameters.model`. The curated catalog `pricing` only feeds the model-picker tooltip
  (FE `connectionUtils.ts`), never the run cost.
- litellm 1.92.0 (in the API container) already KNOWS the bare Codex ids
  (`gpt-5.6-luna -> (0.001, 0.006)/1k`).
- Inspecting the actual Codex `chat` span (`POST /tracing/spans/query`): `ag.meta.request.model =
  gpt-5.6-luna` but `ag.meta.response.model = None` and `ag.data.parameters.model = None`, and the
  Codex ACP usage carries no cost. So the cost calc finds no model in the fields it reads -> $0.00.

Real fix: emit `gen_ai.response.model` on the Codex LLM span (parity with Pi). Scoped to Codex so
other harnesses' cost source is untouched (litellm knows `claude-fable-5`, so an unscoped change
would silently recompute Claude cost). Curated pricing was still added (scope C, correct, feeds the
tooltip) but honestly is not what fixes the run cost.

## Scope decision surfaced (NOT baked): D-008 full-access default kept in M3

The approved D-008 default ACP mode is `agent-full-access` (no Codex gates). It is NOT wired in M2.
Live QA proved tools execute today: under the default `agent` mode a Codex MCP call raises an ACP
gate that the runner AUTO-ALLOWS per the plan default (`[HITL] gate ... permission=allow
outcome=allow`). Wiring the full-access default is intertwined with M3's runner-side gating +
per-agent mode override (plan.md M3), and the milestone brief scopes M2 to no approval work, so it
was kept in M3. Consequence if kept in M3: an M2 agent whose runner permission default is
`ask`/`deny` would have its Codex tool calls park (M2 uses the `allow` default, so unaffected). This
is flagged for Mahmoud to pull forward if desired; the mechanism is
`session.setConfigOption("mode","agent-full-access")` (spike e-round proven) or `session.setMode`.

## What was built (file list)

Runner (`services/runner/src`):
- `tracing/otel.ts` — Codex-only `gen_ai.response.model` stamp on the LLM span (cost fix).
- `engines/sandbox_agent/client-tools.ts` — `bareToolName` strips both `mcp__<server>__` (Claude)
  and `mcp.<server>.` (Codex).
- `engines/sandbox_agent/acp-interactions.ts` — `serverPermissionFor` recovers the server from the
  Codex `mcp.<server>.<tool>` dot form.
- tests: `tests/unit/otel-codex-response-model.test.ts` (new), `client-tools.test.ts`,
  `sandbox-agent-acp-interactions.test.ts`.

SDK (`sdks/python/agenta/sdk/agents`):
- `capabilities.py` — Codex `mcp` user_servers block (mirrors Claude; tools milestone).
- `data/codex_models.curated.json` — litellm-sourced `pricing` + `context_window` for all 5 models,
  updated `_curation.note` / `sources`.
- tests: `connections/test_capabilities.py` (codex mcp assertion), `test_capabilities_codex.py`
  (pricing assertion).
- replay: `oss/tests/pytest/integration/agents/_fake_runner_backend.py` (+CODEX),
  `test_codex_tool_replay.py` (new), `recordings/codex-agenta-tools-call.json` (new).

Web (`web/packages/agenta-entity-ui`):
- `DrillInView/SchemaControls/HarnessSelectControl.tsx` — Codex avatar entry (`Cx`, `#10a37f`).
  `pnpm lint-fix` clean.

## Codex-exec tasks issued and review

All driven with `codex exec -m gpt-5.6-sol --cd <worktree> --dangerously-bypass-approvals-and-sandbox`
(the outer Bash 120s cap killed the first foreground run; re-run in the background). `codex exec`
worked reliably.

1. **Runner (cost + naming).** Faithful. Correct Codex-only scoping on the cost stamp; `bareToolName`
   uses `/^(?:mcp__.+?__|mcp\.[^.]+\.)/`; `serverPermissionFor` handles the dot form. Typecheck clean;
   `pnpm test` 1222 passed.
2. **SDK (capabilities mcp + pricing).** Faithful. mcp block mirrors Claude; pricing matches litellm;
   comment updated. `ruff format`/`ruff check` clean; agents unit 681.
3. **Web (avatar).** One-line map entry; `pnpm lint-fix` clean.

The replay test + fixture were authored directly (test code + a captured recording), disclosed here.

## Test results (exact)

- Runner: `cd services/runner && pnpm test` -> **1222 passed (79 files)**; `pnpm run typecheck` clean.
  Changed files re-run: `otel-codex-response-model` + `client-tools` + `sandbox-agent-acp-interactions`
  -> 51 passed.
- SDK agents unit: `uv run --no-sync python -m pytest oss/tests/pytest/unit/agents/ -q` -> **681 passed**.
- SDK agents integration (cost_free): `... integration/agents/ -m "integration and cost_free" -n0`
  -> **8 passed** (includes the new `test_codex_tool_replay`).
- `ruff format` + `ruff check` clean.

## Live QA (worktree deployment http://<dev-host>:8180, project 019f93b7-...)

Driver: `docs/design/codex-harness/spike/scripts/m2-qa.py` (product endpoint
`POST /services/agent/v0/invoke`, harness codex, model gpt-5.6-luna, managed openai).

- **Tool over the internal channel — PASS (channel).** Prompt forced a `discover_tools` call.
  Runner logs: `internal tool MCP server on http://127.0.0.1:PORT/mcp serving 1 tool(s)`; Codex
  called `mcp.agenta-tools.discover_tools`; after the naming fix the gate logs
  `executor="relay" specName="discover_tools" permission=allow outcome=allow` (before the fix it was
  `executor="harness"` with the full dotted anchor). tool_call + tool_result were persisted (traced).
  The tool's own backend returned HTTP 404 `Provider not found: composio` — a deployment gap (no
  Composio provider configured here), NOT a Codex issue. The channel, invocation, relay, and event
  tracing are all proven.
- **Cost — PASS.** After the runner fix, a Codex chat span carries `ag.meta.response.model =
  gpt-5.6-luna` and `ag.metrics.costs.incremental.total = 0.011582` for a 11.5K-prompt / 6-completion
  turn (was `costs = {}`). Verified via `POST /tracing/spans/query`.
- **Capabilities — PASS.** The daemon-probed capabilities for Codex carry `mcpTools: true`,
  `toolCalls: true` (captured in the replay fixture), so tool delivery is gated on correctly.

## Replay regression test (offline, no live LLM)

`test_codex_tool_replay.py` replays `recordings/codex-agenta-tools-call.json` (a real Codex
`gpt-5.6-luna` run captured off the live streaming path, events merged into the result, ids
redacted) through the real SDK transport + `result_from_wire` inside `CodexHarness`. It asserts the
STRUCTURE the run proves: exactly one tool_call named `mcp.agenta-tools.discover_tools` over the
`agenta-tools` server, a matching tool_result, `capabilities.mcp_tools`/`tool_calls` True,
`stop_reason == end_turn`, `model == gpt-5.6-luna`. It does NOT assert the tool backend's success or
any prose (the recorded tool_result is `isError` only because the QA deployment lacked Composio) —
per the `agent-replay-test` skill, a replay pins structure. Green offline, `cost_free`.

## Pricing sourced (litellm registry, USD per Mtok)

sol 5/30 (cache 0.5) ctx 1.05M · terra 2.5/15 (0.25) 1.05M · luna 1/6 (0.1) 1.05M ·
5.5 5/30 (0.5) 1.05M · 5.2 1.75/14 (0.175) 272K. Source cited in the curated file
(`_curation.sources`): litellm model registry (models.litellm.ai), the same registry the run-cost
path uses, so the tooltip and run cost agree.

## Quality passes

- Reviewed every codex diff; each mirrors the adjacent pattern (Pi response.model, the
  `mcp__` matchers, the Claude mcp capability block, the Claude/Pi curated pricing shape).
- Reverted an unrelated `ruff format` blank-line change in `test_workflow_control_running.py` to keep
  the M2 diff focused.
- The temporary capture hook in `streaming.py` (used once to record the replay fixture) was fully
  reverted — `git diff streaming.py` is empty.
- Comments are invariant-only; no em dashes; no dead scaffolding.

## Skips / not done (deliberate)

- D-008 `agent-full-access` default mode: kept in M3 (surfaced above), tools work without it.
- Composio-backed tools cannot succeed on this deployment (no provider); a success-path recording
  would need a working tool backend or a committed callback workflow. The channel is fully proven; a
  `code` tool is rejected by the sidecar (`Code tools are not supported by the sidecar`), so it is
  not a QA option.
- User HTTP MCP servers on Codex (now enabled by the capabilities block) were not exercised live
  (the internal channel is M2's core); the release-gate `mcp` cell can cover it in M5.

## Open questions

- Pull D-008's `agent-full-access` default into M2, or keep in M3? (surfaced above; kept in M3).
- A success-path tool recording would strengthen the replay test; needs a deployment with a working
  tool backend. Flagged, not blocking.
