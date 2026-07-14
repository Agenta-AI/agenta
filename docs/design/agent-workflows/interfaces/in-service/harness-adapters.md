# Harness Adapters

The three harnesses look the same from the outside and behave differently inside. The harness
adapters are where that difference lives: each turns a neutral `SessionConfig` into a
harness-specific config and decides how tools, prompts, and policy reach the agent. When a
behavior should differ by harness, it differs here.

The `Harness` port and the per-harness roles are narrated in
[Ports and adapters](../../documentation/ports-and-adapters.md#harness). This page owns the
review lens: the wire-shape differences and what to check when one moves.

## The contract

Each adapter implements `_to_harness_config(...)` and emits a different `/run` wire shape:

- **`PiHarness`** delivers built-in tool names and native custom tools, supports Pi prompt
  overrides (`system`, `append_system`), and carries the same `permissions` block as the other
  harnesses. Pi has no native permission gate of its own (no `.claude/settings.json` equivalent),
  so the runner's tool relay enforces `permissions` for Pi at execution time; an `ask` verdict
  pauses the run and Pi gets the same human-in-the-loop approval Claude gets at its gate.
- **`ClaudeHarness`** delivers tools over MCP, not natively, and has no Pi built-ins (it warns
  if any are set). It carries `permissions` and renders `.claude/settings.json` from four
  sources — the author's `harness_kwargs["claude"]["permissions"]` slice, the sandbox permission,
  each user MCP server's permission (`mcp__<server>` rules), and each resolved EXECUTABLE tool's
  permission (`mcp__agenta-tools__<name>` rules; F-046) — shipped as `harnessFiles`. It carries
  inline skill packages on the wire like the others; the runner materializes them under
  `.claude/skills` in the session cwd, matching Claude's project-local skill layout.
- **`AgentaHarness`** runs on the same Pi engine but forces Agenta's opinion: it composes the
  base instructions over the author's, forces the Agenta tool set, and layers the Agenta
  persona into `append_system`.

The wire shapes, side by side:

| | Pi | Claude | Agenta |
|---|---|---|---|
| built-in tools | yes | no | forced set |
| custom tools | native | over MCP | native |
| prompt overrides | `system`/`append_system` | none (reads `harness_kwargs`) | forced `append_system` + author `system` |
| permission policy | carried, enforced by the relay | carried, enforced by settings + the responder | carried, enforced by the relay |
| inline skills | yes (agent-dir scope) | yes (materialized to `.claude/skills`) | yes (agent-dir scope) |
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
- **Claude skill delivery.** Claude wires inline skills like the other harnesses; the runner
  materializes them under `.claude/skills`. (An earlier revision suppressed Claude's
  `wire_skills()` to `{}`; that override is gone, and `test_claude_carries_skills_for_project_local_materialization`
  now pins the carry-on-wire behavior.)
- **Harness options.** The `harness_kwargs` bag is keyed by harness; each adapter reads only
  its own slice.
- **Claude `agenta-tools` server-name coupling.** The per-resolved-tool settings.json rules use
  the fixed name `mcp__agenta-tools__<tool>` (`INTERNAL_TOOL_MCP_SERVER` in
  `adapters/claude_settings.py`). It MUST match the runner's internal tool-MCP server name on
  BOTH transports (`INTERNAL_TOOL_MCP_SERVER_NAME` in
  `services/runner/src/engines/sandbox_agent/mcp.ts`; the local loopback channel in
  `services/runner/src/tools/{mcp-bridge,tool-mcp-http}.ts` and the Daytona in-sandbox stdio
  shim in `tool-mcp-stdio.ts`). Renaming the server on one side without the other silently
  re-pauses `allow` tools on Claude (the bug F-046 fixed). Because the rules render against
  this name, it is reserved: the runner refuses a user-declared MCP server named
  `agenta-tools` at declaration time and again at session materialization.
