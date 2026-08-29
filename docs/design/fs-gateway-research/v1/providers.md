# FS backend and route profiles

Status: proposed placement/catalog model.

## 1. Two different classifications

Backend kind and route namespace answer different questions:

- **Backend kind** says which private implementation supplies the FS
  contract: `s3_compatible` or `artifactfs_compatible`.
- **Route namespace** says who governs the endpoint: `builtin`, `standard`, or
  `custom`.

Product association is outside this classification and outside the FS gateway.

| Route example | Namespace | Private backend kind |
| --- | --- | --- |
| `builtin/agenta` | builtin | S3-compatible |
| `builtin/artifacts` | builtin | ArtifactFS-compatible |
| `standard/aws` | standard | S3-compatible |
| `standard/cloudflare-storage` | standard | S3-compatible |
| `custom/private-storage` | custom | S3-compatible |
| future managed ArtifactFS route | standard/custom | ArtifactFS-compatible |

Ordinary clients may select a route or accept placement policy, but they always
create and operate a `FS`. Only operator diagnostics need the backend
kind.

## 2. Common route requirements

A route cannot be enabled until it demonstrates:

- the full common path and directory contract;
- isolation between opaque security partitions and FS instances;
- opaque version and revision behavior;
- idempotent create, mutation recovery, archive, and delete;
- short-lived authority and credential redaction;
- attachment lease revoke and orphan cleanup;
- declared limits for size, throughput, consistency, and concurrent writers.

Optional capabilities do not compensate for a failed common contract.

## 3. Builtin

Builtin routes are operated by Agenta or by the deployment. They are generated
from deployment configuration, have no ordinary caller-editable endpoint row,
and can be used as policy defaults.

### `builtin/agenta`

This is the compatibility and first production route. It presents current mount
content through the FS contract while privately reusing the configured
S3-compatible store, existing storage roots, scoped authority logic, and geesefs
where required.

The public route does not expose that implementation. A future deployment may
move the route to another conforming backend without changing FS IDs or
callers, subject to an explicit data migration.

### `builtin/artifacts`

A later route operated with an ArtifactFS-compatible service/controller. It must
pass the same common suite before optional revision, refresh, hydration, or
commit extensions are advertised.

## 4. Standard

Standard routes are maintained integrations with canonical endpoint derivation,
credential-binding flows, health checks, and documented operational limits.
Projects bind an account/credential; they do not supply arbitrary endpoint URLs.

Initial candidates:

- `standard/aws`, privately backed by S3-compatible AWS storage;
- `standard/cloudflare-storage`, privately backed by an S3-compatible
  Cloudflare storage endpoint.

Names should describe the maintained service integration without changing the FS
data model. Region, account, bucket/container policy, credential exchange, and
backend limitations live in route configuration and operator diagnostics.

## 5. Custom

Custom routes are administrator-approved instances of installed backend adapter
kinds. They allow private MinIO, SeaweedFS, other compatible storage services, or
a future remotely operated ArtifactFS-compatible service.

A custom route stores:

- adapter kind and version;
- validated endpoint configuration;
- TLS and network-egress policy;
- vault secret reference;
- capability/conformance result and timestamp;
- security-partition allowlist;
- lifecycle and rotation state.

It never stores arbitrary executable adapter code or plaintext credentials.
Authorized callers select an approved slug and cannot mutate endpoint or trust
policy.

## 6. S3-compatible implementation

This implementation treats the backend as persistence for an FS, not as
the public API. It must supply gateway directory and mutation semantics through a
private combination of key layout, manifests, journals, conditional operations,
tombstones, and recovery.

Private implementation concerns include:

- physical allocation and root isolation;
- directory representation;
- large-file streaming and multipart operations;
- optimistic concurrency token translation;
- recoverable copy/move/delete;
- exact-FS-root temporary authority;
- FUSE behavior and stale-mount cleanup;
- backend consistency and throttling.

No bucket, prefix, object key, ETag, or STS value appears in public FS
responses or sandbox attachment requests.

The first technical spike must decide whether metadata lives in a per-FS
manifest/journal, is derived from a strict backend layout, or uses a hybrid. The
choice is judged by common FS conformance, crash recovery, and concurrency, not
by fidelity to an object API.

## 7. ArtifactFS-compatible implementation

ArtifactFS provides a useful backend implementation for fast tree publication,
on-demand content hydration, writable overlays, and revision-oriented workflows.
The gateway maps these mechanisms into the same FS entries and path
operations.

Private implementation concerns include:

- authorized remote/repository identity;
- tree publication and required revision readiness;
- hydration and cache behavior;
- writable overlay persistence;
- daemon/mount lifecycle;
- refresh, snapshot, commit, or push extensions;
- credential helper and remote authorization.

The common FS API cannot require callers to know whether a file was hydrated or
which blob/revision representation was used. Backend-specific progress may appear
in operator diagnostics and optional extensions.

An open-source local daemon is not automatically a safe custom route. Standard or
custom remote support requires an authenticated control protocol, tenant
isolation, health model, and narrow credential delegation.

## 8. Placement

Placement receives a required FS capability set, data locality, compliance,
caller policy, and route preference. It returns a route or a typed failure.

It does not receive “S3 operations” or “Git operations.” If optional ArtifactFS
extensions are requested, those are additional capabilities after the common FS
requirements.

Fallback never silently changes an existing FS's route. Creating a copy
on another route is an explicit transfer with observable progress and a new
FS identity.
