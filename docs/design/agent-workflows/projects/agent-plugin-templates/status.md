# Status

Source of truth for this project.

## Current state

Date: 2026-09-17

The design and implementation plan are ready for review. No runtime, API, database, frontend, or deployment behavior changes in this planning change.

## Decisions recorded

- Use the published Agent Plugins 1.0 format.
- Put Agenta-specific data under the `ai.agenta` extension.
- Keep each agent's permanent instructions in a separate `AGENTS.md` file.
- Keep temporary setup guidance in `SETUP.md` and resource `setup_notes` fields.
- Define agents once in a flat map and link them by package key.
- Allow mutual links at install time and reject synchronous runtime call cycles.
- Model optional connection needs and gateway or MCP alternatives in one connection slot.
- Extend the current trusted `SessionContext` and `turnContext` path for setup guidance.
- Install declared resources in backend code. Let the entry agent resolve conversational choices.
- Pin installed content to a package digest.

## Verified artifacts

- The example `plugin.json` and `mcp.json` validate against the published Agent Plugins 1.0 schemas.
- The example `ai.agenta/agents.json` validates against the proposed local extension schema.
- Every declared package path and cross-reference in the example resolves inside the package.
- The planning Markdown contains no em dash characters.

## Implementation order

1. Package loader and compiler.
2. Idempotent installation.
3. Setup session and scoped operations.
4. Runtime recursion protection.
5. One-package frontend adoption.
6. Repository and archive sources.

## Review focus

- Is `ai.agenta` the namespace Agenta wants to keep long term?
- Is the first release boundary correct: standard skills plus Streamable HTTP MCP, but no stdio or legacy SSE?
- Are the six installation-scoped setup operations narrow enough for the first delivery?
- Should package setup block all ordinary runs until readiness, or only show an incomplete warning? This plan recommends blocking them.

## Next action

After approval, start with the loader and compiler against the example package. Do not begin marketplace or update behavior in the first implementation slice.
