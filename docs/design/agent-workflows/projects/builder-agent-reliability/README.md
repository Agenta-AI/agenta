# Builder-agent reliability

Why a fresh `big-agents` agent, given its full playground build kit (platform tools +
authoring skills), is confused when a user actually tries to build something with it: it
doesn't reliably reach for its own tools, and it doesn't take the easy path the skills lay out.

## One-line summary

The "agent builds an app" initiative shipped (PRs #4917-4935: build-kit overlay, platform-op
catalog, four authoring skills, client-tool round-trip). A live test against one ordinary use
case — a twice-daily repo digest posted to Slack — showed the agent not using that kit well.
This project diagnoses why, starting from that one worked example, before deciding what to fix.

## Files

- `context.md` — why this exists, the worked example (the exact prompt and the intended path
  through the shipped tools/skills), what was observed, the open questions, and the background
  on what shipped and where its design docs live (an unmerged branch, `agent-design-docs`).
- `plan.md` — the optimization-loop methodology: a Claude Code subagent, working in an isolated
  lab folder against Agenta's real API (no backend code changes during the loop), attempts each
  use case; capture, independently verify, diagnose, refactor the lab, re-run, then port the
  winning configuration into real platform tools once it's found.
- `use-cases.md` — the eight agreed use cases, ordered by complexity, with what each tests and
  what it needs (connections, projects).
- `status.md` — current state.

## Status

Methodology and use-case list agreed. Blocked on environment/API-key details for use case 1. See
`status.md`.
