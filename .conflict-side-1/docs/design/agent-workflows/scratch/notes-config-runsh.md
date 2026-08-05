# Scratch notes: agent configuration and run.sh

Working notes from documenting agent configuration and run.sh on 2026-06-23. Open questions,
things I could not verify, and the search for the "morning research."

## The morning research on run.sh: NOT FOUND

I could not find the lost run.sh research from "this morning." Here is what I checked and
ruled out:

- Searched all scratchpad dirs under `/tmp/claude-1000/`. Only reorg artifacts there
  (`reorg_paths.txt`, `reorg-pr-body.md`), nothing about run.sh.
- Searched `~/.claude/` and `~/.codex/memories/`. Nothing run.sh specific.
- Searched the agent-workflows docs tree for `run.sh`. Only incidental hits in archive WP
  docs (for example `archive/wp-2-agent-service/implementation-plan.md:230` mentions
  `./hosting/docker-compose/run.sh --oss --dev --build`). No dedicated run.sh research doc.
- Checked the worktree `.claude/worktrees/agent-a438aa3a2fe3880c0/`. Its `run.sh` is
  byte-identical to main. It does have edits to `hosting/AGENTS.md`, `hosting/CLAUDE.md`, and
  `docs/packs/hosting.md`, but those are about run.sh usage, not a research doc, and they
  match what is already on the main checkout.
- `git log` shows no recent commit titled like run.sh research.

Conclusion: if the morning research exists, it is in a session transcript or an
unsaved buffer, not on disk in this repo or the scratchpads I can read. I wrote
`running-the-agent.md` from the actual scripts instead. If the research turns up, fold it in
and reconcile against that doc.

## The run-sh skill is stale

`.claude/skills/run-sh/SKILL.md` documents an older flag set. It mentions `--stage`, `--gh`
as a stage alias, `--ssl`, and `--web-domain`. The current `hosting/docker-compose/run.sh`
uses `--image gh|dev`, `--local`, `--down`, `--web-mode`, `--web-url`, and derives the stage
internally. The skill's "Defaults" and "Options" sections do not match the script. I noted
this in `running-the-agent.md` and pointed readers at the script and `docs/packs/hosting.md`.

Open question: should someone update the run-sh skill to match the current script? Out of
scope for this task (skill files are not mine to edit here), but worth a follow-up.

## There is no agent-specific run.sh

Confirmed. The only `run.sh` scripts in the repo are
`hosting/docker-compose/run.sh` and `hosting/kubernetes/run.sh` (plus the worktree copies).
The agent runs as the `sandbox-agent` compose service, started by the docker-compose run.sh
with everything else. The Node runner's own entrypoints are `pnpm run serve` and
`pnpm run run:cli`, not a shell script.

## Config: things I am confident about

- Three distinct `AgentConfig`-named objects. Schema (`AgentConfigSchema`, types.py:1065),
  neutral runtime (`dtos.py:308`), file-default dataclass (`config.py:30`). All verified.
- The "loose runtime" belief needs a caveat. The neutral `AgentConfig` is NOT `extra="allow"`.
  Its `model_config` is `populate_by_name=True`. The looseness is in before-validators and
  `from_params` multi-shape coercion, plus the file-default dataclass `tools: List[Any]`. I
  documented it this way. If the memory note meant "permissive about input shapes," that is
  right. If it meant "open Pydantic model," that is wrong.
- `skills` and `persona` are not author config. They are forced injections of the Agenta
  harness only. No schema field, no neutral-config field, no playground control.
- `permission_policy` is only read by the Claude harness. Decorative for pi and agenta.

## Config: open questions and unverified items

- I relied on a subagent for the exact FE line numbers in `AgentConfigControl.tsx`,
  `SchemaPropertyRenderer.tsx`, and the molecule/store/api enrichment chain. The file paths
  are confirmed to exist, but I cite the FE line numbers as "around line N" because I did not
  open every FE file myself. If precise FE line numbers matter, re-verify
  `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/`.
- `_DEFAULT_AGENT_MODEL` is `"gpt-5.5"` per the subagent (types.py:1057). I did not open that
  exact line. Low risk, but flag it.
- The `harness_options` escape hatch (Pi `system`/`append_system`) is on the neutral config
  but absent from `AgentConfigSchema`. So the playground cannot set it through the standard
  form. I documented this as a quirk. Worth confirming whether any UI path sets it at all, or
  whether it is API-only today.
- `AGENTA_AGENT_ENABLE_MCP` defaults to `false`. So MCP servers in the config are accepted by
  the schema and form but not resolved unless the flag is on. This is a wired-but-gated case.
  I mentioned it in both docs. Confirm the exact gate location in
  `services/oss/src/agent/tools/` if precise behavior matters.

## Cross-references the new docs assume

- `agent-template.md` already documents the request surface fields and the missing-work list.
  My `agent-configuration.md` complements it with the live FE-to-runtime path. No overlap
  edits needed; I left `agent-template.md` unchanged because it was already accurate.
- `tools.md`, `architecture.md`, `ports-and-adapters.md`, `sessions.md` are owned by other
  agents. I only reference them, I did not edit them.
