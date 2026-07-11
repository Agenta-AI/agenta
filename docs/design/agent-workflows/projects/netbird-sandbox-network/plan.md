# Plan

## Decision

Do not implement a general NetBird overlay now. First fix the mount endpoint boundary and
measure a Quick Tunnel against the real geesefs workload. Reopen NetBird only if the
private-store requirement survives that work and a public endpoint or tunnel is not
acceptable.

## Phase 1: make the mount boundary provider-neutral

The mount operation should receive an effective endpoint URL. It should not know how a
provider allocated that URL.

Current behavior is close but named around ngrok:

1. the mount-sign response supplies the configured S3 endpoint;
2. `storeReachableFromSandbox` decides whether Daytona can reach it;
3. a public endpoint goes directly to geesefs;
4. for a private endpoint, `discoverTunnelEndpoint` queries ngrok's agent API;
5. the discovered URL overrides only geesefs's endpoint.

Refactor the orchestration boundary to a function such as
`resolveSandboxStoreEndpoint`. Its sources, in priority order:

1. the configured store endpoint when it is sandbox-reachable;
2. an explicit operator-configured public endpoint;
3. a dynamic endpoint supplied by a tunnel sidecar adapter.

The mount function receives the resolved URL and temporary credentials. Provider discovery
stays outside the geesefs process builder.

Acceptance:

- public S3 skips discovery;
- private S3 uses the configured public override when present;
- dynamic provider discovery returns the same endpoint shape;
- no mount code branches on a tunnel product name.

## Phase 2: make dynamic endpoints ready or fail clearly

Starting a sidecar does not mean its public hostname is ready. A durable mount request must
not silently fall back to an ephemeral workspace.

Required behavior:

- poll discovery with bounded retry and backoff;
- distinguish "storage disabled or no durable mount requested" from provisioning failure;
- when credentials exist and the configured endpoint is private, fail the run if no
  sandbox-reachable endpoint appears before the deadline;
- probe the public route before mounting. An authenticated response or an expected S3 403
  without credentials proves that the route answers;
- retain the post-mount liveness check and dead-FUSE cleanup;
- log the provider, elapsed readiness time, and selected endpoint origin without logging
  credentials.

This removes the silent part of F-017. A Quick Tunnel can remove the ngrok token dependency,
but it does not remove startup races or every unreachable-store failure.

## Phase 3: qualify Cloudflare Quick Tunnels

Cloudflare documents Quick Tunnels as testing and development only. They have no SLA, use
one connection, do not support SSE, and cap a tunnel at 200 concurrent in-flight requests.
Requests beyond that cap receive 429 responses. See the
[Quick Tunnel limits](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

The 200 number is concurrency, not requests per minute. One S3 multipart part is one
in-flight HTTP request for the duration of that upload. Multipart creates separate
requests. GeeseFS 0.43.0 defaults can issue parallel flushes and uploads, so one developer
may fit while several busy mounts may not.

Before adding a Cloudflare sidecar:

- mount a small workspace and exercise metadata reads, ranged reads, writes, rename, and
  delete;
- upload and read back objects across the geesefs multipart size transitions;
- test a part larger than 100 MiB instead of assuming the Cloudflare Free proxied-upload
  limit applies to `trycloudflare.com`;
- run multiple concurrent mounts and record peak in-flight requests, 429s, latency, and
  throughput;
- restart cloudflared during discovery and during active I/O;
- prove bounded readiness and fail-loud behavior;
- confirm the S3 and STS endpoints behave correctly through the tunnel.

Do not replace ngrok by default until these checks pass.

For comparison, ngrok currently documents free-plan limits in requests per minute, monthly
requests, and outbound transfer, not a concurrent-request cap:
[ngrok limits](https://ngrok.com/docs/pricing-limits). The products constrain different
dimensions, so the design should not call either one universally better.

## Phase 4: decide the store connectivity product

Choose from the following using the Phase 3 data:

### A. Direct public S3 endpoint

Best when the operator already has S3, R2, MinIO, or SeaweedFS on a TLS endpoint.

- Fewest moving parts.
- No tunnel discovery.
- Publicly routable S3 and STS surface.
- Data remains protected by short-lived, prefix-scoped S3 credentials.

### B. Stable authenticated tunnel

Best when a self-hoster accepts public ingress but wants a stable hostname and provider
controls.

- Keeps the store private inside the deployment.
- Adds a tunnel account, credentials, quotas, and provider dependency.
- Needs the same readiness and fail-loud contract.

### C. Cloudflare Quick Tunnel for development

Best only if Phase 3 shows the geesefs workload fits.

- No account or token.
- Random hostname, testing-only service, documented concurrency limit.
- Not a production or general self-hosting recommendation.

### D. NetBird private overlay

Consider only when the operator requires private connectivity and rejects public ingress.

- Adds a client in every sandbox, a runner-side peer or router, control-plane operations,
  ACL lifecycle, setup-key lifecycle, and Daytona tier requirements.
- Does not expose SeaweedFS or loopback MCP by itself.

Record the choice in [recommendation.md](recommendation.md) before implementation.

## Phase 5: NetBird decision gate

Open a NetBird implementation project only if all are true:

1. a concrete private resource must be reached from Daytona;
2. a direct public endpoint and an authenticated tunnel are unacceptable;
3. Daytona's required VPN tier is available for the intended users;
4. measured join time and reconnect behavior fit the run lifecycle;
5. the topology and default-deny policy below are approved;
6. the team accepts the self-hosted control-plane or NetBird Cloud dependency.

### Required topology

A peer in the runner container sees only that container's network namespace.

For SeaweedFS, choose one explicit exposure:

- a NetBird peer beside SeaweedFS;
- a routing peer with IP forwarding into a narrowly scoped network resource; or
- a runner-side TCP proxy bound only to the runner's overlay address and forwarding to
  `seaweedfs:8333`.

For internal gateway-tool MCP:

- bind or proxy the server on the runner's overlay address instead of `127.0.0.1`;
- add a per-run bearer credential;
- advertise the overlay URL only to the paired Daytona Claude session;
- keep the feature rejected until the listener, authentication, and policy are ready.

### Security baseline before the first sandbox joins

NetBird creates an all-to-all default policy for a new account. Remove it before enrollment.
The MVP must include:

- one per-run sandbox group;
- one-way TCP policy from that group to the paired runner service and exact port;
- no sandbox-to-sandbox policy;
- no `ALL` protocol rule;
- no broad Docker subnet route;
- policy creation before peer enrollment;
- explicit deletion of the peer, policies, group, proxies, and setup key at teardown.

NetBird is stateful, so return traffic does not require a reverse allow rule. See
[NetBird access control](https://docs.netbird.io/manage/access-control).

### Setup-key handling

Never inject a reusable setup key into sandbox environment variables.

- mint a one-off key with usage limit 1, short expiry, ephemeral peer, and only the
  run-scoped auto-group;
- write it through the Daytona control plane to a temporary 0600 file outside the
  workspace;
- run `netbird up --setup-key-file <path>`;
- delete the file immediately;
- verify the peer, then delete or revoke the setup key through the management API;
- delete the enrolled peer explicitly at teardown because revoking the setup key does not
  disconnect it.

Any process with full sandbox control may still capture enrollment material while joining.
The one-off key and immediate revocation limit reuse; they do not make the key invisible.
See [NetBird setup keys](https://docs.netbird.io/manage/peers/register-machines-using-setup-keys)
and the [CLI reference](https://docs.netbird.io/get-started/cli).

## Acceptance criteria

- The documentation does not claim that permissions need a new reverse network route.
- The MCP matrix distinguishes user HTTP MCP from internal gateway-tool MCP.
- A durable private-store request never silently runs without its mount.
- A Quick Tunnel recommendation is contingent on multipart and concurrency results.
- Any future NetBird MVP includes service exposure, authentication, default-deny ACLs, and
  one-off setup-key handling from its first sandbox.
