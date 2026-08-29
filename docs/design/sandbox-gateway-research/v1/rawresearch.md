# Raw research

This file records evidence and comparisons. It is deliberately less polished
than `architecture.md`; claims that influence a decision should eventually move
into a decision record with an explicit date and owner.

## 1. Neighboring Agenta design work

The following sibling worktrees were inspected:

- `add-gateways`, especially `docs/design/gateways-research/v1/`;
- `add-wallets`, especially `docs/design/wallets-research/v1/` and the prior
  sandbox metering design;
- `add-channels`, especially `docs/design/channels-research/v2/`.

The shared dossier pattern is a short README and reading order, an architecture
overview, decisions and notes, protocol/provider quarantine files, raw research,
out-of-scope boundaries, and later implementation plans/workstreams. This first
sandbox pass stops before workstreams.

The gateway work establishes several useful positions:

- all governed LLM and MCP traffic enters a gateway surface;
- callers inherit Agenta identity and authorization;
- endpoint records keep secret references rather than secret values;
- the vault resolves secrets at use time;
- a shared policy layer can serve multiple protocol planes;
- `builtin`, `standard`, and `custom` route namespaces prevent provider names
  from becoming the whole contract;
- the data path should preserve upstream protocol semantics while consent and
  governance remain visible.

The wallet work is relevant because sandbox usage differs by provider. E2B can
push lifecycle usage; Daytona may require polling. A sandbox gateway is the
right normalization boundary for resource-seconds, storage gauges, lifecycle
events, and pre-create entitlement checks.

## 2. Current Agenta sandbox path

### 2.1 Provider selection

Current provisionable sandbox IDs are `local` and `daytona`. `e2b` appears as a
planned provider and fails explicitly. No Docker sandbox adapter exists; local
mode starts `sandbox-agent server` as a child process on the runner host. The
runner itself may be deployed in Docker, but that is a deployment boundary, not
a per-run Docker sandbox.

Important code areas:

- `services/runner/src/engines/sandbox_agent/provider.ts` selects and builds the
  provider;
- `services/runner/src/config/runner-config.ts` publishes supported IDs;
- `sdks/python/agenta/sdk/agents/sandbox/sandbox_providers.py` mirrors provider
  configuration;
- `services/runner/src/engines/sandbox_agent/providers/local.ts` starts the local
  daemon;
- `services/runner/src/engines/sandbox_agent/providers/daytona.ts` builds the
  Daytona create request and lifecycle wrapper.

### 2.2 Daytona lifecycle

The runner creates a Daytona client, builds a request with snapshot, target,
network settings, env values, secret attachments, and auto-stop/delete policy,
then wraps it in lifecycle behavior. It converges network policy, refreshes
activity, parks or stops, reconnects/starts, and deletes.

A stored provider pointer can reconnect a later run in the same conversation.
Acquire first tries that pointer and creates a fresh sandbox when reconnect fails.
Teardown decides whether to park or delete based on the reason. Runner shutdown
tracks in-flight sandboxes and attempts cleanup; provider auto-reapers remain the
last line of defense.

This is a useful behavioral baseline, but the durable identity exposed to the
rest of Agenta is still a provider pointer rather than a gateway-owned sandbox
and generation.

### 2.3 Vault, model, and MCP credentials

The Python service/SDK resolves vault connections before execution:

- model connection resolution fetches Agenta `/secrets/`, selects a provider or
  custom connection, and produces typed credential values;
- named MCP secrets are fetched from `/secrets/{slug}` and materialized as typed
  header credential values;
- those resolved values travel on the service-to-runner contract;
- the runner materializes a model environment and MCP configuration.

Local mode merges the resolved credentials into the sandbox-agent process
environment. Daytona distinguishes two intended usages:

- `local_use` remains plaintext environment material because sandbox code needs
  the value;
- `opaque_http` can be allocated through Daytona Secrets and represented by a
  placeholder restricted to an allowed HTTPS host.

The Daytona allocation registry is currently process-local. If the runner
restarts, it cannot prove which provider secrets belong to a reconnected sandbox,
so the safe behavior is deletion and fresh creation. That is exactly the kind of
volatile bootstrap state a gateway generation/revision should reconcile.

### 2.4 Mounts and FUSE

The runner obtains short-lived object-store credentials and uses geesefs. Local
mode mounts from the runner host. Remote Daytona mode executes mount commands in
the sandbox and passes storage credentials into that execution environment.

The current implementation has valuable safety behavior: it detects stale or
dead FUSE mounts, detaches before fallback, verifies liveness after mount, keeps
the durable working directory separate from ephemeral relay/telemetry/tool
directories, and can rotate/remount credentials. The concern is ownership and
credential placement, not the existence of this recovery logic.

### 2.5 ACP and connectivity

The runner uses the sandbox-agent SDK over HTTP with extended header, body, and
keepalive timeouts to support streaming work and human approval pauses. Daytona
endpoint discovery is hidden behind the acquired provider object. The runner
then selects a harness, constructs the run plan, drives ACP, and emits neutral
events.

The `/run` service-to-runner request is manually mirrored between Python and
TypeScript. It can contain provider credentials, resolved MCP credentials, and
bearer tokens, which is why the runner endpoint itself requires a token. The
desired endpoint is narrower: a runner receives a logical sandbox handle and a
short-lived ACP ticket.

### 2.6 Existing fail-closed behavior

Some current checks are worth preserving:

- unsupported FS sandbox permissions fail rather than silently degrade;
- restricted network policy is rejected in local mode and applied in Daytona;
- remote tool delivery is allowed only where the implementation is proven;
- local subscription mounts are supported while unsupported Daytona runtime
  delivery is rejected.

Provider capability negotiation should make these checks systematic.

## 3. OpenSandbox

Primary sources: [repository](https://github.com/opensandbox-group/OpenSandbox),
[architecture](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/architecture.md),
[API overview](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/api/index.md),
[lifecycle specification](https://github.com/opensandbox-group/OpenSandbox/blob/main/specs/sandbox-lifecycle.yml),
[execd](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/components/execd.md),
and [egress](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/components/egress.md).

OpenSandbox has the clearest direct analogue to the proposed split:

- a lifecycle server exposes create/list/get/delete/pause/resume/renew and
  endpoint resolution under a control API;
- Docker and Kubernetes implementations sit behind a common sandbox service;
- `execd` is a per-sandbox data plane for command execution, files, PTY over
  WebSocket, and metrics;
- an egress sidecar provides network policy and credential injection;
- endpoints can be mapped directly, routed through Kubernetes ingress, or
  proxied by the server; HTTP and WebSocket are supported;
- create accepts image/snapshot, entrypoint, environment, resources, volumes,
  network policy, secure access, and extensions.

The design validates endpoint resolution as a first-class operation: create a
sandbox through the control plane, resolve the declared endpoint, then speak to
the data plane with a sandbox-scoped token. Agenta should adopt the separation,
not necessarily the exact API.

### 3.1 Credential vault

Sources: [credential vault guide](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/guides/credential-vault.md)
and [OSEP-0012](https://github.com/opensandbox-group/OpenSandbox/blob/main/oseps/0012-credential-vault.md).

OpenSandbox can enable a credential proxy alongside network policy. A trusted
control plane resolves the egress endpoint and installs credential values and
bindings after the sandbox is running. The untrusted workload receives a fake or
empty value. The proxy intercepts HTTPS, matches destination and request details,
and injects headers or substitutions. Updates use an atomic revision, reads are
redacted, and values remain in memory.

This creates an important resume obligation: sidecar state is volatile. After a
pause/resume or rebuild, trusted orchestration must replay credential bindings
before allowing work. Documented constraints also matter for an Agenta threat
model: TLS interception and service meshes can conflict, matching needs precise
canonicalization, and large streaming responses need explicit testing through
the proxy.

### 3.2 Volumes

Source: [volume and VolumeBinding OSEP](https://github.com/opensandbox-group/OpenSandbox/blob/main/oseps/0003-volume-and-volumebinding-support.md).

OpenSandbox models host, Kubernetes PVC, and OSSFS-style mounts. Host paths need
an allowlist. PVC subpaths isolate directories but do not provide concurrency
control. The OSSFS proposal includes inline storage credentials in its current
shape, which is a warning rather than a pattern to copy: Agenta should use vault
references, workload identity, a storage proxy, or the shortest-lived STS values.

## 4. DeepSeek Harness

Primary sources: sandbox [interface](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox/README.md),
[local backend](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sandbox/sandbox-local/README.md),
[E2B packages](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/e2b/README.md),
[LLM interface](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm/README.md),
[Pi LLM adapter](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/llm/llm-pi-ai/README.md),
[LLM adapter guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/llm-adapter.md),
[MCP client](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md),
and [ACP package](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md).

### 4.1 Sandbox plugin

The core sandbox seam confines an individual process invocation. A plugin wraps
an argv with a policy and reports how completely it can enforce that policy. The
local implementation uses bwrap then Landlock on Linux, Seatbelt on macOS, and a
restricted/ACL approach on Windows. The useful pattern is fail-closed execution
plus an honest enforcement report for read-only, workspace-write, or dangerous
full-access modes.

The experimental E2B integration replaces generic FS and subprocess
adapters with operations in one E2B sandbox. The host still owns the agent loop,
LLM calls, plugins, skills, and higher-level protocols. It is a composable
execution-world overlay, not a lifecycle gateway: it does not by itself solve
reconnect, leases, pause/resume reconciliation, durable volume bindings, network
policy, credential brokering, or stable Agenta handles.

The architectural lesson is to keep generic FS and subprocess seams
separate from lifecycle/provider adapters. Agenta can expose common `exec` and
`files` data-plane endpoints without forcing ACP or the runner to import a
Daytona/E2B SDK.

### 4.2 LLM plugin compared with Agenta LLM gateway

DeepSeek Harness has a provider-neutral adapter registry and a streaming hook
where plugins can implement logging, caching, and routing. The Pi adapter maps
provider profiles, supports environment-backed credential references, and can
target OpenAI-compatible endpoints. This is strong in-process composition and
hot-swappable host behavior.

Agenta's gateway is the stronger boundary for centralized identity, permissions,
vault resolution, audit, cross-client policy, and network-level upstream
credential custody. The systems are complementary: a harness adapter should
target the Agenta LLM gateway rather than repeat provider secret ownership in
the sandbox.

### 4.3 MCP plugin compared with Agenta MCP gateway

DeepSeek's MCP client runs one plugin per configured server, supports stdio and
Streamable HTTP, supplies configured environment/headers, registers namespaced
tools, and reconnects on hot reload. The host connects directly to each MCP
server. That is simple and composable, but it does not provide a central
authorization, secret, consent, metering, or proxy boundary.

Agenta's MCP gateway should remain the route for remote MCP. Stdio MCP is a
sandbox-local process concern until it is deliberately hosted or bridged. A
known design pressure in harness systems is scoping: the
[workspace scoping discussion](https://github.com/deepseek-ai/deepseek-harness/issues/941)
notes that long-lived profile-wide MCP instances can accidentally share
configuration or sessions across workspaces.
Sandbox/session-scoped gateway credentials and endpoint bindings give Agenta a
clearer tenancy boundary.

## 5. Provider and platform comparison

| System | Control/lifecycle | Data plane | Secrets | Storage/mounts | Most useful lesson |
| --- | --- | --- | --- | --- | --- |
| Current Agenta | Runner selects local/Daytona, reconnects, parks/deletes | sandbox-agent HTTP and ACP hidden behind provider object | Vault values reach runner; local env or Daytona env/opaque placeholders | Runner-owned geesefs and STS | Existing recovery logic is useful, but ownership and wire boundaries must move |
| OpenSandbox | Lifecycle API with Docker/Kubernetes adapters, TTL/pause/resume | Resolved execd and egress endpoints, HTTP/WS | Egress credential vault injects outside workload | Host/PVC/OSSFS volume model | Best direct reference for control/data split and replayable broker state |
| Daytona | Rich create/stop/archive/delete and network/secret controls | Toolbox and per-port preview/proxy endpoints | Provider secrets can be host-restricted placeholders | Volume APIs and retained FS states | Strong first adapter; provider handle and secret allocation must be gateway-owned |
| E2B | Create/connect/kill; pause and snapshots are available in newer SDKs | Envd host per port for commands/files/PTY, access token | Environment is readable; use Agenta gateway/broker instead | Template/snapshot-oriented; normalize capabilities rather than assume mounts | Sandbox ID plus per-sandbox access token resembles handle + endpoint ticket, but do not expose provider identity |
| Modal Sandboxes | Create, lifecycle states, timeout/idle timeout, reconnect | Exec, file operations, tunnels, connect tokens | Secrets are injected as environment values | Volumes, snapshots | Good lease/timeout and reconnect reference; env secret injection is weaker than opaque egress |
| Cloudflare Sandbox | Durable Object identity, lazy start, sleep/keepalive/destroy | Worker can front exposed ports and tunnels | Worker-side outbound policy and credential injection | R2/S3/GCS FUSE; R2 binding or credential proxy can keep keys out of container | Worker as policy/data-plane front door and storage credential proxy |
| Kubernetes Agent Sandbox | CRD/controller, claims, templates, warm pools, suspend mode | Gateway/router or port-forward/direct modes | Deployment-specific | PVC/pod ecosystem | Stable logical identity, reconciliation, warm allocation, and router trust boundaries |
| SWE-ReX | Deployment abstraction for local, Docker, AWS, Modal, others | Remote execution server and shell sessions | Not a credential gateway | Backend-specific | Keep the agent runtime interface independent of execution substrate |
| DeepSeek Harness | Per-call confinement or experimental E2B overlay | Generic fs/subprocess seams | Host plugin/env credential references | E2B overlay only | Capability reporting and composable runtime seams |

### 5.1 Daytona

Sources: [sandbox lifecycle](https://www.daytona.io/docs/en/sandboxes/),
[secrets](https://www.daytona.io/docs/en/secrets/),
[preview endpoints](https://www.daytona.io/docs/en/preview/), and
[API reference](https://www.daytona.io/docs/tools/api/).

Daytona supports network settings, secrets, volumes, auto-stop/pause/archive or
delete, and proxy/preview access to sandbox services. Preview access can use a
token or signed URL; restart and expiry behavior differ. Those credentials should
be translated into generation-scoped Agenta endpoint tickets rather than passed
to runners.

### 5.2 E2B

Sources: current [sandbox SDK reference](https://e2b.dev/docs/sdk-reference/js-sdk/v2.10.4/sandbox)
and [envd API authentication](https://e2b.dev/docs/api-reference/envd/get-the-environment-variables).

E2B exposes create, connect, kill, commands, files, PTY, per-port hosts, access
tokens, and newer pause/snapshot behavior. Connecting by sandbox ID can resume a
paused environment. Envd operations authenticate with a per-sandbox access token
returned on create/connect/resume. This maps naturally to an adapter that stores
the E2B ID internally and returns Agenta endpoint tickets. Because E2B can expose
environment values through its data plane, upstream customer secrets should not
be placed there when an Agenta LLM/MCP gateway or egress broker can hold them.

### 5.3 Modal

Sources: [sandboxes](https://modal.com/docs/guide/sandboxes),
[Sandbox V2](https://modal.com/docs/guide/sandbox-v2),
[tunnels](https://modal.com/docs/guide/tunnels), and
[volumes](https://modal.com/docs/guide/volumes).

Modal makes lifecycle and lease behavior explicit: created/scheduled/started/
ready/finished states, bounded maximum lifetime, idle timeout, detach/reconnect,
exec, tunnels, snapshots, and volumes. Connect tokens and tunnels are examples of
delegated data-plane capabilities. Modal secrets become environment variables,
which means the sandboxed process can read them; that mode corresponds to
Agenta's explicit `local_use`, not opaque injection.

### 5.4 Cloudflare Sandbox

Sources: [overview](https://developers.cloudflare.com/sandbox/),
[lifecycle](https://developers.cloudflare.com/sandbox/api/lifecycle/),
[ports](https://developers.cloudflare.com/sandbox/api/ports/),
[bucket mounts](https://developers.cloudflare.com/sandbox/guides/mount-buckets/),
and [outbound Workers TLS/auth](https://developers.cloudflare.com/changelog/post/2026-04-13-sandbox-outbound-workers-tls-auth/).

A Durable Object keys a sandbox identity; containers start lazily and can sleep,
keep alive, or be destroyed. A Worker can front a sandbox port to apply auth and
rewrites. Bucket mounting uses FUSE. R2 bindings keep credentials in the Worker,
while a credential-proxy option can sign external storage requests outside the
sandbox. This supports the proposal that data-plane policy and storage
credentialing live outside the untrusted workload.

### 5.5 Kubernetes Agent Sandbox

Sources: [repository](https://github.com/kubernetes-sigs/agent-sandbox),
[Python client modes](https://github.com/kubernetes-sigs/agent-sandbox/blob/main/clients/python/agentic-sandbox-client/README.md),
and [threat model](https://github.com/kubernetes-sigs/agent-sandbox/blob/main/docs/security/threat_model.md).

The project models a sandbox as a stateful singleton CRD, with claims, templates,
warm pools, and a controller. Clients can use a production Gateway/Router path,
development port-forward, or direct in-cluster access. Its threat model separates
the trusted controller/router from untrusted sandbox pods and calls out router
authorization, SSRF, WebSocket resource exhaustion, Kubernetes API isolation, and
cross-tenant routing. Agenta needs the same explicit router threat boundary even
when its first adapters are hosted providers rather than Kubernetes.

### 5.6 SWE-ReX

Sources: [repository](https://github.com/SWE-agent/SWE-ReX) and
[tutorial](https://swe-rex.com/latest/usage/).

SWE-ReX provides one asynchronous runtime interface across local execution,
Docker, remote servers, Modal, AWS, and developing Daytona support. A small
remote server owns commands and interactive shell sessions. It reinforces the
need for a stable execution contract above provider deployment, though it is not
a lifecycle, secret, policy, or tenancy gateway.

### 5.7 Docker Sandboxes

Sources: [overview](https://docs.docker.com/ai/sandboxes/),
[architecture](https://docs.docker.com/ai/sandboxes/architecture/),
[security model](https://docs.docker.com/ai/sandboxes/security/), and
[`sbx` reference](https://docs.docker.com/reference/cli/sbx/).

Docker Sandboxes is distinct from running one ordinary Docker container. The
documented boundary is a microVM per sandbox with its own Docker daemon,
FS, and network. A host-side proxy enforces outbound policy and injects
credentials outside the VM; lifecycle, exec, copy, ports, secrets, policies, and
templates are currently exposed through the `sbx` CLI/daemon. Workspace
passthrough is live and read-write by default, while clone/private workflows can
keep the host repository read-only. This makes it a useful builtin adapter for
dedicated developer/worker hosts, but its automation and multi-tenant daemon
contract need live conformance before production claims.

## 6. Cross-system conclusions

1. **Control and data planes converge across mature systems.** OpenSandbox names
   them directly; E2B, Daytona, Cloudflare, Kubernetes Agent Sandbox, and Modal
   all have lifecycle identity plus separate command/port connectivity.
2. **A provider ID is not a safe public handle.** Provider reconnect semantics
   are useful, but Agenta needs a stable identity and generation-bound tickets.
3. **Resume is a reconciliation event.** Volatile credential proxies, mounts,
   services, and endpoint credentials must be replayed and verified.
4. **Environment injection is readable injection.** It remains necessary for
   some tools, but LLM/MCP keys should stay in their gateways and HTTP secrets
   should prefer egress injection.
5. **FUSE changes credential placement, not just storage.** Proxy/service binding
   is preferable; otherwise rotate short-lived STS and make mount health part of
   readiness.
6. **Provider neutrality needs capabilities, not wishful normalization.** Local,
   Daytona, E2B, Docker, and OpenSandbox do not enforce identical security or
   lifecycle semantics.
7. **Streaming changes gateway deployment.** ACP, PTY, uploads, downloads, SSE,
   and WebSockets need a data plane with long-lived connection limits and
   backpressure, separate from normal API workers.
8. **DeepSeek's plugin seams and Agenta's gateways solve different layers.** Keep
   the composable harness interfaces, but route governed network access through
   Agenta-owned gateways.
