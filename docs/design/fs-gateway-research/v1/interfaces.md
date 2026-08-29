# FS gateway interfaces

Status: contract sketch. Product associations are intentionally absent.

## 1. Generic control-plane port

```python
class FSServiceInterface(ABC):
    async def create_fs(
        self,
        *,
        auth: FSAuthContext,
        request: FSCreate,
        idempotency_key: str,
    ) -> FS: ...

    async def get_fs(
        self, *, auth: FSAuthContext, fs_id: UUID
    ) -> FS: ...

    async def query_fs(
        self,
        *,
        auth: FSAuthContext,
        query: FSQuery,
        windowing: Windowing,
    ) -> list[FS]: ...

    async def edit_policy(
        self,
        *,
        auth: FSAuthContext,
        fs_id: UUID,
        policy: FSPolicyEdit,
    ) -> FS: ...

    async def archive(
        self, *, auth: FSAuthContext, fs_id: UUID,
        idempotency_key: str
    ) -> FS: ...

    async def restore(
        self, *, auth: FSAuthContext, fs_id: UUID,
        idempotency_key: str
    ) -> FS: ...

    async def delete(
        self, *, auth: FSAuthContext, fs_id: UUID,
        idempotency_key: str
    ) -> FSOperation: ...

    async def create_revision(
        self,
        *,
        auth: FSAuthContext,
        fs_id: UUID,
        request: FSRevisionCreate,
        idempotency_key: str,
    ) -> FSRevision: ...
```

`FSAuthContext` contains an opaque security partition and caller
principal. Create has route/capability/lifecycle inputs, never product association
or backend addressing.

## 2. Common FS data port

```python
class FSDataInterface(ABC):
    async def stat(
        self, *, access: FSAccess, path: RelativePath
    ) -> FileEntry: ...

    async def list_directory(
        self, *, access: FSAccess, request: DirectoryListRequest
    ) -> Page[FileEntry]: ...

    async def read_file(
        self,
        *,
        access: FSAccess,
        path: RelativePath,
        byte_range: Optional[ByteRange],
    ) -> AsyncByteStream: ...

    async def write_file(
        self,
        *,
        access: FSAccess,
        path: RelativePath,
        body: AsyncByteStream,
        if_version: Optional[FileVersion],
        idempotency_key: str,
    ) -> FileEntry: ...

    async def create_directory(
        self,
        *,
        access: FSAccess,
        path: RelativePath,
        parents: bool,
        idempotency_key: str,
    ) -> FileEntry: ...

    async def copy(
        self, *, access: FSAccess, request: FSCopyRequest
    ) -> FSOperation: ...

    async def move(
        self, *, access: FSAccess, request: FSMoveRequest
    ) -> FSOperation: ...

    async def delete_path(
        self, *, access: FSAccess, request: FSDeleteRequest
    ) -> FSOperation: ...
```

The contract contains no list-objects, object-key, blob-hydration, or Git-tree
operations.

## 3. Generic attachment port

```python
class FSAttachmentServiceInterface(ABC):
    async def attach_many(
        self,
        *,
        auth: FSServiceAuthContext,
        consumer: OpaqueConsumerGeneration,
        bindings: list[FSAttachmentRequest],
        idempotency_key: str,
    ) -> list[FSAttachment]: ...

    async def observe(
        self, *, auth: FSServiceAuthContext, attachment_id: UUID
    ) -> FSAttachmentObservation: ...

    async def renew(
        self,
        *,
        auth: FSServiceAuthContext,
        attachment_id: UUID,
        requested_expiry: datetime,
    ) -> FSAttachment: ...

    async def detach(
        self,
        *,
        auth: FSServiceAuthContext,
        attachment_id: UUID,
        idempotency_key: str,
    ) -> FSOperation: ...

    async def reconcile_consumer(
        self,
        *,
        auth: FSServiceAuthContext,
        consumer: OpaqueConsumerGeneration,
        desired_binding_hash: str,
    ) -> AttachmentReconciliation: ...
```

`FSAttachmentRequest` contains FS ID, revision, mount path,
access, and requiredness. It does not contain mount ID, project, agent, session,
route/backend details, or storage credentials.

The desired binding hash is computed from resolved sandbox configuration. The FS
gateway does not understand how core produced it.

## 4. Core-side composition port

This interface is outside the FS gateway but makes the boundary explicit:

```python
class SandboxFSConfigurationResolverInterface(ABC):
    async def resolve(
        self,
        *,
        auth: CoreAuthContext,
        execution_context: ExecutionContext,
        sandbox_spec: SandboxSpec,
    ) -> ResolvedSandboxFSConfiguration: ...

    async def apply_termination_policy(
        self,
        *,
        auth: CoreAuthContext,
        configuration: ResolvedSandboxFSConfiguration,
        reason: TerminationReason,
    ) -> None: ...
```

The resolver understands project, agent, session, current `Mount` associations,
explicit selection, one-off FS instances, and product lifecycle. Its output feeds
the generic attachment port.

## 5. HTTP shape

### Control plane

| Method and path | Meaning |
| --- | --- |
| `POST /v1/gateways/fs/{namespace}/{route}` | Create generic FS |
| `GET /v1/gateways/fs` | Query caller-authorized FS instances |
| `GET /v1/gateways/fs/{fs_id}` | Get state/capabilities |
| `PUT /v1/gateways/fs/{fs_id}/policy` | Edit retention/quota |
| `POST /v1/gateways/fs/{fs_id}/archive` | Archive |
| `POST /v1/gateways/fs/{fs_id}/restore` | Restore |
| `DELETE /v1/gateways/fs/{fs_id}` | Revoke and schedule deletion |
| `POST /v1/gateways/fs/{fs_id}/revisions` | Create revision |
| `POST /v1/gateways/fs-access` | Mint path/operation-scoped data ticket |

### Data plane

```text
GET    /v1/data/fs/{fs_id}/entries/{path...}
GET    /v1/data/fs/{fs_id}/directories/{path...}
PUT    /v1/data/fs/{fs_id}/files/{path...}
POST   /v1/data/fs/{fs_id}/directories/{path...}
POST   /v1/data/fs/{fs_id}/copies
POST   /v1/data/fs/{fs_id}/moves
DELETE /v1/data/fs/{fs_id}/entries/{path...}
```

### Internal attachment API

```text
POST /v1/internal/fs-attachments
GET  /v1/internal/fs-attachments/{id}
POST /v1/internal/fs-attachments/{id}/renew
POST /v1/internal/fs-attachments/{id}/detach
POST /v1/internal/fs-attachments/reconcile
```

There is no FS-scope or session-view route.

## 6. Route catalog port

```python
class FSRouteCatalogInterface(ABC):
    async def list_routes(
        self, *, auth: FSAuthContext,
        required: FSCapabilities
    ) -> list[FSRouteView]: ...

    async def resolve_route(
        self,
        *,
        auth: FSServiceAuthContext,
        ref: FSRouteRef,
        required: FSCapabilities,
    ) -> ResolvedFSRoute: ...

    async def create_custom_route(
        self, *, auth: AdminAuthContext,
        request: CustomFSRouteCreate
    ) -> FSRouteView: ...

    async def probe(
        self, *, auth: AdminAuthContext, ref: FSRouteRef
    ) -> FSRouteProbe: ...
```

## 7. South port: backend adapter

```python
class FSBackendAdapterInterface(ABC):
    async def provision(
        self,
        *,
        route: ResolvedFSRoute,
        subject: FSBackendSubject,
        idempotency_key: str,
    ) -> OpaqueBackendRef: ...

    async def observe(
        self, *, route: ResolvedFSRoute, backend: OpaqueBackendRef
    ) -> BackendObservation: ...

    async def execute(
        self,
        *,
        route: ResolvedFSRoute,
        backend: OpaqueBackendRef,
        operation: FSCommand,
        authority: BackendAuthority,
    ) -> FSCommandResult: ...

    async def delete(
        self,
        *,
        route: ResolvedFSRoute,
        backend: OpaqueBackendRef,
        idempotency_key: str,
    ) -> BackendOperation: ...

    async def capabilities(
        self, *, route: ResolvedFSRoute
    ) -> FSCapabilities: ...
```

## 8. Trusted mount-controller port

```python
class FSMountControllerInterface(ABC):
    async def prepare(
        self,
        *,
        attachment: FSAttachment,
        FS: FS,
        backend: OpaqueBackendRef,
        idempotency_key: str,
    ) -> PreparedFSMount: ...

    async def observe(
        self, *, prepared: PreparedFSMount
    ) -> FSMountObservation: ...

    async def renew(
        self, *, prepared: PreparedFSMount,
        lease_expires_at: datetime
    ) -> PreparedFSMount: ...

    async def detach(
        self, *, prepared: PreparedFSMount,
        idempotency_key: str
    ) -> BackendOperation: ...
```

Backend-specific authority, manifest, hydration, and daemon ports remain private.

## 9. Errors

| Error | HTTP | Meaning |
| --- | --- | --- |
| `FSForbidden` | 403 | Caller/security partition cannot access handle |
| `FSRouteNotFound` | 404 | Route is absent or unavailable |
| `FSCapabilityUnsupported` | 422 | Route cannot meet required FS behavior |
| `FSConflict` | 409 | Idempotency, version, or immutable-field conflict |
| `FSPathInvalid` | 422 | Non-canonical or escaping path |
| `FSOperationPending` | 202 | Journaled mutation is reconciling |
| `FSAttachmentConflict` | 409 | Consumer generation/path conflict |
| `FSBackendUnavailable` | 503 | Adapter/backend unavailable |

Invalid project/agent/session relationships are core-domain errors, not FS gateway
errors.
