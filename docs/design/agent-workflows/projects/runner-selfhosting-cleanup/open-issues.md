# Open issues

These items are intentionally deferred. They should become focused design projects or tracked implementation issues rather than expanding the cleanup.

## RSH-1: Docker sandbox provider

Source: PR #5285.

Build the Docker provider on the typed provider registry and lifecycle-capability interface. Resolve Docker socket trust, per-session container identity, label-driven garbage collection, Linux host networking, durable mounts, and multi-replica ownership.

Does not block: configuration cleanup, local provider, Daytona provider.

## RSH-2: Code-evaluator Daytona namespace

The code evaluator still needs its own explicit Daytona configuration and snapshot/image contract. It must not inherit the agent runner's credential or artifact default.

Proposed owner: code-execution runtime.

Does not block: removing shared names from the agent runner if the evaluator gets a coordinated rename in its own PR.

## RSH-3: Provider-approved remote subscription authentication

Obtain written guidance from OpenAI and Anthropic for third-party clients, storage, remote sandbox execution, multi-device use, and organization deployments. Only then design an explicit remote-auth product contract.

No implementation or tutorial should precede that decision.

## RSH-4: Declarative bootstrap assets, hooks, and network plugins

Version 1 ships no bootstrap manifest at all: local subscription state arrives through an operator-owned read-only Compose mount, and runtime customization happens through images and snapshots. If operator demand shows a real need for declarative per-run file assets (typed manifest, validation, Daytona upload of non-auth files), design it then, together with hooks: repository checkout, VPN enrollment, certificate rotation, custom initialization.

A future design must define:

- trust and execution user;
- ordering and idempotency;
- timeout and cancellation;
- secrets and log redaction;
- local versus remote parity;
- network policy interaction;
- image-build alternatives.

## RSH-5: Secret-manager bootstrap sources

Version 1 reads mounted files. Helm users may want Kubernetes Secret references and external secret-store integrations without materializing a broad shared environment.

Add typed source variants only after the file contract is stable.

## RSH-6: Multi-runner scheduling and ownership

Multiple replicas need provider-aware capacity, session ownership, warm-sandbox adoption, and capability aggregation. A single logical runner deployment is enough for the current cleanup.

## RSH-7: Runner capability discovery endpoint

Version 1 has no `GET /capabilities` endpoint. API and runner read the same enabled-provider value from one deployment entry, and the runner stays the final authority. Build the endpoint (with caching, versioning, and platform exposure) when deployments have multiple heterogeneous runners and one shared value stops being true, not before.

## RSH-8: Local isolation provider

Trusted local is intentionally unconfined. Docker, Landlock, bubblewrap, or another provider can offer isolation later. Do not relabel the current local provider as secure.

## RSH-9: Mount viewer UX

PR #5274 did not add mount-viewer UI. The product still needs an explicit UX for session files, agent files, nesting, empty states, and mount failures. That work is separate from making runtime mounts reliable.

## RSH-10: Custom mount-role documentation

The product is pre-production, so this cleanup does not add a compatibility bridge for old custom permission lists. Before public RBAC customization ships, document the final mount permissions and add a role-validation diagnostic.

## RSH-11: Fail-loud required mounts

Version 1 keeps best-effort mount behavior and adds one structured warning when a durable mount degrades to an ephemeral directory. The deferred contract: a session, workflow-artifact, or resumable-session run whose required mount cannot be signed or mounted fails the run instead of silently continuing on ephemeral storage. Use the warning-log data to size the problem and to catch race conditions before making failures hard.

## RSH-12: Runner secret narrowing in shared-env deployments

A deployment that delivers one shared environment file to every container exposes the runner token and the Daytona key to services that do not need them. Daytona-only deployments tolerate this for now because no user code runs in the runner container. The follow-up hardening: a dedicated runner secret, no shared environment file on the runner, and FUSE privilege removal where local mounts are not needed. Run it as its own project after the release.
