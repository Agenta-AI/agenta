# Raw research

Status: facts and source notes that support the proposal.

## 1. Current mount domain

Codebase knowledge-graph inspection of the FS worktree found:

- `Mount` carries required `project_id`, optional `session_id`, optional
  `agent_id`, purpose, data, flags, tags, and metadata.
- `MountCreate` mirrors the optional session/agent association.
- `get_or_create_agent_mount` canonicalizes the artifact/agent UUID, creates a
  deterministic reserved slug, stores `agent_id`, and upserts by project/slug.
- `get_or_create_session_mount` creates a deterministic slug from
  `(session_id, name)`, stores `session_id`, and intentionally does not store
  `agent_id`.
- Unit tests explicitly require session mounts to remain `agent_id=null`.
- The session slug hashes the session ID with UUID5 and therefore cannot recover
  an owning agent.
- Session archive/unarchive/delete fan out by `session_id`.
- Physical storage identity is derived server-side; current DTOs do not accept a
  caller-supplied storage location.

Relevant code:

- [mount DTOs](../../../../api/oss/src/core/mounts/dtos.py)
- [mount service](../../../../api/oss/src/core/mounts/service.py)
- [session/agent mount tests](../../../../api/oss/tests/pytest/unit/mounts/test_agent_mounts.py)

The gateway can preserve current rows, IDs, slugs, and physical roots. More
importantly, these facts show that product association already belongs to the
core `Mount` domain. The FS gateway need not reconstruct a session's parent
agent; core decides whether and how that mount enters sandbox configuration.

## 2. Current storage and runner behavior

Earlier code inspection found:

- `ObjectStore` supports the configured S3-compatible persistence service;
- mount credentials are temporary and restricted to an exact backend root;
- the runner uses geesefs, refreshes expiring authority, probes mounts, and cleans
  stale FUSE state;
- attachment mounts have protected lifecycle behavior.

These are reusable backend/controller mechanisms. They should not define the
northbound gateway model.

## 3. S3-compatible storage as a FS backend

An S3-compatible service is a valid persistence implementation for the FS
gateway. The design problem is not whether to expose an object API. It is how the
gateway supplies its declared FS behavior over that backend.

Implementation questions to spike:

- representation and concurrency of explicit directories;
- recoverable/observable move, copy, and recursive delete;
- atomic file replacement and opaque version translation;
- journal/manifest repair after process or network failure;
- paginated deterministic listings under mutation;
- large-file streaming and partial-upload cleanup;
- mount/data-plane agreement on the same visible FS state;
- narrow backend authority without passing it to callers.

Useful primary references:

- [Amazon S3 consistency model](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html#ConsistencyModel)
- [Amazon S3 conditional requests](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-requests.html)
- [Amazon S3 policy keys](https://docs.aws.amazon.com/AmazonS3/latest/userguide/amazon-s3-policy-keys.html)
- [SeaweedFS S3 API](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)
- [geesefs semantics and options](https://github.com/yandex-cloud/geesefs)

These sources describe backend mechanisms and limitations. They do not justify
leaking object terminology into the gateway contract.

## 4. ArtifactFS-compatible storage as a FS backend

Cloudflare's [ArtifactFS repository](https://github.com/cloudflare/artifact-fs)
describes a Git-backed FUSE system with blobless clone, fast tree publication,
on-demand/background hydration, local cache, writable overlay, SQLite state, and
Git-oriented operations.

It is a strong candidate for the second backend family because it already thinks
in FS/tree terms. The gateway still needs to normalize:

- common path and directory behavior;
- readiness of a required revision;
- overlay durability and mutation recovery;
- cache and credential isolation;
- attachment/daemon lifecycle;
- which refresh/commit/push behavior is optional rather than common FS behavior.

The public FS contract should make an unhydrated ArtifactFS file indistinguishable
from any other readable file, except for normal latency/metrics. Hydration and Git
blob identity are private diagnostics.

## 5. Volume/binding systems

The [OpenSandbox volume and binding proposal](https://github.com/opensandbox-group/OpenSandbox/blob/main/oseps/0003-volume-and-volumebinding-support.md)
separates durable volume identity from provider-specific bindings across Docker
and Kubernetes. This supports the split between durable gateway `FS`,
core association/configuration, and generation-bound `FSAttachment`.

The [Kubernetes PersistentVolume documentation](https://kubernetes.io/docs/concepts/storage/persistent-volumes/)
also separates storage lifecycle from a consuming pod. Agenta core adds product
association and configuration outside the generic FS gateway.

The [Linux FUSE documentation](https://github.com/torvalds/linux/blob/master/Documentation/filesystems/fuse/fuse.rst)
is relevant to trusted mount-controller readiness, abort, and failure behavior,
not to public backend selection.

## 6. Association/configuration conclusion

The product model already exists in current mounts:

```text
Mount(project_id, agent_id?, session_id?) -> FS handle
Sandbox configuration -> ordered FS bindings
```

Core owns the association, visibility, selection, and lifecycle rules. The
sandbox configuration resolver turns them into FS bindings just as it
turns product intent into CPU, memory, disk, network, and environment settings.
The FS gateway consumes handles and generic attachment intent.

## 7. Research still required

1. Inventory current core mount selection, association, and lifecycle paths.
2. Decide mount-ID/fs-ID compatibility and reference tracking.
3. Prototype the S3-compatible manifest/journal alternatives under concurrent
   writes and injected crashes.
4. Define the smallest common FS contract required by agents and UI.
5. Measure FUSE versus data-plane/proxy paths for every sandbox provider.
6. Run ArtifactFS with private remotes, large trees, overlay writes, restart, and
   concurrent sessions.
7. Define core rules for project/agent/session, explicit, and one-off bindings.
8. Decide which reconfiguration changes require sandbox replacement versus
   attachment-only reconciliation.
