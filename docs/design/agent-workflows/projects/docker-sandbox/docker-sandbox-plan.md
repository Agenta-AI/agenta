# Docker Sandbox Provider Plan

Date: 2026-07-13

## Context

The sandbox axis today has two provisionable ids — `local` and `daytona` — plus `e2b`
recognized-but-planned (`services/runner/src/engines/sandbox_agent/provider.ts`,
`KNOWN_SANDBOX_IDS` / `PLANNED_SANDBOX_IDS`). `local` parks harness processes on the
runner host itself; `daytona` provisions a remote micro-VM per session.

There is a gap between those two: self-hosted operators who want per-session isolation
and independent scalability without a cloud sandbox account. A `docker` provider fills
it — one Docker container per session on the runner's Docker daemon. It is not a
Firecracker-grade boundary (shared kernel, and the runner holds the Docker socket), but
it removes the two worst properties of `local`: sessions sharing one filesystem/process
namespace, and session state dying with the runner process.

The persistent-sessions PoC (PR #4813, branch `poc/persistent-sessions`, under
`sessions/demo/`) already ran a `docker` mode alongside local/daytona/e2b/modal and
proved the shape end-to-end. This plan folds its learnings into the refactored engine
from the sandbox-agent refactor (PR #5264), which created exactly the seams this needs:
`provider.ts` (single provider factory), `runtime-contracts.ts`, `session-pool.ts`
(provider-agnostic), `session-identity.ts` (keep-alive config/dispatch),
`environment.ts` (acquire/park/teardown).

Related: the [allowed-sandboxes plan](../allowed-sandboxes/allowed-sandboxes-plan.md)
gates which providers a deployment exposes; `docker` (like `local`) is expected to be
disabled in cloud via `AGENTA_RUNNER_SANDBOXES_ALLOWLIST`.

## What the PoC proved (and what it got wrong)

As-built on `poc/persistent-sessions` (`sessions/demo/sidecar/sandbox-provider.js`,
`sessions/demo/sidecar/server.js`, `sessions/demo/docker-image/Dockerfile`):

- **dockerode over the host socket** (`/var/run/docker.sock` mounted into the sidecar),
  not the docker CLI. Worked well; keep.
- **A custom provider base, not the SDK's built-in `docker()`.** The sandbox-agent
  SDK's docker provider owns the whole `HostConfig`, so extra capabilities (FUSE)
  clobber its port bindings. The PoC built the container itself: baked image,
  `Entrypoint: sleep infinity`, random free host port mapped to the fixed in-container
  daemon port, then started `sandbox-agent server` later via `exec` once credentials
  and mounts were ready. Keep the custom base; the deferred, credential-carrying server
  start is also what the runner's Daytona path effectively does.
- **Harnesses baked into the image** at build time (`sandbox-agent install-agent
  claude/codex/opencode/pi` + arch fixes), mirroring the E2B template and Daytona
  snapshot. Keep: image build is the docker sibling of `DAYTONA_SNAPSHOT`.
- **Durable cwd via geesefs FUSE-mounted inside the container** (`SYS_ADMIN` +
  `/dev/fuse` + apparmor unconfined on every sandbox container). Revisit — see
  "Durable cwd" below.
- **Fresh-per-turn containers**: every turn destroyed its container at the end;
  persistence came entirely from the S3-backed cwd. This predates the runner's session
  keep-alive. The runner version should instead park containers in the session pool the
  way it parks local processes and Daytona sandboxes.
- **No naming, no labels**: containers got Docker's random names; the only identity was
  the opaque container id persisted in the PoC's DB. Discovery and GC were impossible
  without that row. This is the biggest gap to fix (see "Naming and labels").
- **Leak fragility**: `AutoRemove: true` never fires under `sleep infinity`, so any code
  path that skipped the explicit destroy leaked a live container (a real PoC bug, fixed
  by adding an explicit per-turn destroy). The runner version must not depend on one
  in-band destroy call; it needs label-driven GC as a backstop.
- **Networking assumed Docker Desktop** (`host.docker.internal`, overridable via env).
  Needs a first-class answer for Linux hosts (compose already adds
  `host-gateway` as an `extra_hosts` mapping; helm/k8s needs its own).

## Target shape in the runner

### Provider factory

`buildSandboxProvider` (`provider.ts`) gains a `docker` branch that returns a
`dockerWithLifecycle(...)` mirroring `daytonaWithLifecycle`
(`daytona-provider.ts`) — the base create/connect plus the lifecycle surface the
engine already consumes:

- `createSession` / `resumeSession` / `destroySession` — base sandbox-agent contract.
- `pause(sandboxId)` — `docker stop` (container filesystem and installed state
  survive; this is the park operation, the analog of Daytona's stop).
- `reconnect(sandboxId)` — `docker start` + wait for the daemon port; re-exec the
  server if the entrypoint model requires it.
- `refreshActivity(sandboxId)` — bump the last-used marker (a label update or an
  in-runner timestamp) so idle GC has ground truth.
- `deleteSandbox(sandboxId)` — `docker rm -f`.

`KNOWN_SANDBOX_IDS` gains `"docker"`. The unknown-id refusal stays as-is.

### RunPlan: stop multiplying booleans

`run-plan.ts` derives `isDaytona` and `isRemoteSandbox` from the raw string, and the
engine branches on those in at least three places. Adding `isDocker` as a third boolean
compounds the problem. Introduce a small discriminant on the plan instead:

```ts
sandboxKind: "local" | "docker" | "daytona" // future: "e2b"
```

with the existing booleans kept as derived fields during the transition. The known
hardcoded gates to revisit when `docker` lands (all found while auditing PR #5264):

1. `environment.ts` teardown disposition — `plan.isDaytona && environment.sandbox?.pauseSandbox`
   gates parking; docker parks too (via `docker stop`), so the gate becomes
   capability-based (`pauseSandbox` exists) rather than id-based.
2. `server.ts` `onParkedLive` — Daytona-only `refreshActivity` heartbeat; docker wants
   the same hook.
3. `run-plan.ts` network-policy gate — restricted egress is rejected for non-Daytona
   today; docker CAN enforce restrictions (`network: none`, dedicated networks, or an
   egress proxy), so the gate becomes per-provider capability, not `isDaytona`.

### Keep-alive and the session pool

`session-pool.ts` is already provider-agnostic (opaque environment + teardown closure);
no changes needed there. What must be extended or the provider silently never parks:

- `KeepaliveProviderName` (`session-identity.ts`) gains `"docker"`.
- `readKeepaliveConfig` gains a docker branch with its own knobs:
  `AGENTA_RUNNER_DOCKER_SESSION_IDLE_TTL_MS` and
  `AGENTA_RUNNER_DOCKER_SESSION_MAX_WARM` (mirroring the Daytona pair). A stopped
  container costs disk only, so the docker pool can afford a longer TTL than local
  (which holds host memory) at zero compute cost — but see GC below, stopped
  containers still need an expiry.
- `resolveKeepaliveProvider` (`server.ts`) maps the id.

Ownership: docker sessions are pinned to the runner host's Docker daemon, so for
multi-replica ownership they behave like `local`, not like Daytona — another replica
cannot adopt the container unless it shares the daemon. Keep
`resolvesToLocalProvider` strictly `local` (it gates local-process semantics), but
apply the same replica-ownership check to docker sessions via the container's
`agenta.runner.replica` label (below). Unlike local processes, containers survive a
runner restart: on boot the runner can re-adopt containers labeled with its replica id
instead of cold-starting — a strict improvement over local mode worth a dedicated
slice.

### Naming and labels (the convention the PoC lacked)

Containers must be discoverable and attributable without a database row. Two
mechanisms, both mandatory:

**Deterministic name.** Prefix from the runner's own container name (or, where that is
not resolvable, `agenta-runner`), then a fixed marker, then the session identity:

```text
<runner-container-name>-sandbox-<short-id>
e.g. agenta-oss-gh-runner-1-sandbox-a1b2c3d4e5f6
```

- `<runner-container-name>` comes from the runner's hostname/cgroup introspection or an
  explicit `AGENTA_RUNNER_CONTAINER_NAME` env; falling back to `agenta-runner` keeps
  the convention stable outside compose.
- `-sandbox-` is the fixed marker (one word; sessions are a higher-level concept that
  can span sandboxes, and "sandbox" matches the wire field and the provider axis).
- `<short-id>` is a short hash of the pool key / continuation fingerprint
  (`session-identity.ts` already computes sha256 fingerprints — reuse a 12-char prefix).
  Not the raw session id: container names leak into `docker ps` for every operator on
  the host, and the pool key already encodes session identity safely.

Deterministic names also buy idempotency: a create that races a retry fails with a
name conflict instead of silently double-provisioning; the conflict handler attaches
or replaces.

**Labels** carry the machine-readable identity (names are for humans):

```text
agenta.sandbox=true
agenta.sandbox.session=<pool-key-hash>
agenta.sandbox.runner=<replica-id>        # AGENTA_RUNNER_REPLICA_ID
agenta.sandbox.created-at=<iso8601>
```

Labels are the GC and adoption index (`docker ps --filter label=agenta.sandbox=true`).
Do not put project or user identifiers in labels or names.

### GC: never depend on the happy path

The PoC's lesson: an explicit destroy call is not a lifecycle. The runner adds:

- **Boot sweep**: list `agenta.sandbox=true` containers for this replica id; re-adopt
  the ones with a valid parked fingerprint, remove the rest.
- **Periodic sweep**: stopped containers older than a hard TTL
  (`AGENTA_RUNNER_DOCKER_SESSION_MAX_AGE_MS`, generous default, e.g. 24h) are removed
  regardless of pool state; running containers with no live pool entry are stopped
  then removed. This is the docker analog of Daytona's `autoStopInterval` /
  `autoDeleteInterval` self-reaping, which docker does not give us for free.
- No `AutoRemove`: it is useless under a long-lived entrypoint and hides crash
  forensics. Removal is always explicit (teardown or sweep).

### Durable cwd

Two options; the PoC chose (b), this plan recommends (a):

a. **Bind-mount from the runner host.** The runner already holds FUSE capabilities
   (compose grants `SYS_ADMIN` + `/dev/fuse` for local-sandbox geesefs mounts) and
   already mounts the durable cwd for local sessions. Mount once on the runner, bind
   the per-session subtree into the container (`HostConfig.Binds`). Sandbox containers
   then need NO extra capabilities — a materially smaller attack surface, and the
   mount lifecycle stays where mount signing already happens (`mount.ts`,
   `environment-setup.ts`).
b. **geesefs inside the container** (PoC approach): every sandbox container gets
   `SYS_ADMIN` + `/dev/fuse` + apparmor unconfined, and S3 credentials enter the
   container environment. Only worth it if the runner and the Docker daemon are on
   different hosts (remote `DOCKER_HOST`), where host bind-mounts do not exist.

Caveat for (a): a FUSE mount created inside the runner container is only bind-mountable
into sibling containers if it lives on a shared, host-visible path (mount propagation);
compose needs the runner's mount dir to be an `rshared` host bind. If that proves
brittle, (b) stays the fallback and its capability grant is confined to the sandbox
containers, which the allowlist can still disable in cloud.

### Security posture

Be explicit in docs and code comments:

- The Docker socket is root-equivalent on the host. The `docker` provider isolates
  sessions from each other; it does not isolate the runner from the host. Deployments
  that need the latter use Daytona/E2B — which is exactly why
  `AGENTA_RUNNER_SANDBOXES_ALLOWLIST` exists and why cloud disables `local` and `docker`.
- Sandbox containers: non-root user where harnesses tolerate it, no socket mount, no
  added capabilities under option (a), resource limits on by default
  (`AGENTA_RUNNER_DOCKER_CPUS` / `_MEMORY` / `_PIDS_LIMIT` with conservative
  defaults), dedicated bridge network per deployment rather than the default bridge.
- Egress: `network: none` when the plan's network policy is block-all; allowlists via
  a proxy sidecar are a later slice — until then restricted-egress requests on docker
  fail loud in `buildRunPlan`, exactly like local today.

## Configuration surface

| Env var | Default | Meaning |
| --- | --- | --- |
| `AGENTA_RUNNER_DOCKER_IMAGE` | (required to enable) | Sandbox image with daemon + harnesses baked |
| `AGENTA_RUNNER_DOCKER_SOCKET` | `/var/run/docker.sock` | Socket path (or `DOCKER_HOST` for remote daemons) |
| `AGENTA_RUNNER_DOCKER_NETWORK` | deployment bridge | Network to attach sandbox containers to |
| `AGENTA_RUNNER_DOCKER_CPUS` / `_MEMORY` / `_PIDS_LIMIT` | conservative | Per-container resource limits |
| `AGENTA_RUNNER_DOCKER_SESSION_IDLE_TTL_MS` | e.g. 600000 | Warm-park idle TTL (0 disables parking) |
| `AGENTA_RUNNER_DOCKER_SESSION_MAX_WARM` | e.g. 20 | Max parked containers |
| `AGENTA_RUNNER_DOCKER_SESSION_MAX_AGE_MS` | 86400000 | Hard GC age for stopped containers |
| `AGENTA_RUNNER_CONTAINER_NAME` | introspected | Prefix for the naming convention |

`SANDBOX_AGENT_PROVIDER=docker` selects it as the deployment default;
`AGENTA_RUNNER_SANDBOXES_ALLOWLIST` must include `docker` for requests to reach it.

Compose/helm: the runner service needs the socket mount (already present on several
services in the dev/gh stacks) and, under option (a), an `rshared` mount dir. The
sandbox image gets a build target next to the runner image.

### Cross-layer additions

The runner owns the behavior, but `docker` must also become a legal value of the axis:

- `_SandboxSchema.kind` (`sdks/python/agenta/sdk/utils/types.py`) gains `"docker"` in
  its `Literal` — this JSON schema is what the web dropdown enumerates, so the UI
  follows automatically, filtered by the allowlist.
- `services/oss` `select_backend` passes the id through unchanged; its gate is the
  generalized allowlist check, nothing docker-specific.
- The whole deployment surface documents the new provider and its
  `AGENTA_RUNNER_DOCKER_*` knobs — same checklist as the allowed-sandboxes plan: the
  four `hosting/docker-compose/{oss,ee}/env.*.example` files (bare `VAR=` lines), the
  compose files that enumerate runner env vars (plus the socket mount and, under
  durable-cwd option (a), the `rshared` mount dir), helm `values.schema.json` /
  `values.yaml` / `templates/_helpers.tpl` / `hosting/kubernetes/ee/values.ee.example.yaml`,
  and the self-host configuration MDX (`docs/docs/self-host/02-configuration.mdx`
  mapping table + a docker sibling of the existing Daytona sandbox guide under
  `docs/docs/self-host/guides/`).

## Testing

- Unit: fake docker client behind a narrow port (create/start/stop/exec/list/remove),
  mirroring the Daytona provider tests — lifecycle mapping, naming determinism, label
  contents, GC sweep decisions (adopt / stop / remove), name-conflict handling.
- Integration (opt-in, needs a docker daemon): cold run, park + resume reuses the same
  container, runner-restart re-adoption, boot-sweep removal of an orphaned container.
- The existing keep-alive dispatch tests extend to the third provider id.

## Slices

1. `sandboxKind` discriminant in `run-plan.ts`; convert the three id-hardcoded gates to
   capability/kind checks. Pure refactor, lands on top of PR #5264.
2. `docker` provider base + lifecycle wrapper + factory branch, cold path only
   (create → run → destroy), with naming + labels from day one.
3. Keep-alive: pool wiring, park (`stop`) / resume (`start`), config knobs.
4. GC: boot sweep, periodic sweep, restart re-adoption.
5. Durable cwd option (a) plumbing (compose `rshared`, bind-mounts), falling back to
   (b) where the daemon is remote.
6. Hosting + docs: the deployment-surface checklist in "Cross-layer additions" above
   (env examples, compose, helm schema/values/helpers/values example, self-host
   configuration MDX + guide), plus the sandbox image build.

## Non-goals

- Not a hard multi-tenant boundary; cloud keeps `docker` disabled via the allowlist.
- No remote Docker daemon orchestration beyond honoring `DOCKER_HOST` (no swarm, no
  per-node scheduling).
- No egress allowlist proxy in the first pass (block-all or open only).
- Does not replace `local`; both remain for self-hosted, selectable per request.

## Open questions

- Does the sandbox-agent SDK's built-in `docker()` provider now accept enough of
  `HostConfig` to avoid the custom base, or do we still rebuild container creation
  ourselves as the PoC did? (Check the vendored SDK version before slice 2.)
- Whether `pause` should also checkpoint memory (CRIU / `docker checkpoint`) is out of
  scope; `stop` + cwd durability matched the PoC's resume quality bar.
- Image publication: one `agenta-sandbox` image per release next to `agenta-runner`,
  or per-harness variants to keep size down?
