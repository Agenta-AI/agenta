# Sandbox gateway acceptance tests

Status: proposed executable contract for local, Docker Sandboxes, Daytona, E2B,
and Kubernetes Agent Sandbox.

## 1. Test philosophy

One suite runs against every adapter. Capability-dependent cases are not ordinary
skips:

- **baseline cases** must pass for every enabled provider;
- **supported-capability cases** must pass when the provider advertises native,
  emulated, or experimental support;
- **unsupported-capability cases** must prove acquire fails before allocation when
  the request requires that capability;
- **provider-profile cases** prove mappings, cleanup, and security facts unique to
  that provider.

A provider cannot change common tests. It supplies a fixture and expected
capability profile. A discrepancy between declaration and behavior fails the run.

## 2. Harness contract

```python
class LiveSandboxProviderFixture(Protocol):
    route: str
    expected_capabilities: SandboxCapabilities

    async def reset(self) -> None: ...
    async def list_provider_resources(self, correlation: str) -> list[str]: ...
    async def disrupt(self, action: ProviderDisruption) -> None: ...
    async def inspect_runtime(self, sandbox_id: UUID) -> RuntimeInspection: ...
    async def read_provider_usage(self, sandbox_id: UUID) -> UsageInspection: ...
```

Provider secrets come from CI secret stores and are never included in snapshots
or reports. Every test uses a unique correlation ID and records pre/post provider
resource inventories. A finalizer terminates the logical sandbox and separately
checks for leaked provider resources.

Recommended markers:

```text
@pytest.mark.sandbox_gateway
@pytest.mark.provider_local
@pytest.mark.provider_docker_sbx
@pytest.mark.provider_daytona
@pytest.mark.provider_e2b
@pytest.mark.provider_agent_sandbox
@pytest.mark.live_provider
@pytest.mark.destructive_provider
```

## 3. Baseline matrix

| ID | Acceptance | Observable result |
| --- | --- | --- |
| B01 | Catalog namespace | Route appears in builtin/standard/custom list with correct immutability and no control URL/secret |
| B02 | Idempotent acquire | Same project/key/request yields one logical sandbox, one provider resource, and the same operation result |
| B03 | Opaque identity | Response exposes logical ID/generation but no provider ID, host, token, pod, VM, or container name |
| B04 | State convergence | Operation reaches `ready`; desired and observed state plus readiness timestamps are coherent |
| B05 | Writer lease | Same holder reacquires idempotently; another holder conflicts and does not mutate provider state |
| B06 | Exec | stdout/stderr ordering, exit code, timeout, cancellation, and large stream behavior survive relay |
| B07 | Files | create/read/list/stat/rename/delete and traversal rejection work through data plane |
| B08 | ACP | Initialize, prompt stream, tool event, human approval pause, reply, completion, and reconnect work |
| B09 | Endpoint ticket | Wrong project/sandbox/endpoint/operation/audience fails; expiry fails; renewal issues a distinct ticket |
| B10 | Generation revocation | Replace or terminating transition makes the old ticket stale before provider deletion completes |
| B11 | Lease expiry | Expiry applies pause/terminate disposition once and rejects later endpoint resolution |
| B12 | Idempotent terminate | Repeated delete succeeds; tickets/leases revoke; provider resource and endpoints disappear |
| B13 | Crash recovery | Kill control worker during create/delete; restarted reconciler completes without duplicates or leak |
| B14 | Provider not found | External provider deletion converges to terminated/failed policy without recreate surprise |
| B15 | Redaction | API, operation row, events, runner request, process env, logs, traces, and support bundle contain no forbidden material |
| B16 | LLM gateway | Streaming model call succeeds using only scoped Agenta credential; upstream key is absent in sandbox |
| B17 | MCP gateway | Initialize/list/call succeeds through Agenta MCP gateway; upstream header is absent in sandbox |
| B18 | Usage correlation | Lifecycle and runtime usage event includes logical ID, generation, route, operation, and dedupe key |
| B19 | Admission failure | Unsupported required capability returns 422 before provider resource count changes |
| B20 | Orphan reaping | Labeled orphan is detected, audited, and removed without touching an unrelated provider resource |

## 4. Lifecycle capability cases

| ID | Requires | Scenario |
| --- | --- | --- |
| L01 | pause/resume | Write sentinel, pause, observe paused, reject data ticket, resume, replay bootstrap, read sentinel |
| L02 | pause/resume | Restart gateway while paused; resume by logical handle without runner/provider memory |
| L03 | reconnect | Restart runner and data plane; resolve a new ticket and continue same ACP/FS state |
| L04 | snapshot | Snapshot exact revision, mutate, create replacement, verify snapshot content and new generation |
| L05 | activity renewal | Sustained valid traffic renews configured idle deadline but cannot exceed max lifetime |
| L06 | replace | Induce terminal provider state; replacement creates one new generation and revokes old endpoints |

When a route reports pause unsupported, a request with
`required_capabilities={pause_resume}` must execute B19. The test is not skipped.

## 5. Network and credential cases

| ID | Acceptance |
| --- | --- |
| S01 | Default-deny blocks an unlisted host and permits the exact listed host |
| S02 | IP literal, DNS rebinding candidate, metadata address, redirect, alternate port, and wildcard edge cases do not bypass policy |
| S03 | Opaque HTTP binding injects on exact scheme/host/port/method/path and nowhere else |
| S04 | Workload sees only fake/empty placeholder; `/proc`, env, files, command args, diagnostics, snapshot, and logs reveal no real secret |
| S05 | Broker revision update is atomic: requests see old or new complete revision, never a partial mixture |
| S06 | Broker/sidecar restart clears state; sandbox is non-ready until trusted replay acknowledges desired revision |
| S07 | Revocation blocks new credential use before sandbox/provider termination |
| S08 | `local_use` is available only to the declared process/invocation and is labeled workload-readable in audit |

Providers without network enforcement or opaque injection must reject specs that
require them. LLM/MCP gateway tests still run because they require only reachability
to Agenta gateways and no upstream key in the sandbox.

## 6. FS attachment cases

These are cross-gateway tests and run after the FS gateway common-contract and
attachment checkpoint. The same payloads run with S3-compatible and
ArtifactFS-compatible backend implementations.

| ID | Acceptance |
| --- | --- |
| F01 | Core-resolved FS bindings attach and every required attachment reaches healthy revision before sandbox becomes ready |
| F02 | Write in generation 1, pause/replace/reconnect as supported, attach generation 2, read same bytes |
| F03 | Expired private backend authority triggers FS-gateway renew/remount without exposing credentials or backend kind to runner |
| F04 | Dead/stale FUSE mount detaches before retry and never shadows the target with an unusable mount |
| F05 | Required failure prevents ready; optional failure yields degraded with explicit reason |
| F06 | Read-only attachment rejects writes from workload and gateway file API |
| F07 | Consumers cannot escape the FS bindings and paths authorized by core configuration |
| F08 | Terminate detaches but preserves/deletes each FS according to its origin-scope retention policy, exactly once |
| F09 | Swapping S3-compatible and ArtifactFS-compatible backends leaves the sandbox request and common file behavior unchanged |
| F10 | Project/agent/session and one-off sources produce the same generic sandbox binding shape; neither gateway interprets the source association |

## 7. Provider profiles

### 7.1 `builtin/local`

Run on every PR or local CI:

1. Verify one child process group and loopback listener are created.
2. Verify unknown/reused PID birth marker is not adopted.
3. Kill child externally; observation detects loss and policy decides failed versus
   replacement.
4. Termination kills descendants and frees the port.
5. Require network deny, pause, or VM isolation and assert 422 before spawn.
6. Run full ACP approval flow and runner restart using only logical handle.

### 7.2 `builtin/docker-sbx`

Run on dedicated hosts with Docker Sandboxes installed:

1. Probe `sbx` daemon/version and fail availability cleanly when absent.
2. Create from an approved template and assert provider resource correlation.
3. Bootstrap sandbox-agent; exec and ACP through published data endpoint.
4. Assert microVM isolation facts available to the fixture: separate daemon,
   blocked host daemon/network, and only declared workspace visibility.
5. Default to clone/private workspace for the untrusted profile; assert direct
   workspace mode requires explicit approval.
6. Stop/restart and verify private VM state plus attachment revalidation.
7. Exercise host-side network policy and credential injection without raw key in VM.
8. `sbx rm` removes the sandbox/VM; no shared skills mount unless requested.

The provider profile follows the official [Docker Sandboxes architecture](https://docs.docker.com/ai/sandboxes/architecture/)
and [security model](https://docs.docker.com/ai/sandboxes/security/).

### 7.3 `standard/daytona`

1. Create with snapshot/resources/auto-lifecycle settings and observe normalized states.
2. Apply default-deny egress and exact allow rule; reconnect with a changed policy
   and verify convergence.
3. Resolve sandbox-agent preview/service endpoint without exposing preview token.
4. Stop/start, gateway restart, bootstrap replay, and sentinel persistence.
5. Rotate provider/customer binding and prove no process-local registry is needed.
6. Force terminal/not-found states and verify new generation or termination policy.
7. Poll usage twice and assert event dedupe.
8. Delete before provider auto-delete and after provider auto-delete; both converge.

### 7.4 `standard/e2b`

1. Create from pinned template containing sandbox-agent; resolve its port and run ACP.
2. Use native commands/files/PTY for diagnostic bootstrap, then standard data plane.
3. Connect after runner/gateway restart using internal E2B ID; envd token never leaves
   adapter/data plane.
4. If live probe advertises pause, run L01/L02; otherwise assert required pause rejects.
5. If snapshot advertised, verify exact sentinel snapshot; otherwise assert admission rejection.
6. Kill externally and normalize not-found.
7. Verify `allow_internet_access`/network capability matches declaration rather than
   assuming fine-grained egress.
8. Kill idempotently and check no live sandbox by correlation metadata.

### 7.5 Kubernetes Agent Sandbox

Run a fast Kind profile and a production-runtime profile:

1. Register `builtin/agent-sandbox` for Agenta cluster and `custom/test-cluster`
   for the same installed adapter; verify namespace semantics and custom CRUD.
2. Cold claim from zero-sized pool and warm claim from populated pool; observe
   correct sandbox/pod ownership and latency metrics.
3. Route ACP/files through Gateway/Router; spoofed sandbox ID/pod IP and cross-
   namespace target are rejected.
4. Suspend/resume with `operatingMode`; pod recreation triggers attachment and
   credential replay before ready.
5. Delete backing pod while running; controller recovery never routes the logical
   sandbox to an unrelated pod.
6. Assert NetworkPolicy permits only router/control/broker paths and declared egress.
7. Assert no Kubernetes API service-account token in the sandbox pod by default.
8. Run gVisor or Kata production profile and confirm reported isolation class.
9. Attach PVC via approved template; test persistence and retention on claim delete.
10. Delete claim and verify tenant pod/service plus non-retained PVC cleanup.

The security cases follow the project's [threat model](https://github.com/kubernetes-sigs/agent-sandbox/blob/main/docs/security/threat_model.md)
and current [v1beta1 quickstart objects](https://github.com/kubernetes-sigs/agent-sandbox/blob/main/examples/quickstart/README.md).

## 8. Failure injection matrix

Every provider fixture should implement what it can and declare unsupported
disruptions separately from product capabilities.

| Disruption | Expected gateway behavior |
| --- | --- |
| Provider create timeout after remote success | Observe/adopt by idempotency correlation; never allocate a second resource blindly |
| Control worker crash after provider create | Restart operation, observe resource, continue bootstrap |
| Data-plane restart | Existing connection ends; new ticket reconnects without lifecycle mutation |
| Endpoint becomes unreachable | Generation degrades; tickets stop minting; bounded probe/recovery |
| Broker restart | Bootstrap revision stale; block ready/use until replay |
| FS mount daemon death | Attachment unhealthy; refresh/detach/remount through FS gateway |
| Provider reports unknown state | Fail closed, preserve evidence, do not guess running/terminated |
| Terminate timeout | Reconciler retries; tickets remain revoked; orphan reaper owns eventual cleanup |
| Database unavailable | No new provider mutation without durable operation intent |
| Event pipeline unavailable | Lifecycle safety continues; audit/usage buffers or records explicit delivery failure |

## 9. Release gates

A provider is enabled only when:

1. baseline B01-B20 pass;
2. every advertised capability case passes;
3. every required unsupported case proves pre-allocation rejection;
4. provider-specific cleanup leaves zero correlated resources across repeated runs;
5. secret/redaction scan passes with canary values;
6. ACP long-stream, approval-pause, cancellation, and reconnect soak tests pass;
7. gateway restart and provider external-deletion drills pass;
8. an operator runbook covers probe, disable-new-placement, inspect, revoke, reap,
   and provider outage recovery.
