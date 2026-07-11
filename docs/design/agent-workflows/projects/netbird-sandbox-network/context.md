# Context

## Why this work started

Remote Daytona sandboxes do not share the runner's Docker or Kubernetes network. A private
store address such as `http://seaweedfs:8333` therefore cannot be used by geesefs inside
the sandbox. The current compose setup exposes the S3 gateway through ngrok and the runner
discovers its public URL.

The first draft generalized that fact into "the sandbox cannot talk back to the runner" and
attributed permissions, Pi tools, MCP, and mounts to one missing connection. Review of the
actual code and PR #5218 disproved that model.

## Corrected model

Network direction and application direction are different.

The runner initiates the HTTP connections to sandbox-agent, but ACP is application
bidirectional:

1. the runner sends JSON-RPC envelopes with POST;
2. it keeps one SSE GET open;
3. the daemon sends notifications and reverse requests on that stream;
4. the runner answers a reverse request with another POST.

Pi's permission request was absent because `pi-acp` 0.0.23 ignored the extension UI event.
Adapter parity restores the existing route.

Other capabilities use deliberate, separate transports:

- Pi custom tools stay runner-side so credentials do not enter the sandbox. The extension
  writes request files and the runner polls them through Daytona APIs.
- User HTTP MCP is a sandbox-to-user-server connection for capable non-Pi harnesses.
- Internal gateway-tool MCP is a runner-loopback service. Daytona Claude cannot use it
  until Agenta designs an authenticated remote endpoint.
- geesefs must speak S3 directly. ACP is not an S3 or filesystem tunnel.

## Goals

- Document each traffic flow and its actual direction.
- Keep public reachability separate from storage authentication.
- Make mount orchestration consume one effective sandbox-reachable store endpoint.
- Fail clearly when a durable mount is requested but no endpoint becomes reachable.
- Test Cloudflare Quick Tunnels before recommending them as the self-hosted default.
- Define the evidence and security baseline required before any NetBird work begins.

## Non-goals

- Replacing ACP for permission delivery.
- Replacing the Pi file relay.
- Enabling Pi user MCP or user stdio MCP.
- Shipping Claude gateway tools on Daytona.
- Building a NetBird control plane or client in this change.
- Claiming that production, Agenta Cloud, or any deployment type always has a public store.

## Decision boundary

The deployment topology decides whether a tunnel or overlay is needed:

- A publicly reachable S3-compatible endpoint needs no extra route.
- A private bundled SeaweedFS endpoint needs a tunnel, overlay, or equivalent route.
- Authentication remains S3 credential based in either topology.
