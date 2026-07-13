from re import fullmatch, sub
from typing import TYPE_CHECKING, List, Optional
from uuid import UUID, uuid5, NAMESPACE_DNS

if TYPE_CHECKING:
    from oss.src.core.workflows.service import WorkflowsService

from oss.src.core.mounts.dtos import (
    Mount,
    MountCreate,
    MountCredentials,
    MountEdit,
    MountFile,
    MountFileContent,
    MountFileDeleted,
    MountFileList,
    MountFileWritten,
    MountFolderCreated,
    MountQuery,
)
from oss.src.core.mounts.interfaces import MountsDAOInterface
from oss.src.core.store.storage import ObjectStore
from oss.src.core.mounts.types import (
    MountArtifactIdInvalid,
    MountArtifactNotFound,
    MountFileNotFound,
    MountNameInvalid,
    MountNotFound,
    MountPathInvalid,
    MountSlugReserved,
    MountStorageUnavailable,
)
from oss.src.core.shared.dtos import Reference, Windowing

# Folder/file path segments: word chars, dots, spaces, hyphens — no path traversal.
_SEGMENT_RE = r"[\w. -]+"

# Reserved slug prefix for service-minted (session) slugs; a caller may not author one.
_RESERVED_SLUG_PREFIX = "__ag__"

# Deterministic UUIDv5 namespace: the project-wide root (uuid5(NAMESPACE_DNS, "agenta"))
# sub-namespaced under "mounts". Stable across instances/restarts so the same session id
# always derives the same slug. The same derived-root style as static_catalog's "catalog".
_MOUNTS_NAMESPACE = uuid5(uuid5(NAMESPACE_DNS, "agenta"), "mounts")

# The single session-bound mount: the agent's durable working directory.
_SESSION_CWD_NAME = "cwd"

# Default TTL (seconds) for signed mount credentials. Covers the mount lifetime for a
# turn; geesefs holds the creds without refresh, so a turn outliving this hits ExpiredToken.
_CREDENTIALS_TTL_SECONDS = 3600


def _slugify(value: str) -> str:
    return sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def slugify_mount_name(name: str) -> str:
    """The slug a mount name maps to. Rejects names that slugify to nothing.

    Aliasing is intended: the session mount is an upsert keyed on unique(project_id, slug), so
    'CWD' and 'cwd' resolving to one row returns that row rather than corrupting it. Only an
    empty slug is malformed — it would mint a nameless `__ag__<uuid5>__` prefix.
    """
    slug = _slugify(name)
    if not slug:
        raise MountNameInvalid(name)
    return slug


def mint_session_slug(*, session_id: str, name: str) -> str:
    """Stored slug for a session mount: __ag__session__<uuid5(session)>__<slugified-name>.

    The uuid5 keeps it deterministic (re-attach the same files) and project-unique
    without truncation, so the existing unique(project_id, slug) constraint holds
    for both session and non-session mounts.
    """
    return f"{_RESERVED_SLUG_PREFIX}session__{uuid5(_MOUNTS_NAMESPACE, session_id)}__{slugify_mount_name(name)}"


def mint_agent_slug(*, artifact_id: str, name: str) -> str:
    """Mint the deterministic reserved slug for an artifact mount.

    Artifact IDs are UUID-parsed and rendered lowercase. Sign and query must use
    this same derivation byte-identically so they address the same mount.
    """
    try:
        canonical_artifact_id = UUID(str(artifact_id))
    except (ValueError, TypeError, AttributeError) as e:
        raise MountArtifactIdInvalid(str(artifact_id)) from e

    slug_name = slugify_mount_name(name)
    return f"{_RESERVED_SLUG_PREFIX}agent__{canonical_artifact_id}__{slug_name}"


def reject_reserved_slug(slug: str) -> None:
    """A caller may not author a slug in the reserved namespace (the service mints those)."""
    if slug.startswith(_RESERVED_SLUG_PREFIX):
        raise MountSlugReserved(slug)


def validate_file_path(path: str) -> None:
    """Per-segment guard on a caller-supplied file/folder path.

    Rejects absolute paths, `..` traversal, and any segment that could escape
    the mount prefix. Dots are allowed within a segment (filenames) but a bare
    `..` segment is not.
    """
    if path.startswith("/"):
        raise MountPathInvalid("File path must not be absolute.")
    if not path.strip("/"):
        raise MountPathInvalid("File path must not be empty.")
    for segment in path.split("/"):
        if not segment:
            continue
        if segment == ".." or not fullmatch(_SEGMENT_RE, segment):
            raise MountPathInvalid()


class MountsService:
    def __init__(
        self,
        *,
        mounts_dao: MountsDAOInterface,
        mounts_store: Optional[ObjectStore] = None,
        bucket: Optional[str] = None,
        namespace: Optional[str] = None,
        workflows_service: Optional["WorkflowsService"] = None,
    ):
        self.mounts_dao = mounts_dao
        self.mounts_store = mounts_store
        self.bucket = bucket
        self.namespace = namespace
        self.workflows_service = workflows_service

    def _storage_key(self, *, project_id: UUID, mount: Mount, path: str = "") -> str:
        """Object-key prefix for a mount: [<namespace>/]mounts/<project_id>/<mount_id>/<path>.

        The optional namespace is the per-deployment "database" prefix that lets ephemeral
        environments share one bucket; it is omitted entirely when unset, so a dedicated-bucket
        deploy keeps the byte-identical `mounts/...` layout (no empty leading segment).
        """
        ns = (self.namespace or "").strip("/")
        base = (
            f"{ns}/mounts/{project_id}/{mount.id}"
            if ns
            else f"mounts/{project_id}/{mount.id}"
        )
        return f"{base}/{path.lstrip('/')}" if path else f"{base}/"

    async def create_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_create: MountCreate,
    ) -> Mount:
        # The caller may not author a reserved slug; the service mints those for session mounts.
        reject_reserved_slug(mount_create.slug)

        # Session mounts share a flat per-project slug namespace with hand-named mounts: keep the
        # human handle as `name` and mint a deterministic, project-unique reserved slug from the
        # session id, so unique(project_id, slug) holds for both without a scope-aware constraint.
        if mount_create.session_id is not None:
            name = mount_create.name or mount_create.slug
            mount_create = mount_create.model_copy(
                update={
                    "name": name,
                    "slug": mint_session_slug(
                        session_id=mount_create.session_id, name=mount_create.slug
                    ),
                }
            )

        return await self.mounts_dao.create_mount(
            project_id=project_id,
            user_id=user_id,
            #
            mount_create=mount_create,
        )

    async def get_or_create_session_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
        name: str = _SESSION_CWD_NAME,
    ) -> Mount:
        """Bind (idempotently) one durable mount for a session, keyed by `name`.

        The minted session slug is deterministic per (session_id, slugify(name)), so the
        upsert keys on unique(project_id, slug): the same (session, name) always resolves to
        the same row and the same durable storage prefix. No explicit create/edit, no 409
        dance. `name="cwd"` is the original single-mount case; any other name (e.g. a
        harness's transcript dir) is an additional session-scoped mount sharing the same
        shape with its own prefix. Names that slugify alike share the row by design; the
        stored `name` is the slug so it never disagrees with it.
        """
        slug_name = slugify_mount_name(name)
        mount_create = MountCreate(
            slug=mint_session_slug(session_id=session_id, name=slug_name),
            name=slug_name,
            session_id=session_id,
        )
        return await self.mounts_dao.upsert_mount(
            project_id=project_id,
            user_id=user_id,
            mount_create=mount_create,
        )

    async def _verify_agent_artifact(
        self,
        *,
        project_id: UUID,
        artifact_id: str,
    ) -> None:
        """The bound artifact must exist in the project; static-catalog ids resolve in code, not the DB."""
        if self.workflows_service is None:
            return

        try:
            artifact_uuid = UUID(str(artifact_id))
        except (ValueError, TypeError, AttributeError) as e:
            raise MountArtifactIdInvalid(str(artifact_id)) from e

        static_catalog = self.workflows_service.static_catalog
        if static_catalog is not None and static_catalog.is_static_id(artifact_uuid):
            return

        workflow = await self.workflows_service.fetch_workflow(
            project_id=project_id,
            workflow_ref=Reference(id=artifact_uuid),
            include_archived=False,
        )
        if workflow is None:
            raise MountArtifactNotFound(str(artifact_id))

    async def get_or_create_agent_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        artifact_id: str,
        name: str = "default",
    ) -> Mount:
        """Bind idempotently one durable mount for an artifact, keyed by name."""
        await self._verify_agent_artifact(
            project_id=project_id,
            artifact_id=artifact_id,
        )

        slug_name = slugify_mount_name(name)
        mount_create = MountCreate(
            slug=mint_agent_slug(artifact_id=artifact_id, name=name),
            name=slug_name,
        )
        return await self.mounts_dao.upsert_mount(
            project_id=project_id,
            user_id=user_id,
            mount_create=mount_create,
        )

    async def get_or_create_session_cwd(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        session_id: str,
    ) -> Mount:
        """Bind (idempotently) the one durable `cwd` mount for a session. Thin alias of
        `get_or_create_session_mount` kept for call-site clarity at the cwd sign endpoint."""
        return await self.get_or_create_session_mount(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            name=_SESSION_CWD_NAME,
        )

    async def fetch_mount(
        self,
        *,
        project_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]:
        return await self.mounts_dao.fetch_mount(
            project_id=project_id,
            mount_id=mount_id,
        )

    async def fetch_agent_mount(
        self,
        *,
        project_id: UUID,
        artifact_id: str,
        name: str = "default",
    ) -> Optional[Mount]:
        """Fetch the active artifact mount keyed by name without creating it."""
        slug = mint_agent_slug(artifact_id=artifact_id, name=name)
        return await self.mounts_dao.fetch_mount_by_slug(
            project_id=project_id,
            slug=slug,
        )

    async def edit_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_edit: MountEdit,
    ) -> Optional[Mount]:
        existing = await self.mounts_dao.fetch_mount(
            project_id=project_id,
            mount_id=mount_edit.id,
        )
        if not existing:
            raise MountNotFound()

        return await self.mounts_dao.edit_mount(
            project_id=project_id,
            user_id=user_id,
            mount_edit=mount_edit,
        )

    async def archive_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]:
        return await self.mounts_dao.archive_mount(
            project_id=project_id,
            user_id=user_id,
            mount_id=mount_id,
        )

    async def unarchive_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_id: UUID,
    ) -> Optional[Mount]:
        return await self.mounts_dao.unarchive_mount(
            project_id=project_id,
            user_id=user_id,
            mount_id=mount_id,
        )

    async def query_mounts(
        self,
        *,
        project_id: UUID,
        #
        mount_query: Optional[MountQuery] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> List[Mount]:
        return await self.mounts_dao.query_mounts(
            project_id=project_id,
            mount_query=mount_query,
            windowing=windowing,
        )

    # --- File ops (durable store contents) --------------------------------- #

    async def _resolve_mount(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
    ) -> Mount:
        mount = await self.mounts_dao.fetch_mount(
            project_id=project_id,
            mount_id=mount_id,
        )
        if not mount:
            raise MountNotFound()
        return mount

    def _bucket(self) -> str:
        if not self.bucket:
            raise MountStorageUnavailable()
        return self.bucket

    async def sign_mount_credentials(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        duration_seconds: int = _CREDENTIALS_TTL_SECONDS,
    ) -> MountCredentials:
        """Mint short-lived, prefix-scoped credentials for one mount.

        The master key signs the STS request API-side and never leaves; the returned
        key pair + session token are scoped to this mount's prefix and expire in minutes.
        """
        if self.mounts_store is None:
            raise MountStorageUnavailable()

        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)
        bucket = self._bucket()
        # `<project_id>/<mount_id>` — the durable prefix, slug-independent (no trailing slash).
        prefix = self._storage_key(project_id=project_id, mount=mount).rstrip("/")

        creds = await self.mounts_store.sign_temp_credentials(
            bucket=bucket,
            prefix=prefix,
            duration_seconds=duration_seconds,
        )
        return MountCredentials(
            endpoint=self.mounts_store.endpoint_url,
            region=self.mounts_store.region,
            bucket=bucket,
            prefix=prefix,
            access_key=creds.access_key,
            secret_key=creds.secret_key,
            session_token=creds.session_token,
            expires_at=getattr(creds, "_expiration", None),
        )

    async def list_files(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: Optional[str] = None,
    ) -> MountFileList:
        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)

        base = self._storage_key(project_id=project_id, mount=mount).rstrip("/")
        prefix = base
        if path:
            validate_file_path(path)
            prefix = self._storage_key(
                project_id=project_id, mount=mount, path=path
            ).rstrip("/")

        list_prefix = prefix + "/"
        objects = await self.mounts_store.list_objects_v2(
            bucket=self._bucket(),
            prefix=list_prefix,
        )

        mount_base = base + "/"
        files: List[MountFile] = []
        folders: set[str] = set()
        for key, size, mtime in objects:
            rel = key[len(mount_base) :] if key.startswith(mount_base) else key
            # Hide bare trailing-slash marker objects (empty-folder markers).
            if key.endswith("/"):
                folder_rel = rel.rstrip("/")
                if folder_rel:
                    folders.add(folder_rel)
                continue
            files.append(MountFile(path=rel, size=size, mtime=mtime))

        existing = {f.path for f in files}
        for folder_rel in sorted(folders):
            if folder_rel not in existing:
                files.append(MountFile(path=folder_rel, size=0, is_folder=True))

        return MountFileList(files=files)

    async def read_file_bytes(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> bytes:
        """Raw object bytes — the basis for binary download (no lossy decode)."""
        validate_file_path(path)
        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)

        key = self._storage_key(project_id=project_id, mount=mount, path=path)
        return await self.mounts_store.get_object(bucket=self._bucket(), key=key)

    async def read_file(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> MountFileContent:
        body = await self.read_file_bytes(
            project_id=project_id, mount_id=mount_id, path=path
        )
        return MountFileContent(
            path=path,
            content=body.decode("utf-8", "replace"),
        )

    async def write_file(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
        content: bytes,
    ) -> MountFileWritten:
        validate_file_path(path)
        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)

        key = self._storage_key(project_id=project_id, mount=mount, path=path)
        size = await self.mounts_store.put_object(
            bucket=self._bucket(),
            key=key,
            body=content,
        )
        return MountFileWritten(path=path, size=size)

    async def create_folder(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> MountFolderCreated:
        validate_file_path(path)
        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)

        # Object stores have no directories; a trailing-slash zero-byte marker
        # is the S3 console convention for an explicit empty folder.
        folder = path.strip("/")
        key = self._storage_key(project_id=project_id, mount=mount, path=folder) + "/"
        await self.mounts_store.put_object(
            bucket=self._bucket(),
            key=key,
            body=b"",
        )
        return MountFolderCreated(path=folder)

    async def delete_path(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> MountFileDeleted:
        validate_file_path(path)
        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)

        # A file matches one exact key; a folder matches keys under "<path>/".
        # List the folder prefix to avoid `foo` falsely matching `foobar`.
        exact_key = self._storage_key(
            project_id=project_id, mount=mount, path=path.rstrip("/")
        )
        folder_prefix = exact_key + "/"
        bucket = self._bucket()

        objects = await self.mounts_store.list_objects_v2(
            bucket=bucket,
            prefix=folder_prefix,
        )
        keys = [key for key, *_ in objects]

        # The exact file (or the folder marker) may also exist alongside contents.
        single = await self.mounts_store.list_objects_v2(
            bucket=bucket,
            prefix=exact_key,
        )
        if any(key == exact_key for key, *_ in single):
            keys.append(exact_key)

        unique_keys = list(dict.fromkeys(keys))
        if not unique_keys:
            raise MountFileNotFound()

        count = await self.mounts_store.delete_keys(
            bucket=bucket,
            keys=unique_keys,
        )
        return MountFileDeleted(deleted=path, count=count)
