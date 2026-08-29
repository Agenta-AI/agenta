# Working notes

Status: decisions, questions, and next experiments.

## Corrected working positions

1. The public gateway keys are `llm`, `mcp`, `sbx`, and `fs`; use
   `fs`, not `dfs` or `vfs`, for this gateway.
2. The gateway resource is `FS`, not an S3 bucket, object namespace, or
   generic blob volume.
3. S3-compatible and ArtifactFS-compatible are private backend families that pass
   one common FS contract.
4. Project, agent, and session associations remain in core `Mount`.
5. Core resolves product associations and one-off requests into sandbox
   FS configuration.
6. FS bindings are configuration like CPU, memory, disk, network, and
   environment.
7. The FS gateway sees generic FS handles, opaque security partitions,
   caller/consumer identity, paths, revisions, access, and leases.
8. `builtin`, `standard`, and `custom` describe endpoint governance only.
9. Existing mount rows/IDs/content remain core migration inputs.
10. Sandbox gateway consumes resolved bindings and does not resolve associations.
11. Backend credentials and addressing stay behind the FS gateway.

## Decisions still open

- Should `fs_id` initially equal `mount.id` or use a side mapping table?
- Which current mount-selection rules produce default sandbox bindings, and which
  remain explicit?
- What does an ephemeral/one-off FS default to on pause, replace,
  snapshot, and terminate?
- Can multiple core `Mount` associations reference one FS, and which
  service counts references before deletion?
- Which common operations require atomic completion versus durable asynchronous
  operation state?
- Do executable mode and symlink belong in the minimum contract?
- Is an FS writable by multiple concurrent consumers, and what conflict
  policy applies?
- Is revision creation mandatory or capability-gated?
- Which mount paths preserve current runner behavior for working directory and
  attachments?
- Should route/backend metadata be entirely operator-only or partially visible
  for compliance and placement?

## Immediate experiments

1. Inventory current mount selection and lifecycle call paths in core and runner.
2. Write the in-memory common FS conformance kit.
3. Write a pure core configuration resolver with fake FS handles.
4. Test project/agent/session associations plus explicit and one-off configuration
   without calling the FS gateway.
5. Prototype manifest/journal semantics over local SeaweedFS/MinIO with crashes.
6. Compare geesefs and data-plane mounts for recovery and concurrency.
7. Run ArtifactFS common operations without Git-specific test APIs.
8. Validate one resolved binding payload across local, Docker, Daytona, E2B, and
   Kubernetes Agent Sandbox.
