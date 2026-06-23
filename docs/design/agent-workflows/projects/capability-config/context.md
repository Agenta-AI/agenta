# Context

## Why this work exists

Every agent run has to be governed. The author needs to say what the agent may touch, and the
system has to enforce that across two harnesses (`pi` and `claude`) and three backends
(sandbox-agent local, sandbox-agent on Daytona, and a future in-process local SDK).

Today almost none of this is wired:

- The runner drops Pi's `builtin_names`, so even Pi's own tool selection has no effect on the
  sandbox-agent path.
- The runner never restricts Claude. It creates the session with only `cwd` and `mcpServers`,
  so "Claude without web" or "Claude read-only" is not expressible.
- The runner never sets a network boundary, so a Daytona run has full egress by default.
- `permission_policy` is the only live control, and it is coarse (auto or deny, all tools at
  once) and effective on Claude only.
- The playground renders every config field unconditionally, with no per-harness gating and no
  way to set capability or per-tool approval.

So a request as simple as "give this agent web access but not write access" cannot be
expressed, on either harness, from the playground or the SDK. This project makes capability and
permission a real, configurable, end-to-end feature.

## Goals

1. A three-layer configuration model the author can set: harness configuration, sandbox
   permission, and per-tool permission. Each layer has one job and one enforcement point.
2. End to end. The playground frontend is in scope: the config form gains the new sections, and
   the agent chat gains a tool-approval surface for the "ask" disposition.
3. Honest enforcement. The sandbox layer is authoritative for the network and the filesystem. A
   run fails loud when a backend cannot deliver a requested guarantee, rather than pretending.
4. Sensible defaults. Read-only tools default to always-allow and mutating tools to ask, using
   Composio's read/write metadata, so the author does not label every tool by hand.

## Non-goals (for now)

- **Pi MCP.** Deferred. When built it follows the same permission pattern as Claude
  (settings-style `mcp__<server>` rules). Tracked in `../harness-capabilities/`.
- **A real filesystem jail.** No backend confines the filesystem today; the local cwd is a temp
  dir, not a jail. Layer 2 ships network first; filesystem stays tool-plane only until a backend
  can enforce it.
- **Durable / unattended HITL approval.** The "ask" disposition this project ships asks the user
  in the open chat. The global, durable approval channel that survives a closed tab or a
  scheduled run is Flow 7 in `../../scratch/flows-and-capabilities.md`, a later milestone.
- **A sandbox boundary for the local backend.** The local sidecar is the host; it cannot enforce
  Layer 2. That is by design, and the fail-loud rule covers it.

## Background

The runtime splits work across a Python agent service (`services/oss/src/agent/`, decides what
to run) and a TypeScript runner (`services/agent/`, runs it). The runner drives the harness over
an ACP bridge, `sandbox-agent`, on a chosen backend. The SDK (`sdks/python/agenta/sdk/agents/`)
owns the neutral config, the ports, and the per-harness adapters.

Three earlier scratch documents set up this project, and their facts are folded into
`research.md`:

- `../../scratch/capability-map.md` — the current-state web/exec/read/write cut: what each
  harness can do, what is on by default, what the backend changes.
- `../../scratch/capability-architecture.md` — the design exploration this project's
  `proposal.md` cleans up.
- `../../scratch/flows-and-capabilities.md` — the user-facing flows, including Flow 7 (HITL).

## Relation to sibling projects

- `../harness-capabilities/` declares which capabilities each harness supports (the static
  capability table) and owns the deferred Pi-MCP work. This project sets the capability *values*
  the author chooses; that project declares which choices a harness can honor. They meet at the
  schema and the fail-loud check.
- `../model-config/` is the same static-then-dynamic pattern for the model axis. Layer 1's
  Claude `model` setting overlaps it.
- `../skills-config/` configures forced skills, a different axis on the same agent config.
