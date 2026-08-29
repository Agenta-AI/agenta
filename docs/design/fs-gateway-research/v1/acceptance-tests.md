# FS gateway acceptance tests

Status: proposed executable contract and integration matrix.

## 1. Suite boundaries

Tests are split by owner:

1. **FS gateway contract:** generic FS and attachment behavior.
2. **Core association/configuration:** project/agent/session and one-off rules.
3. **Route governance:** builtin/standard/custom.
4. **Backend diagnostics:** S3-compatible or ArtifactFS-compatible internals.
5. **Sandbox integration:** resolved bindings across providers.

Project, agent, and session appear only in core tests. S3/ArtifactFS terms appear
only in backend/operator tests.

## 2. Generic FS contract

Run against the in-memory reference and every enabled backend route.

| ID | Case |
| --- | --- |
| FS01 | Create is idempotent and returns stable generic FS ID |
| FS02 | Create/list/stat/read/write use canonical paths and explicit directories |
| FS03 | Traversal, absolute paths, NUL, and normalization ambiguity are rejected |
| FS04 | Empty, large streaming, Unicode, and deep-tree content round-trip |
| FS05 | Range reads and deterministic paginated listings are stable |
| FS06 | Conditional replace succeeds on matching opaque version and rejects stale version |
| FS07 | Copy is idempotent and preserves promised content/metadata |
| FS08 | Move has one observable outcome across retry/crash |
| FS09 | File, empty-directory, and recursive delete follow one contract |
| FS10 | Concurrent writers produce declared conflict/serialization behavior |
| FS11 | Archive blocks writes; restore preserves identity/content |
| FS12 | Delete revokes access first and cannot affect another FS |
| FS13 | Immutable revision reads remain stable after live mutations |
| FS14 | DTO/audit snapshots contain no product IDs, backend address, or credential |
| FS15 | Unsupported optional capability returns a typed common error |

## 3. Generic tenancy and attachment

| ID | Case |
| --- | --- |
| GA01 | Opaque security partition cannot access another partition's FS |
| GA02 | Gateway behavior does not branch on project/agent/session-shaped metadata |
| GA03 | Batch attach accepts only FS, revision, path, mode, requiredness, consumer generation |
| GA04 | Same binding set and consumer generation attach idempotently |
| GA05 | Changed desired-binding hash produces deterministic reconciliation |
| GA06 | Required failure blocks readiness; optional failure is observable |
| GA07 | Read-only attachment rejects writes |
| GA08 | Lease renewal changes authority lifetime without changing FS identity |
| GA09 | Detach revokes access while retention remains independent |
| GA10 | Consumer/controller crash leaves no duplicate mount or leaked authority |

## 4. Core association and configuration

Use projects P1/P2, agents A1/A2, sessions S1/S2, plus one-off sandbox O1. These
tests run against core resolver fakes and do not call backend adapters.

| ID | Case |
| --- | --- |
| CR01 | Existing project mount resolves according to current core visibility rules |
| CR02 | Existing agent mount resolves only where core product rules allow it |
| CR03 | Existing session mount resolves by current session association without gateway ownership inference |
| CR04 | Current session row may keep `agent_id=null`; FS gateway never needs to repair it |
| CR05 | Explicit `fs_id` selection resolves after core authorization |
| CR06 | One-off request creates an ephemeral FS and emits delete-with-sandbox intent |
| CR07 | CPU/memory/FS configuration changes produce a new sandbox config revision |
| CR08 | Conflicting mount paths and incompatible modes are rejected by configuration validation |
| CR09 | Resolution order and binding hash are deterministic |
| CR10 | Removing an association does not delete shared FS unless core lifecycle policy says so |
| CR11 | Project/agent/session lifecycle produces explicit archive/delete calls, not gateway cascades |
| CR12 | Legacy mount ID/content maps to FS ID without data copy |

## 5. Route namespace behavior

| ID | Case |
| --- | --- |
| RT01 | Builtin route is generated and cannot accept custom endpoint configuration |
| RT02 | Standard route requires authorized account binding and canonical configuration |
| RT03 | Custom route requires admin, installed adapter, TLS/egress validation, and vault ref |
| RT04 | Route namespace does not imply product association or sandbox configuration |
| RT05 | Placement requires common FS conformance and requested capabilities |
| RT06 | Route disable degrades predictably and never silently migrates |
| RT07 | Secret rotation changes private state only |
| RT08 | Active FS dependencies make custom-route deletion explicit and safe |

## 6. S3-compatible implementation diagnostics

Run local CI against SeaweedFS/MinIO and checkpoint jobs against maintained
standard routes.

| ID | Case |
| --- | --- |
| S301 | Physical allocation is isolated by FS/security partition |
| S302 | Narrow authority cannot reach sibling allocation |
| S303 | Directory metadata survives restart and concurrent update |
| S304 | Journal recovers interrupted move/copy/delete to one contract outcome |
| S305 | Large-file failure leaves no visible corrupt file |
| S306 | Native version/ETag semantics do not leak |
| S307 | Pagination/throttling/visibility are normalized |
| S308 | Recursive delete is bounded to one allocation |
| S309 | FUSE authority refresh and stale-unmount recovery preserve lease isolation |
| S310 | Endpoint, root, and credentials are redacted from northbound surfaces |

## 7. ArtifactFS-compatible diagnostics

Run the full common suite first, then:

| ID | Case |
| --- | --- |
| AF01 | Required revision publishes a stable directory tree before ready |
| AF02 | Unhydrated content reads as normal file bytes through common API |
| AF03 | Concurrent hydration is deduplicated without changing behavior |
| AF04 | Writable overlay survives controller restart |
| AF05 | Pinned revision remains immutable after refresh |
| AF06 | Cache isolation prevents cross-partition or cross-FS disclosure |
| AF07 | Remote credentials remain in helper/broker |
| AF08 | Optional extensions cannot corrupt common state |
| AF09 | Daemon crash/orphan cleanup converges through attachment lease |
| AF10 | Common payload/response shapes match other backends |

## 8. Sandbox provider matrix

Run the same resolved configuration for:

| Environment | Required fixture |
| --- | --- |
| local in-process | reference FS and direct trusted adapter |
| Docker | Docker sandbox plus FS controller |
| Daytona | provider sandbox using generic attachment handles |
| E2B | provider sandbox using generic attachment handles |
| Kubernetes | Agent Sandbox/CSI or trusted controller |

| ID | Case |
| --- | --- |
| AT01 | Resolved bindings attach before sandbox readiness |
| AT02 | Sandbox request/env contain no product association or backend details |
| AT03 | Persistent FS survives generation replacement/reacquire |
| AT04 | One-off delete-with-sandbox FS is detached then deleted exactly once |
| AT05 | Required/optional and read/write configuration is enforced |
| AT06 | Binding retry/reconcile is idempotent |
| AT07 | Termination detaches all bindings and returns lifecycle completion to core |
| AT08 | Two consumers cannot escape authorized FS instances or paths |
| AT09 | Swapping backend implementation leaves sandbox configuration unchanged |
| AT10 | CPU/memory-only reconfiguration does not recreate retained FS |
| AT11 | FS-only reconfiguration updates attachments without product-domain calls in FS gateway |
| AT12 | Provider crash and retry create no leaked authority or duplicate mount |

## 9. Release gates

- **FS-C0:** FS01–FS15 on reference backend; CR01–CR12 with FS fakes.
- **FS-C1:** common suite on `builtin/agenta` plus S301–S310.
- **FS-C2:** GA01–GA10 and AT01–AT12 across local, Docker, and one remote provider.
- **FS-C3:** RT01–RT08 and common suite on every enabled standard/custom route.
- **FS-C4:** common suite, AF01–AF10, and unchanged sandbox binding snapshots.
- **Rollout:** compatibility shadow comparisons, crash drills, redaction, and
  rollback rehearsal pass.
