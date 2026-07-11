# Recommendation

## Decision

Do not build NetBird as the common sandbox transport, and do not replace ngrok with a
Cloudflare Quick Tunnel by default yet.

Build the smaller abstraction first: resolve one sandbox-reachable S3 endpoint, wait for it
to become ready, and fail clearly when a requested durable mount cannot be provisioned.
Then qualify Quick Tunnels against geesefs before choosing a default.

## Why

### Permissions already have a return path

ACP over sandbox-agent uses POST for runner-to-daemon messages and one SSE GET for
daemon-to-runner notifications and requests. The runner answers reverse requests with POST.
PR #5218 found the Pi permission failure before this transport: the stale adapter never
created the request. NetBird would add infrastructure without fixing that cause.

### Most other flows already use the right boundary

- Pi custom tools execute on the runner and use a runner-polled file relay.
- User HTTP MCP already connects Daytona Claude to the user's remote server.
- Pi user MCP is rejected and stdio MCP is disabled.
- Telemetry is exported by the runner from ACP events.
- Runner filesystem and process operations use Daytona or sandbox-agent APIs.

### Private mounts are the concrete exception

geesefs runs inside the sandbox and must speak S3. When the configured endpoint is public,
it connects directly. When the endpoint is private, the current stack supplies an ngrok
URL. ACP is not an S3 data-plane tunnel, so this case needs a reachable endpoint.

## Public does not mean anonymous

The tunnel exposes the SeaweedFS S3 and STS network surface. It does not grant object
access. Agenta's bundled SeaweedFS configuration requires S3 authentication, and the API
mints short-lived credentials restricted to one mount prefix. geesefs signs its requests
with those credentials.

The tunnel provider token authenticates the tunnel agent, not clients of the public URL.
The public layer still increases the reachable attack surface and denial-of-service risk.
Use TLS, keep SeaweedFS current, and retain strict S3 and STS authentication.

## Deployment topology, not environment name

Do not describe this as development versus production.

- External, publicly reachable S3: no tunnel.
- Bundled private SeaweedFS in Compose, Railway, or Kubernetes: Daytona needs another
  route.
- Authentication is S3 based in both cases.

Agenta durable mounts require an S3-compatible endpoint. SeaweedFS may support other
protocols, but the current mount implementation does not use them.

## Cloudflare versus ngrok

Cloudflare's 200 limit counts simultaneous requests. It may fit one light development
mount, but the design has no workload evidence yet. ngrok documents other free limits,
including requests per minute, monthly requests, and outbound transfer. Neither set of
limits establishes a general winner.

Quick Tunnels also use random hostnames and are documented for testing. Make them an
experiment whose rollout depends on S3 multipart, concurrency, restart, readiness, and
fail-loud checks.

## When NetBird becomes reasonable

Reconsider NetBird when an operator requires a private store route and rejects public
endpoints and tunnels. A future authenticated Claude gateway-tool endpoint may create a
second use case, but it needs a separate product decision.

Even then, joining two peers is only the first step. The design must add:

- an explicit SeaweedFS peer, route, or overlay-bound proxy;
- an overlay-bound and authenticated MCP endpoint if needed;
- default-deny, port-scoped, paired-peer ACLs before enrollment;
- one-off setup-key delivery outside environment variables;
- teardown for peers, policies, groups, listeners, and keys;
- a plan for Daytona's documented VPN tier requirement.

## Next decision

Run the Quick Tunnel qualification in [plan.md](plan.md). After that evidence exists,
choose direct public S3, a stable authenticated tunnel, a development-only Quick Tunnel, or
a private overlay for each supported deployment topology.
