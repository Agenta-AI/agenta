## Verdict

Your framing is directionally right, but four tiers are not enough.

The runner needs an explicit **runtime/daemon lifecycle** between harness session and sandbox. Today, credentials, Pi tool configuration, Claude provider settings, and Codex environment are installed when the agent daemon or sandbox starts. They cannot honestly be classified as turn-tier until a live refresh mechanism exists.

Also, tiers should describe the **minimum invalidation boundary**, not permanently own request fields. Internally, the router should:

1. Normalize the request into semantic facets.
2. Diff desired state against the environment’s actual applied state.
3. Ask the harness and provider adapters how each changed facet can be reconciled.
4. Produce an ordered action plan.
5. Update applied state only after each action succeeds.

A single `max(changedTier)` switch is insufficient because a session reload may still require a workspace refresh first.

I verified the structural claims in the current code. I did not independently verify the 12.5 s and 1.4 s latency measurements.

## Verified problems in the current design

The wholesale fingerprint does include model, harness, sandbox, instructions, skills, tools, MCP configuration, permissions, harness files, workflow revision, and draft state in [session-identity.ts:188](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/session-identity.ts:188).

The pool duplicates that request-derived identity beside the environment in [session-pool.ts:24](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/session-pool.ts:24). That is the root abstraction error: the request says what was wanted, not what was successfully installed.

The approval bug is real:

- Normal re-parking receives the incoming `cfgFp` in [server.ts:592](/home/mahmoud/code/agenta-2/services/runner/src/server.ts:592).
- Approval resume does not reconcile the incoming configuration before continuing in [server.ts:767](/home/mahmoud/code/agenta-2/services/runner/src/server.ts:767).
- After the resumed turn, re-parking stamps the incoming fingerprint anyway in [server.ts:920](/home/mahmoud/code/agenta-2/services/runner/src/server.ts:920).

The current tests actually preserve part of that behavior: a model change during approval is allowed to resume the existing session in [session-keepalive-approval.test.ts:1212](/home/mahmoud/code/agenta-2/services/runner/tests/unit/session-keepalive-approval.test.ts:1212).

The teardown problem is also real. `compatibility-mismatch` falls through to deletion in [teardown.ts:23](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/teardown.ts:23), while stopped-sandbox acquisition later attempts reconnect-by-pointer in [environment.ts:659](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:659).

## 1. Lifecycle model

I would use this top-level execution flow:

```text
Request admission
    |
    v
Session checkout
    |
    v
Desired-state reconciliation
    |
    +--> sandbox lifecycle
    +--> runtime/daemon lifecycle
    +--> mount lifecycle
    +--> workspace lifecycle
    +--> harness-session lifecycle
    |
    v
Turn lifecycle
    |
    +--> complete ------> park
    +--> approval pause -> repark as suspended turn
    +--> failure -------> teardown by disposition
```

### Lifecycle names and responsibilities

| Lifecycle | Events | Responsibility |
|---|---|---|
| Request | `normalize`, `validate`, `plan` | Convert `AgentRunRequest` into semantic desired state. No side effects. |
| Parked session | `checkout`, `park`, `repark`, `expire`, `evict` | Own concurrency, idle timers, continuity metadata, and the environment lease. It does not decide compatibility. |
| Sandbox | `create`, `reconnect`, `reconfigure`, `stop`, `destroy` | Provider instance, image or snapshot generation, network boundary, persistent storage attachment. |
| Runtime/daemon | `bootstrap`, `start`, `attach`, `reconfigure`, `restart`, `stop` | Agent daemon, process environment, provider credentials, Pi extension assets, Codex home, Claude connection environment. |
| Mount | `attach`, `renewCredentials`, `verify`, `detach` | Workspace and agent mounts, signed leases, replica ownership. |
| Workspace | `materialize`, `refresh`, `verify`, `cleanManagedFiles` | `AGENTS.md`, `CLAUDE.md`, skills, system prompt files, harness configuration files. |
| Harness probe | `probe` | Determine functional and lifecycle capabilities for the installed harness/version. |
| Harness session | `open`, `loadNative`, `reopen`, `close` | ACP session and native conversation continuity. `reopen` may load the existing native conversation if continuity permits. |
| Turn | `setup`, `run`, `suspendForApproval`, `resume`, `finish`, `teardown` | Incoming messages, model selection, permission responder, callback binding, attachment preparation, telemetry, relay process. |

### Mapping today’s `acquireEnvironment`

The current lifecycle stages are all embedded in [environment.ts:252](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:252):

| Current timing | Target owner |
|---|---|
| `sandbox_start` | `SandboxLifecycle.acquire`, with separate `create` and `reconnect` events |
| `pi_install` and runtime asset upload | `RuntimeLifecycle.bootstrap` |
| `mounts` | `MountLifecycle.attachWorkspace` |
| `agent_mount` | `MountLifecycle.attachAgentStorage` |
| `prepare_workspace` | `WorkspaceManager.materialize` or `refresh` |
| `probe_capabilities` | `HarnessAdapter.probeLifecycleCapabilities` |
| `create_session` with `load` or `create` mode | `HarnessSessionLifecycle.open` or `loadNative` |
| `acquire_total` | Coordinator aggregate only |

The cold setup currently includes:

- Daytona runtime asset push in [environment.ts:709](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:709).
- Mount setup in [environment.ts:763](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:763).
- Workspace materialization in [environment.ts:871](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:871).
- Capability probing in [environment.ts:934](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:934).
- Native-session load or creation in [environment.ts:1012](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:1012).

`environment.destroy()` also needs decomposition. It currently closes the session, stops or deletes the provider, unmounts storage, cleans workspaces, and removes Pi state in one method at [environment.ts:289](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment.ts:289).

## 2. Fingerprint tiers

I would stop calling the result one fingerprint. Use:

- Content digests for non-secret manifests.
- Explicit generation identifiers for resources.
- Timing-safe secret-material comparison for credentials.
- A structured `AppliedEnvironmentState`.
- A structured delta between desired and applied state.

### Tier table

| Facet | Semantic owner | Normal route | Escalation or caveat |
|---|---|---|---|
| Sandbox provider | Sandbox | Rebuild | Provider changes currently select another pool, potentially leaving the previous provider’s environment parked. The coordinator should explicitly evict or transfer ownership. |
| Harness kind | Product topology policy | Rebuild | Although technically a runtime boundary, the stated product policy promotes it to sandbox rebuild. |
| Image, snapshot, target, immutable provider generation | Sandbox | Rebuild | Becomes `SandboxGenerationId`. |
| Network policy / `sandboxPermission` | Sandbox provider | Live provider reconfigure if strictly supported | Fail closed. Daytona currently treats some network updates as best effort, which is too weak for security policy. Otherwise rebuild. |
| Model selection | Harness session | Apply before next turn | Use `setModel`; promote to session reopen if unsupported. Current entry point is [model.ts:88](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/model.ts:88). |
| Codex mode | Harness session | Apply live | Use `setConfigOption`; promote if unsupported. See [codex-mode.ts:21](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/codex-mode.ts:21). |
| Model provider, endpoint, deployment, process environment | Runtime | Reconfigure or restart runtime, keeping sandbox | Current implementations bake these into daemon environment, so live refresh is not yet available. |
| Model/API credentials | Runtime/provider | Refresh credential delivery, then restart or reconnect affected client | Must never be represented by a normal content hash. Current Daytona create-time secret delivery prevents the desired behavior without a new seam. |
| Instructions | Workspace | Refresh managed files | Active harness observation is explicitly not guaranteed, per the product decision. |
| Pi system and append prompts | Workspace/runtime | Refresh managed files | Pi uses files under its agent directory. If the running process has captured their location or content, visibility remains not guaranteed. |
| Skills | Workspace | Refresh managed files | Pi currently points at content-addressed snapshots. A stable active path or symlink is needed for honest in-place refresh. |
| Harness files | Workspace plus harness-specific owner | Refresh files, then usually reopen session | These files are opaque and may encode security or startup settings. Default to session or runtime escalation unless the adapter classifies them. |
| Tool model-visible catalog | Harness session or runtime | MCP `list_changed` if proven | Claude/Codex currently receive MCP servers at session initialization. Pi tool specs are part of runtime extension configuration, so Pi is runtime-restart today. |
| Tool execution bindings | Turn | Replace before the next turn | Callback, auth, private execution metadata, and relay binding should not require session reload. |
| User MCP server definitions | Harness session | Live notification if supported, otherwise reopen | MCP credential rotation may additionally require client/session recreation. |
| Permission responder policy | Turn | Recompute every turn | This is already derived from incoming request policy. |
| Harness permission configuration files | Workspace/session | Refresh plus reopen | Security-sensitive. Do not accept stale behavior merely because stale instructions are accepted. |
| Callback endpoint and auth | Turn | Rebuild relay binding | The relay currently combines stale `env.plan.tools.toolSpecs` with current callback and run context in [run-turn.ts:822](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/run-turn.ts:822). That split must become atomic. |
| `modelCapabilities` | Turn | Pass through | It is request/telemetry behavior, not environment identity. |
| Messages, `turnId`, context, telemetry | Turn | Pass through | Never environment identity. |
| Revision id, revision version, draft flag | Turn metadata only | Nowhere in compatibility identity | Preserve them in `runContext` for tool binding and observability. Remove them from environment comparison. |
| History fingerprint | Continuity subsystem | Separate admission gate | Do not mix it into environment reconciliation. |
| Credential epoch | Credential subsystem | Produces credential deltas | Keep timing-safe comparison, but replace unconditional eviction with targeted refresh. |
| Mount lease expiry | Mount subsystem | Renew or remount | Keep separate from model and MCP credential identity. |

### Routing algorithm

The router should return an ordered plan, not only a tier:

```text
1. Normalize request into DesiredEnvironmentState + TurnPlan.
2. Diff DesiredEnvironmentState against env.appliedState.
3. Resolve each delta through harness and provider capabilities.
4. If any delta requires sandbox rebuild:
     rebuild, then run the complete cold pipeline.
5. Otherwise:
     refresh mounts and credentials
     refresh managed workspace files
     restart/reconfigure runtime if required
     reopen/load harness session if required
     apply live session settings
6. Build TurnPlan from the incoming request.
7. Run the turn.
8. Park the environment using env.appliedState, never request state.
```

The ordering matters. For example, changed harness files may require both `workspace.refresh` and `session.reopen`.

### Applied state and the approval bug

The pool should not store an independently supplied configuration fingerprint. The environment should own its actual state:

```ts
interface AppliedEnvironmentState {
  generation: number

  sandbox: {
    provider: SandboxProvider
    instanceId: string
    generationId: string
    networkPolicyDigest: string
  }

  runtime: {
    generation: number
    configDigest: string
    credentialMaterial: CredentialMaterial
  }

  mounts: {
    workspaceLeaseExpiresAt?: number
    agentLeaseExpiresAt?: number
  }

  workspace: {
    manifestDigest: string
    files: ReadonlyMap<string, AppliedFile>
  }

  harnessSession: {
    transportSessionId: string
    nativeSessionId?: string
    configDigest: string
    activeModel?: string
    toolCatalogGeneration?: string
  }
}

interface EnvironmentLease {
  readonly appliedState: AppliedEnvironmentState
  commitApplied(result: ReconcileResult): void
  destroy(reason: TeardownReason): Promise<void>
}
```

The pool API should become conceptually:

```ts
pool.park(environment, continuity)
pool.repark(liveSession, continuity)
```

It must not accept `configFingerprint`, credential state, or any other request-derived claim. Compatibility is evaluated against `liveSession.environment.appliedState`.

During approval resume:

- The suspended prompt still belongs to its original applied environment generation.
- Non-safety configuration changes should be deferred until that prompt finishes.
- A model change from `m1` to `m2` must not be recorded unless `setModel(m2)` actually succeeded.
- If the resumed turn pauses again, it remains associated with `m1`.
- After completion, the coordinator can reconcile to `m2` before parking, or retain the pending delta for the next checkout.
- Permission tightening and credential revocation may require immediate fail-closed treatment rather than deferral.

This makes the current bug structurally impossible because there is no request fingerprint parameter available to stamp.

## 3. Harness port and adapter

Do not add these fields to the current `HarnessCapabilities` protocol type. That type describes functional features such as permissions and session loading in [protocol.ts:334](/home/mahmoud/code/agenta-2/services/runner/src/protocol.ts:334). Lifecycle reloadability is runtime- and version-specific.

A concrete port could look like this:

```ts
export type ReconcileMechanism =
  | "no-op"
  | "apply-live"
  | "refresh-workspace"
  | "reopen-session"
  | "restart-runtime"
  | "rebuild-sandbox"
  | "unsupported"

export interface WorkspaceHandling {
  mechanism: "refresh-workspace" | "reopen-session" | "restart-runtime"
  activeSessionObservation:
    | "immediate"
    | "next-turn"
    | "not-guaranteed"
}

export interface HarnessLifecycleCapabilities {
  model: ReconcileMechanism
  mode: ReconcileMechanism
  toolCatalog: ReconcileMechanism
  mcpServers: ReconcileMechanism
  mcpCredentials: ReconcileMechanism

  instructions: WorkspaceHandling
  skills: WorkspaceHandling
  harnessFiles: WorkspaceHandling
}

export interface HarnessRuntimeFacts {
  harness: HarnessKind
  adapterVersion?: string
  protocolVersion?: string
  provider: SandboxProvider
  probedCapabilities: ReadonlySet<string>
}

export interface HarnessAdapter {
  readonly kind: HarnessKind

  capabilities(
    facts: HarnessRuntimeFacts,
  ): HarnessLifecycleCapabilities

  project(
    desired: NormalizedDesiredState,
  ): HarnessDesiredState

  renderWorkspace(
    desired: HarnessDesiredState,
  ): Promise<WorkspaceManifest>

  buildRuntimeSpec(
    desired: HarnessDesiredState,
  ): Promise<HarnessRuntimeSpec>

  buildSessionSpec(
    desired: HarnessDesiredState,
  ): Promise<HarnessSessionSpec>

  applyLive(
    session: AgentSession,
    delta: LiveHarnessDelta,
  ): Promise<AppliedHarnessDelta>

  openSession(
    runtime: AgentRuntime,
    spec: HarnessSessionSpec,
  ): Promise<AgentSession>

  loadSession(
    runtime: AgentRuntime,
    spec: HarnessSessionSpec,
    nativeSessionId: string,
  ): Promise<AgentSession>

  closeSession(session: AgentSession): Promise<void>
}
```

The provider needs its own port. Credential and environment reloadability is not a harness-only concern:

```ts
export interface ProviderLifecycleCapabilities {
  networkPolicy:
    | "reconfigure-live"
    | "rebuild-sandbox"

  runtimeEnvironment:
    | "restart-runtime"
    | "rebuild-sandbox"

  credentialDelivery:
    | "refresh-live"
    | "restart-runtime"
    | "rebuild-sandbox"
}

export interface SandboxProviderAdapter {
  readonly kind: SandboxProvider

  capabilities(): ProviderLifecycleCapabilities

  create(spec: SandboxCreateSpec): Promise<SandboxHandle>
  reconnect(pointer: SandboxPointer): Promise<SandboxHandle>

  reconfigure(
    sandbox: SandboxHandle,
    delta: SandboxMutableDelta,
  ): Promise<AppliedSandboxDelta>

  restartRuntime(
    sandbox: SandboxHandle,
    spec: HarnessRuntimeSpec,
  ): Promise<AgentRuntime>

  stop(sandbox: SandboxHandle): Promise<void>
  destroy(sandbox: SandboxHandle): Promise<void>
}
```

Every mutation returns what was actually applied. The reconciler updates `AppliedEnvironmentState` only from those results.

### Current adapter matrix

> **Superseded by `contracts/adapter-matrix.md` (decided).** This table predates the
> uniform-reopen decision and the Pi MCP `unsupported` finding. Read it for the reasoning
> that led there, not for current per-harness capability values.

| Harness | Model | Tool/MCP catalog | Instructions and skills | Harness files |
|---|---|---|---|---|
| Pi | Likely `apply-live` through generic `setModel`, but must be tested | `restart-runtime` today because public tool specs and extension setup are startup assets in [pi-assets.ts:341](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/pi-assets.ts:341) | Refresh files; active observation not guaranteed | Adapter-specific, default runtime restart |
| Claude | Likely `apply-live`, with reopen fallback | `reopen-session` until S2 proves MCP list change support | Refresh files; active observation not guaranteed | Default session reopen because settings can affect permissions/startup |
| Codex | Model `apply-live`; mode through `setConfigOption` | `reopen-session` until S2 proves live discovery | Refresh files; active observation not guaranteed | Default session reopen; some `CODEX_HOME` changes may require runtime restart |

“Likely” matters here. The runner exposes the calls, but the adapter/version must prove the behavior. Capabilities should be versioned or probed, with a conservative fallback.

The current non-Pi MCP server list is supplied through session initialization in [mcp.ts:329](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/mcp.ts:329). Pi uses a different extension/relay path. A single global `supportsToolReload` boolean would erase that distinction.

Tools should also be split using the existing public/private distinction in [public-spec.ts:1](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/tools/public-spec.ts:1):

- `ToolCatalogManifest`: what the model sees.
- `ToolExecutionPlan`: callback, credentials, routing, private metadata.

Both should carry one catalog generation. A turn must never advertise generation N while the relay executes generation N+1.

## 4. Module layout

Suggested target:

```text
services/runner/src/
  server.ts

  lifecycle/
    session-coordinator.ts
    reconciliation-router.ts
    reconciliation-plan.ts
    applied-state.ts
    desired-state.ts
    state-diff.ts
    approval-resume.ts
    teardown-policy.ts

  pool/
    session-pool.ts
    environment-lease.ts

  identity/
    pool-key.ts
    history-continuity.ts
    credential-material.ts
    mount-lease.ts
    content-digest.ts

  environment/
    environment-controller.ts
    sandbox-lifecycle.ts
    runtime-lifecycle.ts
    mount-lifecycle.ts
    workspace-manager.ts
    harness-session-lifecycle.ts
    timing.ts

  harnesses/
    port.ts
    registry.ts
    pi-adapter.ts
    claude-adapter.ts
    codex-adapter.ts

  providers/
    port.ts
    local-provider.ts
    daytona-provider.ts

  turns/
    turn-plan.ts
    turn-runner.ts
```

### What moves where

`server.ts` should retain:

- HTTP and SSE handling.
- Authentication and request decoding.
- Concurrency/watchdog handling.
- Calling `SessionCoordinator.run(request)`.

The dispatch, warm gate, approval resume, eviction choice, and re-parking logic at [server.ts:359](/home/mahmoud/code/agenta-2/services/runner/src/server.ts:359) through [server.ts:936](/home/mahmoud/code/agenta-2/services/runner/src/server.ts:936) move into `session-coordinator.ts`.

`session-pool.ts` remains a map, lease, and timer implementation. It should not know why two configurations are compatible.

`session-identity.ts` should be dissolved into its real concerns:

- Pool key.
- History continuity.
- Credential material comparison.
- Mount leases.
- Generic content digest helpers.

`environment-setup.ts` should become a pure planner. It currently derives the plan but also mutates Pi state and constructs daemon environment in [environment-setup.ts:168](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/environment-setup.ts:168). Those side effects belong to runtime and workspace controllers.

`environment.ts` becomes a thin `EnvironmentController` that composes the lifecycle units. It should not contain provider creation, workspace I/O, session setup, model mutation, listener installation, and teardown policy in the same module.

`run-turn.ts` remains the turn engine, but it must receive a fresh `TurnPlan`. It should not read stale request-derived tool configuration from `env.plan`.

Dependency direction:

```text
server
  -> SessionCoordinator
       -> SessionPool
       -> ReconciliationRouter
       -> EnvironmentController
       -> TurnRunner

EnvironmentController
  -> SandboxProviderPort
  -> HarnessAdapter
  -> WorkspaceManager
  -> MountLifecycle

Adapters do not import server or pool policy.
```

## 5. Migration path

Each step can ship independently.

### 1. Characterization and narrow safety fixes

- Add regression tests for revision-only, draft-only, approval/model-change, credential-change, and teardown behavior.
- Remove workflow revision id, revision version, and draft flag from the current environment fingerprint.
- Introduce distinct teardown reasons:
  - `session-incompatible`
  - `runtime-incompatible`
  - `sandbox-incompatible`
  - `continuity-invalid`
- Map only known session/workspace incompatibilities to Daytona `stop`.
- Keep true sandbox incompatibility mapped to `destroy`.
- When destroying, atomically clear the reconnect pointer so the next acquire does not attempt the deleted sandbox.

Do not make a blind one-line change that maps every `compatibility-mismatch` to stop. Credentials and Pi runtime assets would then survive in a stale daemon.

### 2. Make identity environment-owned

- Add `AppliedEnvironmentState` to `SessionEnvironment`.
- Initialize it from the successful cold-acquire results.
- Remove `configFingerprint` and credential inputs from `park` and `repark`.
- Make reconciliation the only code allowed to commit applied state.
- Add the critical regression:
  - Park with model `m1`.
  - Resume an approval with request `m2`.
  - If no successful `setModel(m2)` occurred, the environment remains applied as `m1`.
  - The following checkout must see an `m1 -> m2` delta.

This kills the approval bug class before changing the broader routing behavior.

### 3. Extract the coordinator

Move the warm gate, approval path, miss path, eviction, and re-parking policy out of `server.ts`. Preserve current behavior.

Keep history continuity and credential checks exactly as they are during this extraction.

### 4. Introduce normalized desired state and shadow routing

- Split the request into semantic facets.
- Calculate facet-level deltas.
- Run the new router in shadow mode.
- Compare its proposed boundary against current cold/warm decisions in logs and tests.
- Initially route all material configuration changes to the existing cold path.

This lets naming and ownership stabilize without silently changing reuse behavior.

### 5. Split `environment.ts` into lifecycles

Extract sandbox, runtime, mounts, workspace, and harness-session controllers. Preserve behavior and old timing metrics, while adding the new event names.

Implement `session.reopen` on the same sandbox before enabling it for any delta.

### 6. Enable low-risk in-place routes

In order:

1. Revision/draft metadata no longer affects reuse.
2. Instructions refresh.
3. Skill refresh.
4. Model `setModel` before the next ordinary turn.
5. Codex mode live update.
6. Claude/Codex MCP and tool changes reopen the harness session on the same sandbox.
7. Pi tool changes restart the runtime on the same sandbox.

Workspace refresh must be manifest-based, including deletions. The current `prepareWorkspace` mainly writes desired files in [workspace.ts:56](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/workspace.ts:56); it does not robustly remove files or skill directories that disappeared from the request.

### 7. Integrate Spike S2

Flip `toolCatalog` from `reopen-session` to `apply-live` only for the exact harness/version combinations proven to handle MCP `tools/list_changed`.

Keep the fallback declaration in the adapter. This should be a capability-data change, not another coordinator rewrite.

### 8. Implement credential/runtime refresh

This is a real feature, not a fingerprint change:

- Separate credential material by consumer.
- Refresh mount credentials independently.
- Define how model credentials reach an already-created Daytona sandbox or restarted daemon.
- Restart only the runtime where live injection is impossible.
- Reopen MCP clients when their header credentials change.
- Commit the new credential material only after successful refresh.

Until this exists, the current safe fallback for some Daytona credential changes remains rebuild, contrary to the desired product behavior.

### 9. Split Daytona creation identity

The current Daytona create fingerprint hashes the full create request and secret plan in [provider.ts:95](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/provider.ts:95), and reconnect destroys the sandbox when it differs in [daytona-secret-provider.ts:212](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/daytona-secret-provider.ts:212).

Replace it with:

- `SandboxGenerationId`: provider, image/snapshot, target, immutable topology.
- `AppliedNetworkState`.
- `AppliedRuntimeState`.
- Private `AppliedCredentialMaterial`.
- Operational settings such as lifecycle timeouts, explicitly classified as mutable or next-create-only.

On reconnect:

- Generation mismatch means destroy and recreate.
- Mutable-state mismatch means reconnect and reconcile.
- Failed reconciliation leaves applied state unchanged and fails closed.

## 6. Top risks

1. **Stamped-but-not-applied state**

   Any API that lets callers supply the new identity recreates the approval bug. Applied state must be committed only from successful lifecycle results.

2. **Approval resumes are in-flight turns**

   Applying a new model, tool catalog, or runtime while a tool call is awaiting approval can split one logical turn across configurations. Defer ordinary changes until the prompt finishes. Treat policy tightening and credential revocation separately.

3. **Advertised tools and executed tools can diverge**

   Today the relay can use `env.plan.tools.toolSpecs` while callback and run context come from the incoming request. Catalog and execution plan need one atomic generation.

4. **Credential refresh is not currently supported by every runtime**

   Daytona environment and secret attachment are create-time concepts today. Renaming them “turn-tier” does not make them refreshable. The provider port must expose a real operation or retain a safe rebuild fallback.

5. **Workspace refresh can leave stale files**

   Removed skills, instructions, and harness files must be deleted. Use a runner-owned manifest and atomic replacement where possible. Never recursively clean user-owned workspace content.

6. **Pi’s skill path is content-addressed**

   New content produces another snapshot, but the running process may still point at the previous digest. Use a stable active path/symlink or classify the update as runtime restart. See [pi-assets.ts:113](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/pi-assets.ts:113).

7. **Security policy may be accidentally treated like ordinary config**

   Runner approval policy can be per-turn, but harness preapproval files and sandbox network rules are longer-lived. Tightening must take effect or fail closed before execution continues.

8. **History continuity can be damaged during session reopen**

   Keep [session-continuity.ts](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/session-continuity.ts) and the history fingerprints separate from configuration reconciliation. A successful transport reopen does not itself prove native history was loaded.

9. **Credential epoch and mount expiry can be conflated**

   Preserve the existing nonlogging, timing-safe credential comparison in [session-identity.ts:512](/home/mahmoud/code/agenta-2/services/runner/src/engines/sandbox_agent/session-identity.ts:512). Credential rotation should generate consumer-specific deltas; mount expiry should generate a mount-renewal action.

10. **Provider changes can leak parked environments**

    Local and Daytona currently use separate pools in [server.ts:943](/home/mahmoud/code/agenta-2/services/runner/src/server.ts:943). Switching providers may create a second live environment while the first waits for TTL. A global session registry or explicit cross-provider eviction is needed.

11. **Capability claims can drift by harness version**

    A generic ACP method existing does not prove Pi, Claude, and Codex implement it identically. Capability declarations should include the adapter/protocol version and use conservative fallbacks.

12. **Partial reconciliation**

    Workspace refresh may succeed and session reopen may fail. The reconciler must either record the successfully applied subset accurately or run compensating recovery. It must never stamp the final desired digest after partial success.

The key architectural rule is: **requests describe desired state; environments own applied state; adapters define the cheapest valid transition between them.** That gives you the routing flexibility you want without turning fingerprints into another source of truth.


