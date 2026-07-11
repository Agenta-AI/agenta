# Sandbox network paths

This workspace answers a narrower question than its first draft:

> Which agent features actually need a Daytona sandbox to open a new network path into
> Agenta infrastructure, and which transport should serve each one?

## Recommendation

Do not build NetBird as a general sandbox-to-runner transport.

The original proposal treated every reverse application message as a missing reverse
network connection. That premise was wrong. The runner already connects to sandbox-agent
with HTTP POST plus a persistent server-sent events (SSE) GET. Notifications and
server-initiated ACP requests share that SSE stream. PR #5218 found that Pi permissions
failed because the old `pi-acp` adapter never emitted `session/request_permission`, not
because Daytona could not carry it.

After separating the flows, one current capability needs direct sandbox-initiated access
to Agenta-side infrastructure:

- geesefs inside Daytona must reach the configured S3-compatible mount store when that
  endpoint is private.

A second possible future capability has the same network direction:

- Claude on Daytona could call Agenta gateway tools through a separately exposed,
  authenticated HTTP MCP endpoint. That capability is rejected today and is not part of
  this project.

Keep the current ngrok path while we make mount endpoint resolution generic and test any
Cloudflare Quick Tunnel replacement against the real S3 workload. Retain NetBird only as a
conditional private-store option if public endpoints or tunnels prove unacceptable.

## Current transport map

| Capability | Current path | Needs NetBird? |
| --- | --- | --- |
| Pi builtin permissions | Pi dialog to `pi-acp`, then ACP request over existing POST and SSE | No |
| Claude native permissions | Native ACP permission request over existing POST and SSE | No |
| Pi custom and gateway tools | Extension file request; runner polls the sandbox filesystem and executes with runner credentials | No |
| User HTTP MCP on Claude | Sandbox connects directly to the user's remote HTTPS URL | No |
| User MCP on Pi | Rejected before the run | No |
| User stdio MCP | Rejected for every harness | No |
| Claude Agenta gateway tools on Daytona | Rejected because runner-loopback MCP is not reachable from sandbox loopback | Maybe later, but NetBird alone is insufficient |
| Durable mount with public S3 endpoint | geesefs connects directly to that endpoint | No |
| Durable mount with private S3 endpoint | geesefs uses the discovered ngrok endpoint today | This is the only current candidate |
| Telemetry | Runner reconstructs and exports spans from ACP events | No |

## Documents

- [Context](context.md): why the first framing changed and what remains in scope.
- [Research](research.md): code paths, authentication, limits, topology, and security.
- [Plan](plan.md): near-term mount work and the decision gate for any overlay.
- [Recommendation](recommendation.md): the decision and alternatives in one place.
- [Status](status.md): current state, answered review threads, and remaining experiments.

## Terms

- **ACP**: Agent Client Protocol. The runner and harness exchange JSON-RPC messages through
  sandbox-agent.
- **SSE**: Server-sent events. The daemon-to-runner half of the ACP HTTP transport.
- **Public endpoint**: reachable from Daytona over the internet. It does not mean
  anonymously readable.
- **Private endpoint**: reachable only inside the deployment network, such as Docker DNS or
  a Kubernetes ClusterIP.
- **Overlay**: a private network layered over existing networks. NetBird builds one with
  WireGuard.
- **Runner-loopback MCP**: Agenta's internal HTTP MCP server bound to the runner's
  `127.0.0.1`. This is separate from user-configured remote HTTP MCP.
