# Research

Research date: 2026-07-11

## Current Agenta path

| Layer | Current location | Finding |
| --- | --- | --- |
| Author schema | `sdks/python/agenta/sdk/utils/types.py`, `_LlmSchema` | Supports model, provider, connection, and arbitrary extras; no first-class reasoning block. |
| Template parsing | `sdks/python/agenta/sdk/agents/dtos.py`, `AgentTemplate.from_params()` | `llm.extras.reasoning_effort` reaches `ModelRef.extras`. |
| Harness adapters | `sdks/python/agenta/sdk/agents/adapters/harnesses.py` | Pi and Claude pass the model but drop `ModelRef.extras`. |
| Python wire | `sdks/python/agenta/sdk/agents/utils/wire.py` | `/run` serialization has no reasoning or effort field. |
| Wire mirrors | `sdks/python/agenta/sdk/agents/wire_models.py`, `services/runner/src/protocol.ts` | Both descriptive models/types need the same optional field; neither provides complete live runtime validation today. |
| Session setup | `services/runner/src/engines/sandbox_agent.ts` | Creates or resumes a session, then calls `applyModel()` before prompting. |
| Session reuse | `services/runner/src/engines/sandbox_agent/session-pool.ts` | The configuration fingerprint omits reasoning, so an effort change would currently reuse the wrong hot session. |
| UI | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx` | Model and harness controls already share one accordion; no effort control exists. |
| UI object helpers | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/connectionUtils.ts` | Existing composition preserves unknown keys and is the right home for pure reasoning helpers. |

The existing DTO unit test in `sdks/python/oss/tests/pytest/unit/agents/test_dtos_agent_template.py` proves that legacy extras parse. It does not prove execution because the value is lost downstream.

## ACP and harness findings

### Claude

The runner used deprecated `@zed-industries/claude-agent-acp` 0.23.1. PR #5213 upgrades local runner sessions to `@agentclientprotocol/claude-agent-acp` 0.58.1.

The new adapter:

- exposes config option id `effort`;
- categorizes it as `thought_level`;
- recomputes allowed values from the selected model;
- applies it through the Claude Agent SDK's `effortLevel` flag settings.

Live verification on the rebuilt local sidecar returned `default`, `low`, `medium`, `high`, `xhigh`, and `max` for Sonnet, accepted `low`, and read back `currentValue: low`.

Claude Code also supports effort without ACP through `/effort`, `--effort`, `CLAUDE_CODE_EFFORT_LEVEL`, settings, and frontmatter. Those mechanisms should remain operator controls. They should not become the template storage contract.

### Pi

Pi core already supports session thinking levels and persists a selected level to `defaultThinkingLevel`. The installed Pi ACP 0.0.29 exposes ACP `thought_level` values `off`, `minimal`, `low`, `medium`, `high`, and `xhigh` as one adapter-wide list. It does not expose the selected model's exact support table. Model-specific incompatibility becomes visible only when Pi clamps and readback differs.

No Pi extension is required. `sandbox-agent` 0.4.2 already provides `Session.setThoughtLevel()` and `Session.getConfigOptions()` for both adapters.

Pi core has newer `max` support, but Pi ACP 0.0.29 does not advertise it. The contract can retain `max` as a cross-provider union if the runtime rejects it until the adapter supports it.

### Default leakage

Pi's session setter persists the chosen thinking level into its settings manager. If one agent explicitly runs at high and the next agent omits effort, doing nothing can inherit high. The runner therefore needs an explicit reset policy for omission/default.

Claude also persists some CLI effort choices. The adapter's `default` option is the correct reset at the session layer when available.

## Upstream status and risks

- Current stable Claude adapter at research time: [0.58.1](https://github.com/agentclientprotocol/claude-agent-acp/releases/tag/v0.58.1).
- Effort support: [PR #464](https://github.com/agentclientprotocol/claude-agent-acp/pull/464), released after 0.23.1.
- Open permission/subagent risk: [issue #851](https://github.com/agentclientprotocol/claude-agent-acp/issues/851).
- The runner's local `sandbox-agent` client uses an older ACP SDK than the new adapter. The live handshake and effort readback passed, but permissions, cancellation, resume, and subagent behavior still need the broader matrix.
- Daytona uses the adapter baked into its sandbox image. Updating the runner package changes local sessions only.

## Interface classification

Effort is model behavior configuration:

- owner: template author;
- lifecycle: stored with a revision and stable across its runs;
- sensitivity: non-secret;
- wire role: execution configuration;
- runtime mechanism: ACP thought-level category;
- observability: requested and adapter-reported values should be logged or traced without credentials; provider-effective claims require separate precedence evidence.

It is not policy, routing, credentials, metadata, or harness implementation detail. This is why it belongs under `llm.reasoning`, not `harness.extras`, `runner`, or Claude settings.

