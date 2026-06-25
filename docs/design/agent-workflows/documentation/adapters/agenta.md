# The Agenta harness

`AgentaHarness` is Pi with an opinion. It runs on the same engine as the [Pi
adapter](pi.md) and produces a Pi-shaped config, so it inherits everything Pi does (native
tools, the system-prompt layers, tracing). What it adds is a fixed set of Agenta-shipped
extras that the agent author cannot turn off:

- **Forced tools**: always unioned into the agent's resolved tools. At minimum `read`
  (Pi only renders the skills section when `read` is enabled) and `bash` (so skills can run
  their helper scripts).
- **Forced skills**: Agenta-shipped Pi skills loaded on every run.
- **A base AGENTS.md preamble**: the author's `instructions` are appended after it.
- **A base persona**: forced onto Pi's `append_system`, with any author-supplied
  `append_system` appended after it.

Read the [architecture](../architecture.md), [ports and adapters](../ports-and-adapters.md),
and [Pi adapter](pi.md) pages first. This page assumes them.

## Where the forced bits live

The forced *policy* lives in the SDK harness layer, in one editable module:
`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` (`AGENTA_PREAMBLE`,
`AGENTA_FORCED_APPEND_SYSTEM`, `AGENTA_FORCED_TOOLS`, `AGENTA_FORCED_SKILLS`). `AgentaHarness`
(`adapters/harnesses.py`) reads them in `_to_harness_config` and layers them onto the neutral
`SessionConfig`, exactly where `PiHarness` and `ClaudeHarness` do their own translation.

The forced skill *files* live with the runner that runs Pi, under
`services/agent/skills/<name>/` (each a directory with a `SKILL.md`). Skills are real files on
disk because they reference relative scripts and assets, so they cannot ride the wire as
text. The contract between the two halves is the skill **name**: `AGENTA_FORCED_SKILLS` lists
names, and each must match a committed directory under the runner's skills root.

Because the Agenta harness IS Pi, its tools are delivered the Pi-native way (through the
extension on the ACP path), never over MCP. The forced `read` and `bash` tools are Pi
built-ins, so they ride the wire as built-in names, not resolved specs.

## How a skill reaches the model

The Agenta harness runs over the sandbox-agent ACP path, the one engine the runner has. The
forced *skills* cannot ride the `/run` wire as text (a skill is a directory that may
reference relative scripts and assets), so the wire carries only the skill **names** and the
runner lays the bundled directories into the Pi agent dir.

1. `AgentaHarness._to_harness_config` puts the forced skill names on the `skills` field of
   the `/run` request (`AgentaAgentConfig.wire_tools`).
2. `runSandboxAgent` resolves each name against its bundled `skills/` root
   (`engines/skills.ts`, override with `AGENTA_AGENT_SKILLS_DIR`) and writes the directories
   into the Pi agent dir's `skills/` (user scope).
3. Pi loads them, and because the forced `read` tool is enabled, surfaces them in the system
   prompt. The model reads a skill's `SKILL.md` on demand (progressive disclosure).

## Two prompt layers, kept distinct

This follows Pi's own split (see `PiAgentConfig`): the **persona** ("who the agent is")
belongs in `append_system`, and **project conventions** belong in `AGENTS.md`. So the Agenta
persona is a forced `append_system`, while the Agenta base preamble plus the author's
instructions are the `AGENTS.md`. An author's own `system` / `append_system` (via
`AgentConfig.harness_options["pi_core"]`) still apply, layered after the forced persona.

## Selecting it

`pi_agenta` is a harness option alongside `pi_core` and `claude` (the playground dropdown, the
`harness` field). The deployed service path routes it through `SandboxAgentBackend`, which
drives Pi over ACP and layers the Agenta persona and tools on top.

## On the sandbox-agent (ACP) path

`SandboxAgentBackend` lists `HarnessType.AGENTA` (`pi_agenta`) as supported, so it runs over
ACP through the sandbox-agent daemon. This is what lets it use the Daytona sandbox. The Agenta
harness is Pi with an opinion, and the sandbox-agent daemon only knows real agents (`pi`,
`claude`, …), so the runner maps `pi_agenta` onto the `pi` ACP agent (`acpAgent` in
`engines/sandbox_agent/run-plan.ts`, where `pi_core` and `pi_agenta` both resolve to `pi`) and
treats it as Pi for capabilities, model resolution, and tracing.

The agent dir matters. Pi auto-discovers and enables user-scope skills
(`<agentDir>/skills/`) on every run, whereas project skills (`<cwd>/.pi/skills/`) are
trust-gated and would not load in this headless run. Because the forced skills are user-scope,
writing them into the *shared* agent dir would leak them into later plain `pi_core` runs on
the same sidecar (and could pollute a developer's real `~/.pi/agent`). So each path gives the
run its own agent dir: on **Daytona** the sandbox is already fresh per run
(`uploadSkillsToSandbox`); on **local** an Agenta run gets a throwaway per-run agent dir
seeded from the login (`auth.json` / `settings.json`), with the extension and skills installed
into it and the daemon pointed at it via `PI_CODING_AGENT_DIR` (`prepareLocalAgentDir`),
removed after the run. A plain `pi_core` run is unchanged (it installs only the extension into
the shared agent dir).

The base AGENTS.md preamble rides the wire as `agentsMd` (written into the session `cwd`), and
the forced `read` / `bash` tools are Pi defaults under pi-acp. The persona rides the wire as
`appendSystemPrompt` and the engine writes it into the per-run Pi agent dir as
`APPEND_SYSTEM.md` (`engines/sandbox_agent/pi-assets.ts`), so Pi loads it on the run. Daytona
skill uploads are UTF-8 text only (`writeFsFile` takes a string body); binary skill assets are
a follow-up.
