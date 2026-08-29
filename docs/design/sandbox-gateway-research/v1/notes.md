# Notes and open questions

Status: working notebook. Entries are proposals unless marked decided.

## Working positions

### WP-01: sandbox gateway is a resource gateway

It shares policy infrastructure with LLM and MCP gateways but owns a separate
stateful lifecycle domain and several data-plane protocols.

### WP-02: all clients use a logical handle

Provider IDs stay internal. A logical handle can outlive a provider generation;
endpoint tickets cannot.

### WP-03: ACP is a standard endpoint

The runner resolves an `acp` endpoint and no longer imports provider lifecycle or
mount semantics. Long-lived approvals and streams are requirements from day one.

### WP-04: LLM and remote MCP credentials stay in their gateways

The sandbox receives Agenta routes and short-lived Agenta credentials. This is
the cleanest way to eliminate the most common upstream keys from the runner wire
without inventing another credential store.

### WP-05: outbound credentials are desired state

Persist binding rules and secret references. Broker values are volatile and
replayed by revision after create/resume. `local_use` is a separate, visibly
weaker class.

### WP-06: mount readiness is sandbox readiness

A sandbox with a required dead or stale durable mount is not ready. Optional
mounts may produce a degraded state if the request declared that behavior.

### WP-07: local is development-only by default

Local execution can be valuable for development, but its capability declaration
must not claim workload/host isolation or restricted networking it cannot prove.
A future Docker adapter should be named and assessed independently.

## Decisions needed later

1. Is relay mode mandatory for all endpoint kinds, or can exec/files/ACP use
   delegated provider endpoints by default?
2. Does a logical sandbox belong to a project, user, workflow session, or a
   combination with explicit sharing grants?
3. Is a lease one-to-one with an agent run, or may several authorized runs hold
   independent leases on one sandbox?
4. What is the concurrency contract: exclusive writer, multiple sessions, or
   endpoint-specific locking?
5. Does pause preserve the same generation or create a new generation with a
   stable provider reference and new bootstrap revision?
6. Which component signs endpoint tickets, and how are tickets revoked before
   expiry?
7. Should endpoint authorization use a JWT capability, an opaque lookup token,
   mTLS workload identity, or a combination?
8. Which sandbox events belong in the shared gateway audit envelope, and which
   high-volume data-plane events need a separate telemetry channel?
9. Which adapters may back custom endpoints, how are those adapters installed and
   upgraded by operators, and what endpoint probes and vault grants are required?
   A project-supplied URL and provider key are insufficient as a trust model.
10. Do we operate our own OpenSandbox control/data plane, support a compatible
    endpoint as a provider, or use only its architectural patterns?
11. How should stdio MCP credentials be delivered: per-exec local-use secret,
    memory file, brokered local socket, or hosted MCP bridge?
12. Can object-store access use a proxy/service binding for every deployment, or
    must the first version preserve STS-backed geesefs inside some sandboxes?
13. Where does metering authorization occur for resume and lease renewal, and how
    do push and poll providers reconcile duplicate usage events?
14. What is the recovery authority when provider state says running but Agenta
    state says terminating?

## Experiments before an implementation plan

### E-01: ACP through candidate data-plane proxies

Run representative long conversations, streaming output, cancellation, human
approval pauses, runner reconnect, and WebSocket/HTTP variants through Envoy or
the chosen proxy. Measure backpressure, idle timeouts, maximum headers, and memory
per connection.

### E-02: credential broker compatibility

Test OpenAI-compatible SSE, Anthropic streaming, representative MCP Streamable
HTTP, redirects, HTTP/2, large chunks, proxy environment behavior, certificate
trust, and exact host/path matching. Confirm secrets never appear in workload
environment, request logs, traces, crash dumps, or snapshots.

### E-03: resume matrix

For Daytona, E2B, OpenSandbox Docker, and OpenSandbox Kubernetes: create, mount,
install credential bindings, start ACP, pause/stop, restart gateway components,
resume, rotate credentials, and reconnect. Record which state survives and which
must be replayed.

### E-04: mount failure matrix

Exercise expired STS, dead FUSE process, stale mountpoint, provider restart,
network partition, concurrent writer, read-only mount, subpath isolation, and
termination during remount. Preserve current fail-loud recovery behavior.

### E-05: capability conformance kit

Define black-box tests for lifecycle, files, exec, PTY, port proxy, network deny,
endpoint authorization, credential redaction, mount behavior, usage events, and
cleanup. Run the same kit against every adapter and publish gaps.

### E-06: runner-wire redaction

Capture the service-to-runner request and all spawned process environments before
and after LLM/MCP gateway composition. Assert that upstream keys, MCP headers,
object-store credentials, and provider-control credentials are absent from the
new contract.

## Questions for product and operations

- Is a sandbox a visible reusable product resource or an internal implementation
  detail of an agent session?
- Which actions require human consent: public port exposure, unrestricted
  egress, local-use secret delivery, dangerous FS mode, snapshot export?
- What retention promise applies to paused FS instances, snapshots, and mounted
  object storage?
- Are customers allowed to bring a provider account, or only choose an
  Agenta-operated provider?
- Which regions, data residency controls, and isolation classes must the handle
  expose without leaking the provider?
- What are acceptable create, resume, and first-ACP-instruction latency targets?
- How much provider degradation should be visible to a user versus retried by the
  reconciler?

## Terminology cautions

- **Gateway** does not necessarily mean every byte crosses the API process.
- **Handle** means stable identity, not a permanent bearer token.
- **Opaque secret** means sandbox code cannot recover the upstream value; a
  placeholder environment variable alone does not prove this.
- **Local sandbox** currently means a local child process, not a Docker container
  and not a production isolation boundary.
- **FS persistence** and **sandbox persistence** are independent. A
  sandbox may be replaceable while its scoped FS persists.
- **Paused** is a provider state. **Ready** is an Agenta state reached only after
  bootstrap reconciliation.
