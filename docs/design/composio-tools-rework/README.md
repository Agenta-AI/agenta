# Composio tools rework

This folder plans a redesign of how Agenta agents use third-party tools
(Slack, GitHub, and so on) through Composio. Today each tool action is a
separate entry in the agent's saved config, resolved live at every run. That
design causes a cluster of bugs and does not scale. We move to referencing the
integration once and letting a Composio session expose the tools over MCP.

## Read in this order

1. **context.md** — why this work exists, the bugs it fixes, goals and non-goals.
2. **research.md** — how the system works today, in the code, with file
   references, plus what Composio and the industry do. Includes the live spike
   results.
3. **design.md** — the proposed architecture, the main design choice and its
   recommendation, and the API changes.
4. **plan.md** — the phases to build it, in order.
5. **status.md** — current state, decisions taken, and open questions. This is
   the source of truth for progress.

The spike results that back these docs (the live tests against Composio) are
summarized in research.md section 3.

## Glossary

- **Harness**: the agent runtime the model runs inside (Claude Code, Codex, or
  Pi). It calls tools and talks to the model.
- **Runner**: our service (`services/runner/`) that starts a sandbox, sets up
  the harness, and delivers tools to it.
- **Sandbox**: the isolated environment the harness runs in, local or on Daytona.
- **Agenta API**: the backend (`api/oss/`) that holds config and secrets and
  makes the calls to Composio.
- **Gateway tool**: our name for a third-party tool routed through a provider
  like Composio.
- **Composio session**: a server-side object at Composio (their "Tool Router")
  that holds a set of tools for one user and exposes them over an MCP endpoint.
- **Meta-tool**: one of the six tools a Composio session exposes (search,
  get-schemas, multi-execute, manage-connections, workbench, bash). The model
  uses these instead of seeing every action's schema.
- **Warm session / warm sandbox**: a parked sandbox the runner reuses between
  turns to avoid a slow cold start. A fingerprint over the config decides reuse.
