# Agent workflows

This folder documents a proof of concept: running a coding agent as an Agenta workflow.

Agenta runs prompt workflows today (completion, chat, the LLM judge). Each calls a model
once and returns one answer. An agent is different. It runs a loop, calls tools across many
turns, and returns a final answer. This PoC adds the agent as a new workflow type behind the
same `/invoke` contract, traced into the same spans, configured from the same playground.

It proves one specific claim: that the **agent** and the **place it runs** are both config,
not code. You change a dropdown to swap Pi for Claude Code, or local for a Daytona cloud
sandbox, and nothing above the seam changes.

## Read in this order

1. **[Architecture](architecture.md)**. How a request flows from the playground to the model
   and back: the relay of programs, the two containers, and the vocabulary. Start here.
2. **[Ports and adapters](ports-and-adapters.md)**. The ports that keep the relay swappable:
   the backend, environment, and harness layers, where they live in the SDK, the wire
   contract, and how the service picks a backend.
3. **[Sessions](sessions.md)**. How a multi-turn conversation holds together today (cold
   replay), and the two paths open to us tomorrow.
4. **[The Pi adapter](adapters/pi.md)**. The default harness, which traces itself and takes
   tools natively through a Pi extension.
5. **[The Claude Code adapter](adapters/claude-code.md)**. The second harness, which proves
   the swap and is the template for any MCP-capable agent.
6. **[The Agenta harness](adapters/agenta.md)**. Pi with an opinion: forced skills, forced
   tools, and a base AGENTS.md preamble the author's instructions are appended to.

## What this PoC includes and defers

It includes the agent workflow behind `/invoke`, two harnesses (Pi and Claude Code), two
sandboxes (local and Daytona), backend-resolved tools that keep credentials server-side, and
tracing that nests the agent's run under the caller's span.

It defers the things a production rollout will need: a warm daemon and server-owned session
storage (see [Sessions](sessions.md)), live streaming to the client over the HTTP edge, the
multi-tenant filesystem jail for a shared daemon, and registering the agent as a first-class
backend workflow type with its own builtin URI. Each is called out where it belongs.

The first two of those, streaming and server-owned sessions, have a proposed design:
[Streaming and sessions](streaming-and-sessions.md) for the rationale and trade-offs, and
the [Agent protocol RFC](agent-protocol-rfc.md) for the normative spec of the endpoints and
the wire format. They add a new `POST /messages` endpoint (Vercel-AI-format SSE stream, an
optional `session_id`, and `UIMessage` inputs) plus a `load-session` endpoint, sitting next
to the existing `/invoke`, which is unchanged.

## The `scratch/` folder

`scratch/` holds the raw working material from the build: the original work-package folders
(WP-1 through WP-8), the port redesign notes, the research write-ups, and the proof-of-concept
spikes. The pages above supersede it. It stays for history and for the running POC code, and
it is not meant to be read as the design.
