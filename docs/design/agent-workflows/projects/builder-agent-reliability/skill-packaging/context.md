# Context: packaging the "build agents with Agenta" skills

## Why this exists

We want a user's own coding agent (Claude Code, Codex, Cursor) to build Agenta agents through
the Agenta API. The goal a user should feel is simple: "install Agenta's skills, then start
building Agenta agents from my terminal." This project decides how Agenta ships those skills
with the least friction for the user and the least maintenance for Agenta.

The skill content already exists and is proven. The open work was the distribution mechanism
and the on-disk layout, not the prose. Both are now settled in `plan.md`.

## Background: the seed

The content is the lab kit at `agent-creation-lab/kit/` (a working folder kept outside the
`agenta` repo on purpose). It has two parts:

- `BUILD-AGENT.md` (~12 KB): the operator playbook. It gives an agent the shape of every
  Agenta agent config, a decision table for what a request needs, the ordered build loop
  (write config, create, test, schedule, report), how to write instructions for multi-tool
  and scheduled agents, and the hard rules that prevent the usual failures.
- `kit/scripts/` (12 shell scripts): thin wrappers over real Agenta API endpoints, so the
  agent never handles the API key or hand-rolls a request body (`build.sh`, `create-agent.sh`,
  `test-agent.sh`, `discover-tools.sh`, `discover-triggers.sh`, `list-connections.sh`,
  `create-schedule.sh`, `triggers.sh`, `check-tools.sh`, `archive-agent.sh`,
  `annotate-trace.sh`, and the shared `lib.sh`).

This kit is proven. The overnight validation runs collapsed a case that once took a builder 62
tool calls and ten minutes down to one API call and 50 seconds for a fresh Sonnet subagent
(see the project `status.md` and the lab `report.md`). That is the content we put in front of
users.

## Goals

- A user installs the skills with one command in their coding agent, then builds Agenta
  agents from their terminal.
- Reach Claude Code, Codex, and Cursor from day one.
- Zero installer code, no npm publish, and no CI for Agenta to maintain.
- Keep each skill small enough to hold an agent's attention, with deeper detail available on
  demand.
- One source of truth. No file duplicated across install channels.

## Non-goals

- **Not the in-product platform build kit.** `sdks/python/agenta/sdk/agents/adapters/
  agenta_builtins.py` holds skills that run inside Agenta's own agent runtime and call
  platform tools as native tool calls. Those live inside the product. The skills here run in
  the user's terminal and call the Agenta HTTP API through shell scripts. The procedures
  overlap; the runtimes and tool bindings do not.
- **Not the repo's own dev skills.** `.agents/skills/` (write-docs, plan-feature, and so on)
  help someone work on the Agenta codebase. Those are internal. These are a public developer
  artifact.
- **Not a new API surface.** This project distributes existing content over existing
  endpoints. It defines no new endpoints and changes no runtime behavior.

## Where this sits in the larger project

This is one piece of `builder-agent-reliability`. That parent project is about making the
build-an-agent path cheap and reliable. Reunifying the four in-product build-kit skills into
one ordered playbook is what made lab cases cheap, and this project carries that same
single-playbook shape into the public, coding-agent artifact.
