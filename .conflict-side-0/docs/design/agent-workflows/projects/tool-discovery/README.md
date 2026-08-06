# Tool discovery: `find_capabilities`

Planning workspace for the agent-facing tool that turns a natural-language use case into a
wired set of Agenta tools plus a connection plan, in one call. It wraps Composio's
`COMPOSIO_SEARCH_TOOLS` meta-tool and translates the result into Agenta concepts so a builder
agent never has to learn Composio.

This is the deep implementation of the `search_tools` stub in
[`../agent-creation-skills/custom-tools-design.md`](../agent-creation-skills/custom-tools-design.md)
(PR #4863).

## Files

- [`context.md`](context.md) — why this exists, the discovery tax, goals and non-goals.
- [`research.md`](research.md) — verified facts: the Composio endpoint contract, the
  `user_id == project_id` mapping, the response shape, caveats. All run live on 2026-06-27.
- [`design.md`](design.md) — the core analysis the brief asked for: which fields are useful,
  to whom (the setup agent vs the created agent), how each maps to an Agenta concept, and the
  `find_capabilities` request/response contract.
- [`use-case-walkthrough.md`](use-case-walkthrough.md) — the Slack -> GitHub support bot from
  first principles: the original request, how a naive agent solved it (~20 calls), and what it
  looks like with `find_capabilities`, with real example outputs.
- [`plan.md`](plan.md) — phased implementation plan.
- [`status.md`](status.md) — current state, settled decisions (D1-D6), source of truth.
- [`skills/discover-and-wire-tools/SKILL.md`](skills/discover-and-wire-tools/SKILL.md) — the
  setup-agent skill that teaches the discover -> resolve-connections -> create -> test loop.

## One-line summary

A naive agent needs ~20 sequential, slug-guessing API calls to wire one multi-step agent.
`COMPOSIO_SEARCH_TOOLS` returns the tools, schemas, an execution plan, and per-project
connection state in a single call. `find_capabilities` is the thin, Agenta-native wrapper.
