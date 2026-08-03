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

- **`PiHarness`** delivers native custom tools (built-ins are not configured: the runner
  activates all seven on every Pi run), supports Pi prompt
  overrides (`system`, `append_system`), and carries the same `permissions` block as the other
  harnesses. Pi has no native permission gate of its own (no `.claude/settings.json` equivalent),
  so the runner's tool relay enforces `permissions` for Pi at execution time; an `ask` verdict
  pauses the run and Pi gets the same human-in-the-loop approval Claude gets at its gate.
- **`ClaudeHarness`** delivers tools over MCP, not natively, and has no Pi built-ins. It carries
  `permissions` and renders
  `.claude/settings.json` from four
  sources — the author's `harness_kwargs["claude"]["permissions"]` slice, the sandbox permission,
  each user MCP server's permission (`mcp__<server>` rules), and each resolved EXECUTABLE tool's
  permission (`mcp__agenta-tools__<name>` rules; F-046) — shipped as `harnessFiles`. It carries
  inline skill packages on the wire like the others; the runner materializes them under
  `.claude/skills` in the session cwd, matching Claude's project-local skill layout.
- **`AgentaHarness`** runs on the same Pi engine but forces Agenta's opinion: it composes the
  base instructions over the author's, forces the Agenta tool set, and layers the Agenta
  persona into `append_system`.
- **`CodexHarness`** drives the `codex` ACP agent. It delivers custom tools over the internal
  `agenta-tools` MCP channel (like Claude) and renders `.codex/config.toml` (`codex_settings.py`).
  Codex's default runtime mode is `agent-full-access`; the runner image and the Daytona snapshot
  patch codex-acp's full-access preset from `approvalPolicy: "never"` to `on-request` (D-008
  amendment, 2026-07-31), so Agenta-tool calls raise codex-native ACP permission gates that park
  WARM on the keep-alive path, exactly like Claude's. Shell stays gate-free under full access
  (codex only asks for exec approval when the filesystem sandbox is restricted). The runner-side
  gate at the `agenta-tools` pause seam remains as second-line enforcement: an allowed gate records
  an execution grant the seam consumes, so one approval prompts once and an ungranted call fails
  closed. Authors can override the mode with the typed `harnessMode` wire field. **Managed auth is file-free** (D-002
  final ruling): the adapter renders a custom `model_providers` block with `env_key =
  "OPENAI_API_KEY"` into `config.toml`, and codex reads the key from the daemon env (delivered via
  `secrets`) at request time; no credential file is written. Local subscription instead symlinks
  `<cwd>/.codex/auth.json` to the operator's mounted OAuth login. `CODEX_HOME` is the durable
  `<cwd>/.codex` on both local and Daytona (native rollouts persist, so native resume survives a
  sandbox replacement); Codex SQLite state is redirected off that home via `CODEX_SQLITE_HOME`
  (a geesefs constraint).

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

- `sdks/python/agenta/sdk/agents/adapters/harnesses.py`: the four adapters.
- `sdks/python/agenta/sdk/agents/dtos.py`: the `PiAgentConfig`/`ClaudeAgentConfig`/
  `AgentaAgentConfig` wire emitters.
- `sdks/python/agenta/sdk/agents/pi_builtins.py`: `PI_BUILTIN_TOOL_NAMES`, the names
  `PiAgentTemplate.wire_tools` sends on the deprecated `tools` field for older runners.

## Watch for when changing

- **Tool delivery per harness.** Native versus MCP is the load-bearing difference. Pi takes
  tools natively; everyone else gets them over the MCP bridge.
- **Prompt override behavior.** Pi replaces or appends; Claude reads options; Agenta composes.
- **Forced Agenta behavior.** Instruction composition and the forced skills are deliberate.
- **The deprecated `tools` wire field.** `PiAgentTemplate.wire_tools` fills it with every built-in
  name so a runner from before the always-active rework activates the same set. Emitting `[]`
  there would leave such a runner with no built-ins at all (issue #5590).
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
