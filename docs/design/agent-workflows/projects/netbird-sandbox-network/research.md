# Research

The idea: put the runner and its Daytona sandboxes on one shared private WireGuard mesh
(overlay) using NetBird, so the runner and a sandbox can open connections to each other in
both directions. Today there is no direct sandbox-to-runner channel, and each connectivity
need has its own workaround. This document answers the five research questions with sources,
plus a sixth section assessing Cloudflare Tunnel as a near-term ngrok replacement.

Sources are cited inline. Every number that has not been measured in our own stack is marked
**UNVERIFIED**.

## Glossary (each term defined once)

- **Overlay network.** A virtual private network laid on top of the real internet. Machines
  on it get private addresses (for example `100.x.y.z`) and reach each other by those
  addresses regardless of where they physically run. WireGuard is the encryption layer here.
- **Peer.** One machine on the overlay. The runner is a peer; each sandbox is a peer.
- **TUN device.** A virtual network interface the Linux kernel exposes at `/dev/net/tun`. A
  normal (kernel-mode) WireGuard client creates one so the whole machine can route traffic
  into the tunnel transparently. Creating it needs the `NET_ADMIN` capability.
- **Userspace mode (netstack).** WireGuard running entirely inside one process, with its own
  TCP/IP stack (gVisor netstack), no kernel TUN device, no `NET_ADMIN`. The tradeoff is that
  it is not a transparent interface: it proxies specific ports rather than routing all
  traffic.
- **Management plane.** The NetBird control service that registers peers, holds the network
  map, and distributes access policy. It is separate from the data path: traffic between
  peers does not flow through it.
- **Setup key.** A token a headless machine presents to the management plane to join the
  overlay without a human login. Can be reusable and can be ephemeral (auto-removed when the
  peer goes offline).

## Question 1: Can NetBird run inside a Daytona container sandbox?

Yes. Daytona documents VPN clients inside sandboxes as a first-class, supported flow, and
NetBird is one of the three documented clients
([Daytona VPN connections](https://www.daytona.io/docs/en/vpn-connections/#netbird)). That
page is the primary source for this question.

### What the Daytona VPN page establishes

- **NetBird join is documented, non-interactive, setup-key based.** Install with the official
  script (`curl -fsSL https://pkgs.netbird.io/install.sh | sudo sh`), then join with
  `sudo netbird up --setup-key [KEY]`, verify with `netbird status`. The page ships Python and
  TypeScript SDK examples that create a sandbox, install the client via `process.exec()` /
  `executeCommand()`, join, and verify. Note that sandboxes have `sudo`.
- **TUN devices exist in sandboxes.** The page's OpenVPN flow verifies the connection with
  `ip addr show tun0`. OpenVPN requires a kernel TUN device, so a documented-working OpenVPN
  flow means a sandbox can create TUN interfaces. That is the capability kernel-mode
  WireGuard needs.
- **Both directions are documented.** The page states the sandbox becomes part of your
  private network, "allowing you to access resources... and enabling other devices on the
  network to access the sandbox." That is exactly the bidirectional property this design
  needs: the sandbox reaches the runner, and the runner reaches the sandbox.

### What the page does not state (stay honest)

- It does not name the sandbox container's Linux capability set (`NET_ADMIN` and so on), its
  device list, or whether sandboxes run privileged. The TUN conclusion is inferred from the
  OpenVPN flow, not stated as a capability guarantee.
- It gives no security or ACL guidance: nothing about isolating VPN-joined sandboxes from
  each other or from the rest of the private network. That burden falls entirely on our
  NetBird policy design (Question 3).
- It says nothing about performance, connect time, or interaction with Daytona's own
  per-sandbox egress policy (`networkBlockAll` / `networkAllowList`, which our provider sets
  per run in `services/runner/src/engines/sandbox_agent/provider.ts`). Whether a restricted
  egress policy blocks the WireGuard UDP path is untested.

So the residual unknown is small: one live confirmation that kernel-mode NetBird comes up in
our own snapshot and passes traffic both ways, not a go/no-go on an undocumented capability.

### Background: what Daytona sandboxes are

Daytona sandboxes are Docker containers by default (a shared host kernel), with optional Kata
Containers for microVM-grade isolation. Startup is sub-90ms with the container path
([Northflank comparison](https://northflank.com/blog/daytona-vs-e2b-ai-code-execution-sandboxes)).
Consistent with the VPN page, sandboxes are capable containers: Daytona also documents
Docker-in-Docker and running Kubernetes inside a sandbox
([Daytona snapshots](https://www.daytona.io/docs/en/snapshots/)).

### Kernel mode is the design basis

Kernel-mode WireGuard creates a real TUN interface, so every process in the sandbox reaches
overlay addresses transparently through normal kernel routing: geesefs dials the store at the
runner's overlay address, a permission RPC dials the runner, no per-port plumbing. For
reference, NetBird's standard Docker image asks for the `NET_ADMIN`, `SYS_ADMIN`, and
`SYS_RESOURCE` capabilities plus `/dev/net/tun`
([NetBird Docker client](https://netbirdio-netbird-9.mintlify.app/clients/docker)); inside a
Daytona sandbox the documented flow simply installs and runs the client with sudo, and the
OpenVPN `tun0` evidence says the TUN prerequisite is met.

### Fallback only: userspace mode (netstack, no TUN)

Kept in case a live run contradicts the docs (for example on a restricted Daytona tier).
NetBird can run WireGuard entirely in userspace with gVisor netstack, no TUN device and no
capabilities, enabled with `NB_USE_NETSTACK_MODE=true`
([NetBird Docker client](https://netbirdio-netbird-9.mintlify.app/clients/docker),
[netstack explainer](https://ryan-schachte.com/blog/userspace_wireguard_tunnels/)). The costs
that make it the wrong primary design: it is not a transparent interface (its TCP/IP stack
lives inside the NetBird process); inbound works by proxying overlay traffic to local
listeners, but outbound from other sandbox processes needs NetBird's port forwarding and
`NB_ENABLE_LOCAL_FORWARDING=true` rather than dialing overlay addresses directly
([issue #4929](https://github.com/netbirdio/netbird/issues/4929)); it is slower than kernel
WireGuard; and DNS is disabled by default. Workable for our small fixed set of endpoints, but
strictly worse than the documented kernel path. Do not design against it; keep it as the
escape hatch.

### Answer

Feasible, documented by Daytona. Design against kernel mode (real TUN interface, transparent
routing). One short confirmation run replaces a full go/no-go spike: bake the client into our
snapshot, join with a setup key, verify the interface and both directions, measure latency
and connect time. Userspace mode is the fallback footnote, not the design basis.

## Question 2: Architecture

### Where the management plane lives

NetBird has four services: management (registration, network map, policy), signal (peer
discovery and connection setup, stores no data, no traffic through it), relay (a Coturn TURN
server used only when a direct peer connection cannot be established), and the client on each
peer. All of management, signal, and relay can be self-hosted or used from NetBird's cloud
([how NetBird works](https://docs.netbird.io/about-netbird/how-netbird-works)). The peer's
private key never leaves the machine, and relayed traffic stays WireGuard-encrypted end to
end.

Two options for us:

- **NetBird cloud.** Agenta Cloud points its runner and sandboxes at NetBird's managed
  control plane. No new services to run. The cost is a hard dependency on a third-party
  control plane for the sandbox data path to come up, and it does not help self-hosters who
  run Daytona.
- **Self-hosted management, signal, relay.** Three more services in the Agenta stack. This is
  the only option that lets a self-hoster on Daytona use the overlay without a NetBird
  account. The cost is three more moving parts in compose and Helm, which cuts against the
  self-hosting story the runner explainer works to keep simple (see
  `../runner-selfhosting-explainer/README.md`).

The important scoping fact: the overlay is only needed when the sandbox is remote (Daytona).
A self-hoster on the default local provider shares a docker network with the runner and needs
none of this. So the overlay components attach specifically to the Daytona path, which bounds
who pays the added complexity.

### How a sandbox joins, how the runner joins

- **Runner joins once, long-lived.** The runner container runs a NetBird client (kernel mode;
  the runner container already carries `SYS_ADMIN` and `/dev/fuse` for geesefs per the
  explainer, so granting its capabilities is in our own hands). It stays on the overlay for
  its lifetime, in a fixed group.
- **Sandbox joins per run, ephemeral.** The NetBird client is baked into the Daytona snapshot
  (the snapshot already bakes Pi and geesefs; adding one binary is in scope; the Daytona VPN
  page's install-per-run flow also works but costs seconds per run). On sandbox boot the
  runner injects a freshly minted, ephemeral, run-scoped setup key as an env var (the same
  channel that already carries provider keys and Pi config into the sandbox, see
  `daytona.ts`), and the sandbox runs `netbird up --setup-key` to join. Ephemeral peers
  auto-remove after 10 minutes of no activity, which matches sandbox teardown
  ([setup keys](https://docs.netbird.io/manage/peers/register-machines-using-setup-keys)).
  Baking a single long-lived key into the snapshot instead is rejected under Question 3: a
  shared key means any sandbox can impersonate any other.

### What each workaround becomes over the overlay

| Need | Today | Over the overlay |
|---|---|---|
| F-017 mounts (sandbox reaches the store) | geesefs in the sandbox hits the store through a public ngrok tunnel (`with-tunnel` profile, `discoverTunnelEndpoint` in `mount.ts`); requires a publicly reachable store | geesefs reaches the runner-side store over the overlay; ngrok, the `with-tunnel` profile, `discoverTunnelEndpoint`, and the `storeReachableFromSandbox` public-store rule all go away |
| F-018 reverse permission RPC (sandbox asks runner to approve a tool) | The ACP `session/request_permission` reverse request never arrives over the Daytona preview proxy; being fixed by delivering gate decisions over the polled file relay | A direct sandbox-to-runner channel exists, so the reverse RPC can travel it. This is Option A in `../daytona-gate-delivery/options.md` (make the reverse RPC work), which that project deferred because the transport was unfixable |
| MCP delivery (our tools to a Claude/Codex sandbox) | The internal tool-MCP server binds the runner's `127.0.0.1`, unreachable from the sandbox, so it is skipped on Daytona and an in-sandbox shim is planned (`mcp.ts`, `../mcp-delivery-architecture/directions.md`) | The sandbox reaches the runner's MCP server (or a future L2 gateway) at the runner's overlay address, so the loopback problem disappears and the in-sandbox shim may not be needed |

The through-line: today the runner-to-sandbox direction has one channel (the Daytona signed
preview URL) and the sandbox-to-runner direction has none (only the runner-polled file relay,
per `../mcp-delivery-architecture/directions.md`). The overlay adds the missing direction,
which is the root cause behind F-017, F-018, and the MCP loopback gap at once.

## Question 3: Security and tenancy

Sandboxes run untrusted agent code. A flat overlay where every peer can reach every other
peer and the whole runner network is unacceptable: a compromised sandbox could reach other
sandboxes and any service on the runner's private network. The overlay is only safe with
strict access control. Daytona's VPN page gives no guidance here; the policy design is
entirely ours.

### What NetBird gives us

- **Groups and access policies.** NetBird controls reachability between peers with groups and
  policies. A policy names which groups may connect to which, on which protocols and ports
  ([manage network access](https://docs.netbird.io/manage/access-control/manage-network-access)).
  The default posture we want: one `runner` group, one `sandboxes` group, a policy that lets
  `sandboxes` reach only the specific runner ports it needs (the store port, the permission
  RPC port), and no policy permitting `sandboxes` to `sandboxes`. Sandbox-to-sandbox is denied
  by omission.
- **Per-run isolation with auto-assign groups.** A setup key can auto-assign every peer that
  uses it to named groups
  ([setup keys](https://docs.netbird.io/manage/peers/register-machines-using-setup-keys)). A
  per-run key can drop that run's sandbox into a run-scoped group so its policy is exactly the
  endpoints that run needs, and nothing else.
- **Ephemeral keys and lifetime.** Ephemeral peers are auto-removed after 10 minutes offline,
  and keys are minted per run rather than shared. Revocation is deleting the key or the peer
  on the management plane
  ([setup keys](https://docs.netbird.io/manage/peers/register-machines-using-setup-keys)).

### Blast radius versus today's ngrok tunnel

Today's ngrok tunnel exposes the SeaweedFS store on a public URL behind an auth token (per the
runner explainer and the `mount.ts` tunnel code). Its blast radius is one port on the public
internet, guarded by a single shared token, reachable by anyone who learns the URL and token.

A correctly-fenced overlay is better: no public surface at all, per-run scoping, and per-peer
revocation. A misconfigured flat overlay is worse: the sandbox holds a live peer credential
and a route into the runner's private network, so a wrong policy exposes far more than one
store port. So the overlay improves blast radius only if the ACL is right, and ACL
correctness is the one thing this design cannot get wrong. That argues for the overlay policy
to be default-deny, generated per run, and tested as a first-class part of the feature rather
than hand-maintained.

One residual to name: the sandbox now runs a NetBird client that holds a WireGuard key and
can reach the runner peer. That is strictly more reachability than the sandbox has today
(today it reaches the runner through nothing; the runner reaches it). The ACL is what keeps
that reachability down to the intended ports. This is the security tradeoff of the whole
idea.

## Question 4: Local mode

Local sandboxes run inside the runner container's own host and share the docker network with
the runner and the store, so the sandbox reaches everything directly and every feature works
(per the runner explainer, "How a local run executes"). There is no connectivity problem to
solve locally.

Two options:

- **Leave local as-is; the overlay is remote-only.** The sandbox-to-runner reachability
  question already has two answers in the code depending on the sandbox axis (local shares
  the docker network; Daytona goes through the preview proxy and file relay). The overlay
  becomes the Daytona answer to that same question. It does not add a new divergence axis;
  the code already branches on `isDaytona` for mounts, MCP delivery, and asset upload.
- **Run the overlay locally too, for uniformity.** One code path for sandbox-to-runner
  everywhere. The cost is that every self-hoster, including the common local-only case that
  needs no isolation, now runs the management, signal, and relay services for no connectivity
  benefit.

**Recommendation: leave local as-is.** The overlay is a remote-sandbox transport, gated on
the Daytona path, exactly where the shared docker network does not exist. Forcing it on the
local path adds three services to every self-hosted install to solve a problem the local path
does not have. The uniformity argument is weaker than it looks, because the local and Daytona
paths already differ in mount location, MCP delivery, and asset handling. Adding the overlay
only to the remote path fits the existing shape rather than fighting it.

## Question 5: Effort, fit, and alternatives

### What it would replace, and what it must not block

- **Replaces the ngrok tunnel** for remote store mounts (F-017): the `with-tunnel` compose
  profile, the ngrok service, `discoverTunnelEndpoint`, and the public-store requirement.
  This is the cleanest and least contentious win.
- **Could later retire the file-relay gate channel** (Option B of the F-018 fix) by making
  the ACP reverse RPC work over a direct channel (Option A). It does not retire Option C.
- **Could remove the MCP loopback swap** on Daytona and the need for the in-sandbox MCP shim.

The F-018 fix is being implemented now (`../daytona-gate-delivery/`), and NetBird must not
block it. The relationship:

- **Option C of the F-018 fix is complementary and permanent.** Option C precomputes each
  builtin's allow/deny decision on the runner and injects it, so an allowed builtin resolves
  in the sandbox with no round-trip. That is a correctness-and-latency improvement
  independent of the transport. It stays valuable even with the overlay, because a direct
  channel still has round-trip cost you would rather avoid for the allow case.
- **Option B of the F-018 fix is the near-term bridge that the overlay could later replace.**
  Option B carries the gate over the polled file relay because the reverse RPC transport is
  broken. If the overlay lands and makes Option A viable, Option B's second channel can
  retire. So Option B is not throwaway work: it ships the fix now, ahead of the overlay, and
  it is a small, contained channel to remove later.

Net: none of the F-018 work is wasted. Build it now as the near-term fix. Frame NetBird as
the possible longer-term transport that could later retire Option B and keep Option C.

### Effort by phase (all estimates UNVERIFIED)

- **Phase 0, confirmation run: about 1 day.** Not a go/no-go on an unknown; Daytona documents
  the flow. Bake the NetBird client into a test snapshot, mint an ephemeral setup key, join
  one sandbox, verify the interface comes up in kernel mode and that the runner and sandbox
  reach each other in both directions, and measure round-trip latency and join time against
  the current preview-proxy and ngrok paths. Also test the interaction with a restricted
  Daytona egress policy.
- **Phase 1, MVP behind a flag: about 1 week.** Point at a control plane (NetBird cloud for
  Agenta Cloud first; self-hosted can follow). Mint a per-run ephemeral setup key in the
  runner, inject it into the sandbox env, join on boot. Route the geesefs store mount over
  the overlay and drop ngrok on that path. Behind a flag, default off, Daytona only.
- **Phase 2, production and ACL hardening: 1 to 2 weeks.** Per-run groups and a default-deny
  policy generated per run, key and peer revocation on teardown, fail-loud behavior when the
  overlay does not come up (never a silent fallback that hangs, the F-017 lesson),
  observability, self-hosted control-plane option, and the self-hosting docs.

### Alternatives

- **Tailscale.** Also a first-class documented flow on the same Daytona VPN page (auth-key
  join, `sudo tailscale up --auth-key=...`), so feasibility is equal. The Tailscale client is
  open source, but the control plane is proprietary SaaS; the open-source self-hosted control
  plane is Headscale (BSD-3), a separate project ([Headscale](https://headscale.net/)).
  Tailscale's pricing is per-user (Standard around $8/user, **UNVERIFIED** current number,
  [Tailscale pricing analysis](https://wz-it.com/en/blog/tailscale-pricing-2026-headscale-netbird-self-hosted/)),
  which fits a fleet of ephemeral machine peers poorly. NetBird is a single open-source
  project that self-hosts the whole control plane, which is a better fit for shipping the
  control plane inside a self-hosted product.
- **Plain WireGuard.** No management plane, no signal, no NAT traversal. We would hand-manage
  keys, peer config, and IP allocation per ephemeral sandbox, and build our own key
  distribution and revocation. That is most of what NetBird's management plane already does.
  Not worth it for a fleet of short-lived peers.
- **Keep per-feature tunnels (the status quo).** ngrok for mounts, the file relay for gates
  and tools, the in-sandbox shim for MCP. Each is small and already mostly built. The cost is
  that the count of one-off workarounds grows with each new sandbox-to-runner need, and each
  has its own failure mode (the zombie mount in F-017, the lost RPC in F-018). The overlay's
  pitch is to replace that growing set with one transport.

## Cloudflare Tunnel as a near-term ngrok replacement (mounts only)

Separate question from the overlay: the tunnel's only current job is the remote mount path.
The runner-side stack exposes the store's S3 endpoint (`seaweedfs:8333`) through ngrok so
geesefs inside a Daytona sandbox can reach it; the runner discovers the public URL through
ngrok's local API (`http://ngrok:4040/api/tunnels`, `discoverTunnelEndpoint` in `mount.ts`).
ngrok requires every deployment to provision an `NGROK_AUTHTOKEN`, and that requirement is
exactly what bit us in F-017: the dev box had no token, the tunnel was down, and mounts
zombie-hung. Cloudflare Tunnel can run with no account at all, which is the draw.

### Option 1: TryCloudflare quick tunnels (zero auth)

`cloudflared tunnel --url http://seaweedfs:8333` with no account and no token gets a random
`*.trycloudflare.com` HTTPS URL
([Cloudflare quick tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)).
What it trades away, plainly:

- **No SLA and stated non-production intent.** Cloudflare says quick tunnels are for testing
  and development only and guarantees no uptime. The tunnel can be reclaimed at any time.
- **A new random subdomain on every start.** Harmless for us, because the runner re-discovers
  the URL at mount time anyway, but it means the URL is never stable across restarts.
- **Limits.** 200 in-flight requests per quick tunnel (429 beyond that), a single connection
  to Cloudflare's edge (no redundancy), and the docs note quick tunnels do not support
  Server-Sent Events (irrelevant for S3)
  ([quick tunnels docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/),
  [cloudflared internals](https://deepwiki.com/cloudflare/cloudflared/3.4-quick-tunnels)).
- **The S3 workload should fit, with one caveat.** geesefs traffic is ordinary HTTPS: ranged
  GETs, PUTs, multipart uploads, each a bounded request, which is what the tunnel proxies.
  The caveat is Cloudflare's proxy body-size limit (around 100 MB per request on the free
  tier, **UNVERIFIED** exact number): a multipart PUT whose part size exceeds it would fail.
  geesefs part sizes are configurable and small by default (**UNVERIFIED**; confirm our
  effective part sizes in the confirmation run), so this is a checkable risk, not a blocker.

Verdict on quick tunnels: they fit the dev-box case exactly (the F-017 failure mode was "no
token, no tunnel"; a quick tunnel needs no token, so the tunnel is simply always up), and
they are explicitly the wrong thing to document as the production path.

### Option 2: named Cloudflare tunnels (free, needs account + domain)

A named tunnel is free but needs a Cloudflare account, a domain on Cloudflare, and a tunnel
token ([Cloudflare tunnel setup](https://developers.cloudflare.com/tunnel/setup/)). For a
self-hoster that is the same shape of burden as ngrok's authtoken (provision a credential),
plus a domain requirement ngrok does not have. It buys a stable hostname, production intent,
and multiple edge connections. Named tunnels beat "ngrok with token" mainly on price
(Cloudflare's is free at this scale; ngrok's free tier has its own limits) and on the 100s of
megabytes of bandwidth ngrok's free tier caps (**UNVERIFIED** current ngrok free-tier caps).
They do not remove the provisioning step, which was the actual pain.

### Security

Same public-exposure model as ngrok: the store rides a public URL, and the only guard is the
store's own auth (the signed, prefix-scoped, short-TTL S3 credentials the API mints; the
bucket master key never rides the tunnel). A quick tunnel is marginally worse than ngrok in
one respect: the URL is unauthenticated at the tunnel layer and anyone who learns it can
reach the store port, exactly like ngrok minus the account-level controls ngrok offers.
Cloudflare Access can add authentication in front of a named tunnel, but that reintroduces
per-deployment auth setup, which defeats the zero-auth goal; say so plainly and do not plan
on it. The real security posture in every tunnel variant remains: the store endpoint is
public, the credentials scoped and short-lived. Only the overlay removes the public surface.

### Integration effort

Small and contained (**UNVERIFIED**, estimate 1 to 2 days):

- **Discovery.** cloudflared's metrics server exposes `GET /quicktunnel` returning
  `{"hostname":"..."}` (verified in source: `metrics/metrics.go` lines 86-88 on cloudflared
  master). `discoverTunnelEndpoint` in `mount.ts` gains a cloudflared branch: query
  `http://cloudflared:<metrics-port>/quicktunnel` instead of `http://ngrok:4040/api/tunnels`,
  prepend `https://`. The function already returns null-on-failure with the mount skipped.
- **Compose.** Swap or add a `cloudflared` service under the same `with-tunnel` profile
  (`cloudflared tunnel --url http://seaweedfs:8333 --metrics 0.0.0.0:20241`, official image,
  no env vars needed for quick tunnels). Both services can coexist behind the profile with
  discovery trying each in turn, which gives a migration path rather than a flag-day swap.
- **No sandbox-side change.** geesefs already takes whatever endpoint URL discovery returns.

### Where it sits relative to the overlay

The tunnel is the today-fix for mounts; the overlay is the later-fix that deletes the tunnel
entirely. Cloudflare quick tunnels are worth the small churn on one condition: they remove
the token-provisioning failure mode from every dev and self-hosted deployment now, for one to
two days of contained work, and everything added (one compose service, one discovery branch)
is deleted wholesale when the overlay lands. If the overlay were committed and starting next
week, skip the churn. Since the overlay is still pre-confirmation and Phase 2 hardening is
weeks out, the quick-tunnel swap pays for itself in unbroken dev boxes in the meantime.
Recommend: quick tunnels as the default dev/self-host path behind the existing profile,
ngrok kept as the alternative for anyone who already has a token, production (Agenta Cloud)
unaffected because its store is genuinely public.
