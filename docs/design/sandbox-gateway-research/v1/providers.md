# Provider namespaces and capability profiles

Status: initial provider mapping, verified against public documentation on
2026-08-27. Live conformance tests, not this table, are authoritative.

## 1. Namespace catalog

### Builtin

| Route | Meaning | Availability |
| --- | --- | --- |
| `builtin/local` | sandbox-agent child process on the data-plane host | Development and tests only |
| `builtin/docker-sbx` | Docker Sandboxes microVM controlled by the local `sbx` daemon/CLI | Developer or dedicated worker hosts with Docker Sandboxes installed |
| `builtin/agent-sandbox` | Kubernetes Agent Sandbox in an Agenta-operated cluster | Cluster deployment only |

Builtin means Agenta/deployment-operated. It does not mean safe for every policy.
`builtin/local` advertises `isolation=none`; `builtin/docker-sbx` advertises the
microVM controls actually observed; `builtin/agent-sandbox` advertises the
runtime class and network policy of its selected template.

### Standard

| Route | Meaning | Account binding |
| --- | --- | --- |
| `standard/daytona` | Maintained adapter to Daytona's canonical hosted API | Project/org Daytona API credential |
| `standard/e2b` | Maintained adapter to E2B's canonical hosted API | Project/org E2B API credential |

Standard entries are code-owned and cannot change their control URL. A different
region, template, or snapshot is configuration within the supported catalog. A
self-hosted API is custom even when it speaks the same provider protocol.

### Custom

A custom endpoint row has a project-visible slug and an installed `adapter_key`:

```json
{
  "slug": "research-cluster",
  "adapter_key": "agent-sandbox",
  "control_url": "https://sandbox-control.example.net",
  "secret_id": "vault-reference",
  "configuration": {
    "namespace": "agenta-sandboxes",
    "warm_pool": "python-agents",
    "connectivity": "gateway"
  }
}
```

Allowed initial custom adapter keys should be `daytona`, `opensandbox`, and
`agent-sandbox`. E2B remains standard unless its documented self-hosted contract
supports the same adapter. `local`, `docker-sbx`, raw Docker Engine, and arbitrary
Kubernetes credentials are not project-created custom endpoints; those control
planes are host/cluster administration capabilities.

## 2. Baseline capability matrix

`N` = native, `E` = gateway/template emulation, `X` = experimental, `-` =
unsupported. Any cell must be downgraded when a live probe disagrees.

| Capability | local | Docker Sandboxes | Daytona | E2B | K8s Agent Sandbox |
| --- | :---: | :---: | :---: | :---: | :---: |
| create/terminate | E | N | N | N | N |
| reconnect by provider reference | - | N | N | N | N |
| pause/resume | - | N (stop/restart) | N (stop/start) | X | N (`operatingMode`) |
| stable logical handle | E | E | E | E | E |
| sandbox-agent ACP endpoint | N | E | E | E | E |
| exec/files | N | N | N | N | N |
| PTY | N | N | provider/template | N | router/template |
| HTTP/WS port | loopback | N | preview/proxy | per-port host | router/gateway |
| network default deny | - | N | N | coarse provider support | Kubernetes policy/template |
| opaque outbound HTTP secrets | - | N host proxy | N provider secrets | E via Agenta gateway/broker | E via sidecar/platform egress |
| durable workspace | host path | host passthrough/private VM | provider FS/volumes | snapshot/template, no common mount promise | PVC/template |
| FS gateway attachment | E | E | E | capability-gated | E |
| provider usage observation | process metrics | CLI/daemon TBD | poll/provider API | provider API | K8s metrics/events |

This table distinguishes Docker Sandboxes from an ordinary Docker container. The
official architecture describes one microVM, FS, network, and Docker
daemon per sandbox, host-side network/credential proxying, persistent VM state,
and workspace passthrough. See [Docker Sandboxes architecture](https://docs.docker.com/ai/sandboxes/architecture/),
[security model](https://docs.docker.com/ai/sandboxes/security/), and
[`sbx` CLI reference](https://docs.docker.com/reference/cli/sbx/).

## 3. `builtin/local`

Implementation target:

- extract the current child-process behavior into an adapter;
- allocate a process group and loopback port;
- store PID plus a random process birth marker in the provider reference;
- start sandbox-agent with only public env and Agenta gateway credentials;
- resolve ACP/exec/files to loopback through the data plane;
- terminate the process group idempotently;
- reject pause, restricted egress, VM/container isolation, host-path concealment,
  and other controls it cannot enforce.

It is the fastest vertical-slice test backend and the clearest negative-security
backend. An acceptance test that requests network deny must receive 422 before a
process starts.

## 4. `builtin/docker-sbx`

Docker Sandboxes is a microVM product managed through `sbx`, not the Docker Engine
container API. Official documentation states that each sandbox has its own Docker
daemon, FS, and network; the host proxy governs outbound traffic and
injects credentials outside the VM. Workspace passthrough is live and read-write
by default, while clone mode can keep the host repository read-only.

Adapter outline:

1. Probe `sbx version`, daemon health, supported commands, and policy features.
2. Create a named sandbox from an administrator-approved template/environment.
3. Use clone/private workspace mode for untrusted autonomous runs unless an
   explicit direct-workspace policy is approved.
4. Bootstrap sandbox-agent inside the VM and publish its port through `sbx ports`.
5. Resolve runtime operations through the sandbox-agent endpoint; retain `sbx
   exec` and `sbx cp` as bootstrap/recovery operations only.
6. Map gateway pause/resume to `sbx stop` and subsequent start/run semantics.
7. Remove with `sbx rm`; confirm VM and private state disappear.

The CLI/daemon is currently the documented automation surface. Therefore this
adapter starts as builtin and experimental, on dedicated hosts, until machine API
stability and multi-tenant daemon behavior are proven.

## 5. `standard/daytona`

The adapter absorbs current runner behavior:

- create from image/snapshot and effective resources;
- apply network policy;
- resolve sandbox-agent service/preview endpoint;
- observe and normalize provider states;
- stop/start for pause/resume;
- activity refresh and provider auto-delete limits;
- idempotent delete and usage polling;
- provider Secret allocation only as a compatibility path until Agenta gateway
  credentials and the outbound broker cover the workload.

The durable generation owns the provider secret-allocation revision. The current
process-local registry is retired. Reconnect never relies on runner memory.

Daytona sources: [sandboxes](https://www.daytona.io/docs/en/sandboxes/),
[secrets](https://www.daytona.io/docs/en/secrets/), and
[preview endpoints](https://www.daytona.io/docs/en/preview/).

## 6. `standard/e2b`

The adapter stores the E2B sandbox ID internally, creates from an approved
template, uses create/connect/kill for lifecycle, and resolves the sandbox-agent
port with the provider host mechanism. E2B commands, files, and PTY can bootstrap
or diagnose the service.

Pause/resume and snapshots remain capability-probed because current SDKs expose
them as changing/beta surfaces. If pause is unavailable, a request requiring it
fails before create; the gateway can still terminate and create a new generation
from a template or approved snapshot when replacement semantics are acceptable.

The envd access token stays in the adapter/data plane and is exchanged for an
Agenta endpoint ticket. It never reaches the runner. See the current
[E2B sandbox SDK reference](https://e2b.dev/docs/sdk-reference/js-sdk/v2.10.4/sandbox)
and [envd authentication](https://e2b.dev/docs/api-reference/envd/get-the-environment-variables).

## 7. Kubernetes Agent Sandbox

The adapter uses a `SandboxClaim` against an administrator-selected warm pool and
observes the resulting `Sandbox`. Current APIs are `v1beta1`; operating mode
expresses running/suspended state. Runtime connectivity should use the project
router/Gateway mode, not pod IPs exposed to the caller.

Adapter outline:

- route resolution chooses cluster, namespace, warm pool, template, runtime
  class, router host, and credential binding;
- provision creates a claim with Agenta sandbox/generation labels and owner
  references;
- observe watches conditions and the strict claim-to-pod mapping;
- pause/resume changes operating mode and waits for reconciliation;
- endpoint resolution produces the router target with an internal sandbox ID
  header; the Agenta data plane supplies that header after ticket validation;
- termination deletes the claim and verifies backing sandbox/pod cleanup;
- PVC and sidecar declarations are delivered through approved templates, not
  arbitrary per-project pod specs;
- sandbox pods receive no Kubernetes API service-account token unless a template
  explicitly requires one.

An Agenta-operated cluster is `builtin/agent-sandbox`. A customer or dedicated
cluster registered through an administrator-approved endpoint is `custom/{slug}`
with `adapter_key=agent-sandbox`.

Sources: [Agent Sandbox repository](https://github.com/kubernetes-sigs/agent-sandbox),
[v1beta1 migration guide](https://github.com/kubernetes-sigs/agent-sandbox/blob/main/docs/api-migration-guide.md),
[client/router modes](https://github.com/kubernetes-sigs/agent-sandbox/blob/main/clients/python/agentic-sandbox-client/README.md),
and [threat model](https://github.com/kubernetes-sigs/agent-sandbox/blob/main/docs/security/threat_model.md).

## 8. OpenSandbox custom adapter

OpenSandbox is the initial reference for a compatible custom control plane. Its
lifecycle API and endpoint resolution map directly to the provider lifecycle
port; execd maps to the runtime port; egress Credential Vault maps to the broker
port. Docker and Kubernetes are implementation choices behind that endpoint and
do not change the Agenta route.

Credential Vault state is process-local and must be replayed after Kubernetes
pause/resume or a sidecar restart before readiness. See the
[API overview](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/api/index.md),
[execd](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/components/execd.md),
and [Credential Vault guide](https://github.com/opensandbox-group/OpenSandbox/blob/main/docs/guides/credential-vault.md).

## 9. Selection rules

1. An explicit route is used only if it satisfies every required capability.
2. An automatic route selector considers only routes authorized for the project,
   correct region/residency, healthy probe state, template availability, capacity,
   isolation, lifecycle, endpoint, network, FS, and broker requirements.
3. Cost and latency can rank candidates only after hard requirements pass.
4. A custom endpoint never shadows a builtin/standard key; it lives under its slug.
5. A provider becoming unhealthy prevents new placement but does not erase
   generations already bound to it; reconciliation applies provider-specific
   recovery or replacement policy.
6. Capability changes are versioned. Existing generations keep their observed
   capability snapshot until the next observation/bootstrap revision.
