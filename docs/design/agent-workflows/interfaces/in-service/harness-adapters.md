# Harness Adapters

The three harnesses look the same from the outside and behave differently inside. The harness
adapters are where that difference lives: each turns a neutral `SessionConfig` into a
harness-specific config and decides how tools, prompts, and policy reach the agent. When a
behavior should differ by harness, it differs here.

## The contract

Each adapter implements `_to_harness_config(...)` and emits a different `/run` wire shape:

- **`PiHarness`** delivers built-in tool names and native custom tools, supports Pi prompt
  overrides (`system`, `append_system`), and drops `permission_policy` because Pi never gates
  tool use.
- **`ClaudeHarness`** delivers tools over MCP, not natively, and has no Pi built-ins (it warns
  if any are set). It carries `permission_policy` and renders `.claude/settings.json` from
  `harness_options` and the sandbox permission, shipped as `harnessFiles`. It cannot load
  inline skill packages, so its `wire_skills()` returns `{}`.
- **`AgentaHarness`** runs on the same Pi engine but forces Agenta's opinion: it composes the
  base instructions over the author's, forces the Agenta tool set, and layers the Agenta
  persona into `append_system`.

The wire shapes, side by side:

| | Pi | Claude | Agenta |
|---|---|---|---|
| built-in tools | yes | no | forced set |
| custom tools | native | over MCP | native |
| prompt overrides | `system`/`append_system` | none (reads `harness_options`) | forced `append_system` + author `system` |
| permission policy | dropped | carried | dropped |
| inline skills | yes | no (`{}`) | yes |
| harness files | none | `.claude/settings.json` | none |

## Owned by

- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`: the three adapters.
- `sdks/python/agenta/sdk/agents/dtos.py`: the `PiAgentConfig`/`ClaudeAgentConfig`/
  `AgentaAgentConfig` wire emitters.

## Watch for when changing

- **Tool delivery per harness.** Native versus MCP is the load-bearing difference. Pi takes
  tools natively; everyone else gets them over the MCP bridge.
- **Prompt override behavior.** Pi replaces or appends; Claude reads options; Agenta composes.
- **Forced Agenta behavior.** Instruction composition and the forced tool set are deliberate.
- **The Claude skills override.** `wire_skills()` must stay `{}`. It was lost in a merge once
  and regressed a cross-harness test.
- **Harness options.** The `harness_options` bag is keyed by harness; each adapter reads only
  its own slice.
