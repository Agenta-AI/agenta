# Plan: the sandbox network story

One place for the whole runner-to-sandbox networking picture: what exists today and why each
piece exists, the near-term step (swap ngrok for a Cloudflare quick tunnel), the longer-term
step (a NetBird overlay), and an honest sequencing recommendation relative to the work in
flight. Research status: nothing here is committed work; this is the plan Mahmoud asked for
as reading material.

Terms are defined once in the [README glossary](README.md#glossary): overlay network, peer,
TUN device, userspace mode, management plane, setup key.

## The problems as they exist today

When an agent runs on Daytona, the harness process lives in a sandbox out in Daytona's
cloud, and the runner stays in our deployment. Traffic between them has exactly one direct
channel: the runner dials the sandbox through Daytona's signed preview URL. The sandbox has
no channel back to the runner. Every feature that needs the reverse direction, or needs the
sandbox to reach a runner-side service, has grown its own workaround:

1. **Mounts ride a public ngrok tunnel.** Durable sessions mount the S3 store as the
   working directory via geesefs. On Daytona, geesefs runs inside the sandbox and cannot
   reach `seaweedfs:8333` on our private docker network, so the compose stack tunnels the
   store port through ngrok and the runner discovers the public URL from ngrok's local API
   (`discoverTunnelEndpoint` in `services/runner/src/engines/sandbox_agent/mount.ts`, the
   `with-tunnel` profile). The failure mode is provisioning: ngrok needs an
   `NGROK_AUTHTOKEN`, and a deployment without one has no tunnel. F-017 documented the
   result: geesefs mounted against an unreachable endpoint and every file operation hung.
2. **Tool execution rides a polled file relay.** Custom tools execute on the runner so
   credentials never enter the sandbox. Because the sandbox cannot call the runner, the Pi
   extension writes a request file into a relay directory and the runner polls the sandbox
   filesystem for it (`services/runner/src/tools/relay.ts`). It works, at polling latency,
   and only for harnesses with an in-sandbox writer (Pi's extension).
3. **The reverse permission RPC is lost (F-018).** Pi's builtin gate asks the runner for an
   allow/deny decision through an ACP `session/request_permission` reverse request. Over
   the Daytona preview proxy that request never arrives, while one-way notifications on the
   same stream do. Every builtin tool call on Daytona therefore hung until the 300 second
   guard killed the turn. The fix in flight (`../daytona-gate-delivery/`) does two things:
   precompute allow/deny on the runner and inject the decisions into the sandbox (its
   Option C), and carry the residual ask-gates over the same polled file relay (its
   Option B narrowed).
4. **MCP delivery is swapped out on Daytona.** Claude only accepts tools over MCP, so the
   runner synthesizes an MCP server. It binds the runner's `127.0.0.1`, which inside a
   Daytona sandbox is the sandbox's own loopback, so the channel is skipped there
   (`services/runner/src/engines/sandbox_agent/mcp.ts`) and an in-sandbox shim is the
   planned replacement (`../mcp-delivery-architecture/directions.md`).

Four features, four transports, one root cause: the sandbox cannot reach the runner. Each
workaround also has its own failure mode (the zombie mount, the polling latency, the lost
RPC, the silent zero-tools run that the fail-loud gate now refuses).

## Near term: replace ngrok with a Cloudflare quick tunnel

This attacks the provisioning failure mode of problem 1 without waiting for anything else.

A Cloudflare quick tunnel (`cloudflared tunnel --url http://seaweedfs:8333`) exposes the
store on a random `*.trycloudflare.com` HTTPS URL with no account and no token
([quick tunnels docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).
The tunnel is therefore always up on every dev box and self-hosted deployment, which removes
exactly the F-017 failure mode. The trade-aways are stated plainly in
[research.md](research.md): no SLA, testing-only intent, 200 in-flight requests, one edge
connection, and an approximately 100 MB per-request body limit (**UNVERIFIED** exact number)
to check against our geesefs multipart part sizes.

The concrete change, one to two days (**UNVERIFIED**):

- `mount.ts`: `discoverTunnelEndpoint` gains a cloudflared branch that queries
  `http://cloudflared:<metrics-port>/quicktunnel`, which returns `{"hostname":"..."}`
  (verified in cloudflared source, `metrics/metrics.go`), and falls back to the existing
  ngrok discovery. Null-on-failure semantics stay as they are.
- Compose: a `cloudflared` service joins the existing `with-tunnel` profile alongside ngrok
  (official image, `tunnel --url http://seaweedfs:8333 --metrics 0.0.0.0:20241`, no env
  vars). ngrok stays available for anyone who already holds a token.
- No sandbox-side change: geesefs takes whatever endpoint URL discovery returns.

Production (Agenta Cloud) is unaffected: its store is genuinely public and uses no tunnel.
The security posture does not change relative to ngrok: the store is on a public URL in both
cases, and the guard is the signed, prefix-scoped, short-lived S3 credentials, never the
bucket master key. Only the overlay removes the public surface.

## Longer term: the NetBird overlay

The overlay puts the runner and each sandbox on one private WireGuard mesh so each can dial
the other directly. Feasibility is documented by Daytona itself: NetBird inside a sandbox is
a first-class flow with a non-interactive setup-key join, and the same page's OpenVPN flow
verifies a TUN device, so kernel mode (a real network interface, transparent routing) is the
design basis ([Daytona VPN connections](https://www.daytona.io/docs/en/vpn-connections/#netbird)).
Full analysis in [research.md](research.md); the verdict and the confirmation run in
[recommendation.md](recommendation.md).

Phases, with estimates (**all UNVERIFIED**):

1. **Confirmation run, about 1 day.** Bake the NetBird client into a test snapshot, join one
   sandbox with an ephemeral setup key, verify kernel mode and both directions, measure join
   time and latency, and test against a restricted Daytona egress policy. This can piggyback
   on any Daytona test session; it needs no code change in the product.
2. **MVP behind a flag, about 1 week.** Daytona only, default off. The runner mints a
   per-run ephemeral setup key and injects it into the sandbox env; the sandbox joins on
   boot; the geesefs mount targets the store at the runner's overlay address. NetBird cloud
   as the control plane first; the self-hosted control plane (three services: management,
   signal, relay) follows for self-hosters.
3. **ACL hardening, 1 to 2 weeks.** Default-deny policy generated per run: a sandbox reaches
   only the runner ports its run needs, never another sandbox. Key and peer revocation on
   teardown. Fail-loud when the overlay does not come up (the F-017 lesson: never a silent
   fallback that hangs). Observability and self-hosting docs.

### Which workarounds retire, in which order

1. **The store tunnel retires first** (ngrok and the cloudflared swap alike, the compose
   profile, `discoverTunnelEndpoint`, and the public-store requirement). It is the least
   entangled: one endpoint URL changes, nothing about run semantics.
2. **The MCP loopback swap retires second.** The sandbox reaches the runner's synthesized
   MCP server at its overlay address, so the Daytona skip and the planned in-sandbox shim
   become unnecessary. This also serves any future MCP-client harness (Codex) for free.
3. **The file-relay gate channel retires last, maybe never fully.** With a direct channel,
   the ACP reverse permission request can work (the F-018 project's deferred Option A), and
   the file-borne ask-gate path (its Option B) can retire. Its Option C, precomputed
   allow/deny decisions injected into the sandbox, stays regardless: skipping a round-trip
   for the allow case is worth keeping on any transport. The custom-tool execution relay
   also stays: executing tools runner-side where the credentials live is a security
   decision, not a transport workaround, though the transport under it could become an HTTP
   call over the overlay instead of file polling.

## Local mode and self-hosters

Local sandboxes run inside the runner container and share the docker network with the runner
and the store. Every feature already works there with no tunnel and no relay detour. The
overlay is therefore remote-only: it attaches to the Daytona path, where the shared network
does not exist, and the local path changes not at all. The code already branches on the
sandbox axis for mounts, MCP delivery, and asset upload; the overlay becomes the Daytona
answer inside that existing branch, not a new axis.

For self-hosters the cost profile is: local-only self-hosters see nothing new. Daytona
self-hosters get, near term, a tunnel that no longer needs a token; longer term, either a
NetBird cloud account or three additional self-hosted services. That last cost is real and
is the main reason the overlay stays behind a flag until the ACL hardening and the
self-hosting docs exist.

## Sequencing against the work in flight

- **The F-018 file-gate fix ships regardless.** It is being implemented now and is the
  near-term answer for tool gating on Daytona. None of it is wasted: Option C is permanent,
  Option B is the bridge the overlay could retire later.
- **The warm-sessions work (PR #5214) is unaffected.** Sandbox lifecycle (park, restart,
  resume) is orthogonal to which network path connects runner and sandbox. If sandboxes park
  rather than delete, the overlay's ephemeral peer cleanup (10 minutes offline) still fits,
  since a parked sandbox that resumes simply rejoins with its next run's key.
- **The Cloudflare swap can go now.** It touches one discovery function and one compose
  service, both deleted wholesale when the overlay lands.
- **The overlay confirmation run can go any time** and needs no product change; it
  piggybacks on any Daytona test session. The MVP and hardening phases are a prioritization
  decision after that, weighed against the MVP backlog.

Recommended order: Cloudflare swap now, confirmation run at the next natural Daytona test
session, then decide the overlay MVP with the confirmation data (latency, join time, egress
interaction) in hand.
