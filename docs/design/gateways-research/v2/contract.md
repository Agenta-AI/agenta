# Gateways: the ports

The two ports and what crosses them. Channels needed a wire contract because third parties
would implement adapters out of process; here the reason is different — **both ports have
externally-fixed shapes we do not control**, so the contract is mostly about what we add
rather than what we invent.

**Status: skeleton.**

## North port — what callers speak

Two surfaces, one authentication story.

### Authentication

Every caller presents a credential we mint plus a gateway URL. The caller never holds an
upstream credential and never changes shape when an upstream switches auth scheme.

*To establish:* the token's format, lifetime, scope, and what it authorizes beyond identity.
It must be worthless outside our gateway — that property is the point.

### Model surface

An OpenAI-compatible surface, because every harness and the routing library already speak it.

*To establish:* which endpoints, how a policy denial is expressed within a fixed error shape,
and how a harness that authenticates with its own subscription login is handled given it
injects no credential today.

### Tool surface

MCP over Streamable HTTP, targeting the stateless revision. Routing reads the required method
and target headers rather than the body.

*To establish:* the endpoint shape — one merged endpoint with namespaced tools or one per
server — which `mcp.md` carries as open, and how list caching interacts with per-caller tool
allowlists given list results now carry a shared-intermediary scope flag.

### What the wire looks like from the runner

Nothing new. The runner contract already expresses a gateway route on both consumers, and its
commentary anticipates a gateway MCP server as an HTTP server whose URL happens to be ours.

**Adoption is a resolver-side change for that caller** — the contract, the golden fixtures
that pin it on both sides, and the harnesses are untouched. Expect the per-server credential
arrays and the model credential array to collapse to a single gateway token.

## South port — what the gateway speaks to adapters

An adapter turns a resolved route plus a resolved credential into an upstream call. The core
never imports one; wiring happens at the entrypoint, per the repo's layering rule.

*To establish:* the interface itself. It must admit at minimum a model provider by deployment
kind, and an MCP server by auth mode, without either shape leaking into the core.

The existing family already has this pattern — ports, a registry keyed by provider, and
per-provider adapters — so the precedent is in-tree rather than invented.

## What is deliberately not a contract

- **The adapters' own protocols.** Provider APIs and the MCP wire are someone else's contract;
  we conform, we do not define. That is why `mcp.md` and `models.md` exist as quarantine.
- **An out-of-process adapter contract.** Channels needed one because third parties would
  implement bridges. No equivalent need has been established here, and inventing one would
  add a compatibility surface with no consumer. Revisit only if a real case appears.

## Open

- Whether the two north surfaces share a router layer or are independent.
- Whether the south port is one interface with two shapes or two interfaces sharing a
  credential-resolution helper.
- Versioning. The MCP surface is pinned to a protocol revision that moves; the model surface
  is pinned to a de facto standard that also moves. Neither versioning story is designed.
