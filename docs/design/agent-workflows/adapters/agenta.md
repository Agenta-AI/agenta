# The Agenta harness

`AgentaHarness` is Pi with an opinion. It runs on the same engine as the [Pi
adapter](pi.md) and produces a Pi-shaped config, so it inherits everything Pi does (native
tools, the system-prompt layers, tracing). What it adds is a fixed set of Agenta-shipped
extras that the agent author cannot turn off:

- **Forced tools** — always unioned into the agent's resolved tools. At minimum `read`
  (Pi only renders the skills section when `read` is enabled) and `bash` (so skills can run
  their helper scripts).
- **Forced skills** — Agenta-shipped Pi skills loaded on every run.
- **A base AGENTS.md preamble** — the author's `instructions` are appended after it.
- **A base persona** — forced onto Pi's `append_system`, with any author-supplied
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

## How a skill reaches the model

1. `AgentaHarness._to_harness_config` puts the forced skill names on the `skills` field of
   the `/run` request (`AgentaAgentConfig.wire_tools`).
2. The in-process Pi engine (`engines/pi.ts`) resolves each name against its bundled
   `skills/` root (override with `AGENTA_AGENT_SKILLS_DIR`) and passes the directories to Pi's
   `DefaultResourceLoader` as `additionalSkillPaths`, with `noSkills: true` so only the
   bundled skills load (the run stays hermetic, like `noContextFiles`).
3. Pi loads them, and because the forced `read` tool is enabled, surfaces them in the system
   prompt. The model reads a skill's `SKILL.md` on demand (progressive disclosure).

## Two prompt layers, kept distinct

This follows Pi's own split (see `PiAgentConfig`): the **persona** ("who the agent is")
belongs in `append_system`, and **project conventions** belong in `AGENTS.md`. So the Agenta
persona is a forced `append_system`, while the Agenta base preamble plus the author's
instructions are the `AGENTS.md`. An author's own `system` / `append_system` (via
`AgentConfig.harness_options["pi"]`) still apply, layered after the forced persona.

## Selecting it

`agenta` is a harness option alongside `pi` and `claude` (the playground dropdown, the
`harness` field). It runs on the in-process Pi backend (`InProcessPiBackend` now lists
`HarnessType.AGENTA` as supported), so `select_backend` keeps `agenta` on the local Pi path.

## Deferred

Only the in-process Pi (local) path is wired. The ACP/rivet path (and therefore the Daytona
sandbox) does not yet deliver the forced skills — it would teach `runRivet` to read the
`skills` field and lay the bundled skill directories into the sandbox via the existing
bundled-file provisioning. Until then, `agenta` with a non-local sandbox raises
`UnsupportedHarnessError` rather than silently running without its skills.
