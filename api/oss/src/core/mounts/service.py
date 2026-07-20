import asyncio
from bisect import bisect_left, bisect_right
from collections import deque
from posixpath import basename
from re import sub
from typing import AsyncIterator, TYPE_CHECKING, List, Optional, Tuple
from uuid import UUID, uuid5, NAMESPACE_DNS

import pathspec

if TYPE_CHECKING:
    from oss.src.core.workflows.service import WorkflowsService

from oss.src.core.mounts.dtos import (
    MountArchiveSource,
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
from oss.src.core.store.dtos import StoreObject
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
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

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
    """Guard a caller-supplied file/folder path against escaping the mount or corrupting a store key.

    Denylist, not allowlist: reject absolute paths, empty / `.` / `..` segments, and NUL or control
    characters. Every other character real filenames contain — parentheses, brackets, `@ + , # ~ '`,
    non-ASCII — is accepted, because the lazy-browse flow round-trips these paths on every expansion.
    """
    if path.startswith("/"):
        raise MountPathInvalid("File path must not be absolute.")
    if not path.strip("/"):
        raise MountPathInvalid("File path must not be empty.")
    if any(ord(c) < 0x20 or c == "\x7f" for c in path):
        raise MountPathInvalid("File path must not contain control characters.")
    for segment in path.strip("/").split("/"):
        if segment in ("", ".", ".."):
            raise MountPathInvalid()


def _zip_segments(path: str) -> List[str]:
    """Split a zip entry path on BOTH separators — a backslash is a separator to Windows extractors,
    so `..\\x` traverses just like `../x`."""
    return path.replace("\\", "/").split("/")


def _has_unsafe_zip_segment(segments: List[str]) -> bool:
    """True if any segment is empty / `.` / `..` — i.e. the path could traverse out of the zip root
    (zip-slip for whoever extracts)."""
    return any(s in ("", ".", "..") for s in segments)


def _safe_zip_segments(path: str) -> List[str]:
    """Segments safe to place in a zip entry name: drop empty / `.` / `..` (both separators) so a
    prefix can't mint a `../x` or `..\\x` entry."""
    return [s for s in _zip_segments(path) if s not in ("", ".", "..")]


def _is_internal_mount_path(path: str) -> bool:
    """Runner-owned runtime artifacts written into the durable cwd — hidden from flat file listings.
    Mirrors the web `isInternalDrivePath`: the whole `agents/` namespace plus `.agenta-*` markers."""
    rel = path.strip("/")
    if not rel:
        return False
    if rel == "agents" or rel.startswith("agents/"):
        return True
    return any(segment.startswith(".agenta-") for segment in rel.split("/"))


# Backstop on how many `.gitignore` files we read per listing (each is an object fetch). Real repos
# have a handful once ignored dirs are pruned; this only guards a pathological tree.
_MAX_GITIGNORE_FILES = 100

# How many directory levels to list concurrently while descending a mount (see `_list_pruned_files`).
# Bounds fan-out against the object store; the tree is walked level by level, siblings in parallel.
_LIST_CONCURRENCY = 24

# How many file bodies to read AHEAD while streaming a "download all" archive (see
# `iter_archive_members`). Kept modest so a big drive isn't strictly sequential without loading the
# object store — a handful of reads in flight, not all at once.
_ARCHIVE_READ_CONCURRENCY = 8

# Count-only (`limit=0`) view stops scanning after this many files and reports the count as a FLOOR
# (`total_capped`). Keeps the always-shown "N files" badge cheap even for a pathologically large tree
# the repo does NOT gitignore — the summary shows "N+", never blocking on a full enumeration.
_COUNT_CAP = 20000


def _is_git_plumbing(path: str) -> bool:
    """The `.git` metadata directory. Git itself never lists it, so neither do we — this is git
    plumbing, not a user file (and it can hold thousands of objects that would swamp the count)."""
    return any(segment == ".git" for segment in path.strip("/").split("/"))


def _is_hidden_path(path: str) -> bool:
    """A dot-prefixed (hidden) file or folder anywhere in the path — `.claude/…`, `.gitignore`, etc.
    Mirrors the web `isHiddenPath`. Dropped from the RECENCY view only (it is meant to read like
    "what did I just work on", not dotfile plumbing); the browsable tree still lists them (dimmed)."""
    return any(
        segment.startswith(".") for segment in path.strip("/").split("/") if segment
    )


def _path_gitignored(
    rel_path: str,
    is_dir: bool,
    specs: List[Tuple[str, "pathspec.PathSpec"]],
) -> bool:
    """Is `rel_path` ignored by any in-scope `.gitignore`?

    Tests the path AND every ancestor directory: git ignores everything under an ignored directory
    and never descends into it, but pathspec's per-path `match_file` can miss deeply-nested
    descendants (e.g. pnpm's `node_modules/.pnpm/<pkg>/node_modules/...`, which the pattern
    `**/*/node_modules` matches as the `node_modules` DIRECTORY but not as that leaf file). Walking
    the ancestors replicates git's directory-based model. Each spec is scoped to the directory its
    `.gitignore` lives in; a trailing slash is added for directories so `dir/` patterns match.
    Short-circuits on the first ignored ancestor. (Additive across levels; within-file negation is
    handled by pathspec.)
    """
    segments = rel_path.split("/")
    for i in range(1, len(segments) + 1):
        # A `.gitignore` file is the repo's own config: git keeps a TRACKED one even when a broad
        # pattern (`.*`) would match it, and it's the signal the UI uses to detect a git folder.
        # So never match it by its OWN name — an IGNORED ANCESTOR (tested in earlier iterations)
        # still prunes it, matching git's directory-based model.
        if i == len(segments) and not is_dir and segments[-1] == ".gitignore":
            continue
        prefix = "/".join(segments[:i])
        # Ancestors are always directories; only the final segment keeps the caller's `is_dir`.
        prefix_is_dir = is_dir if i == len(segments) else True
        for dir_rel, spec in specs:
            if dir_rel:
                if prefix == dir_rel or prefix.startswith(dir_rel + "/"):
                    sub_path = prefix[len(dir_rel) + 1 :]
                else:
                    continue
            else:
                sub_path = prefix
            if not sub_path:
                continue
            if spec.match_file(sub_path + "/" if prefix_is_dir else sub_path):
                return True
    return False


def _rollup_recent_entries(
    files: List[MountFile],
    limit: Optional[int],
) -> List[MountFile]:
    """Collapse a freshly-written directory into ONE folder row for the "recent files" view.

    Without this, a `git clone` / `pnpm install` (thousands of files stamped at once) floods the
    latest-N list with arbitrary leaves. Instead a directory that was written as one cohesive batch
    is shown as a single folder entry, while a directory that mixes old and new files keeps its
    individual new file visible.

    "Cohesive batch" is decided per directory by single-linkage, with NO absolute time window to
    tune: a directory collapses when its leaves are packed together in time MORE tightly than they
    are separated from the nearest write OUTSIDE it — internal spread ≤ the gap to the neighbouring
    activity on its better-separated side. Looking at BOTH sides matters: a clone is the OLDEST thing
    in its mount (nothing predates it), yet it is cleanly separated from the edits made AFTER it, so
    the whole `repo/` collapses rather than its inner subdirs. A directory that also holds an old
    file (large internal spread) fails the test, so its lone fresh file still shows. Resolved
    shallow→deep, so a full clone rolls up to `repo/` while a partial regen rolls up to `repo/web/`.
    The mount root is never collapsed (it has no outside neighbour), and a directory needs ≥2 leaves.
    """
    if not files:
        return []

    # Distinct global mtimes → nearest-outside lookup. Every leaf of a directory D sits within D's
    # [min,max], so any global time strictly below D.min (or strictly above D.max) is a file OUTSIDE
    # D — the neighbouring activity D is measured against.
    distinct = sorted({f.mtime for f in files if f.mtime is not None})

    # Per ancestor directory: leaf count (the ≥2 guard), rolled size, min/max mtime (the spread),
    # direct children (the folder's displayed item count), and whether any leaf lacks a timestamp.
    leaf_count: dict[str, int] = {}
    size: dict[str, int] = {}
    min_mtime: dict[str, int] = {}
    max_mtime: dict[str, int] = {}
    direct: dict[str, set] = {}
    has_untimed: dict[str, bool] = {}
    for f in files:
        segments = f.path.split("/")
        for i in range(
            1, len(segments)
        ):  # ancestor directories only (exclude the leaf itself)
            d = "/".join(segments[:i])
            leaf_count[d] = leaf_count.get(d, 0) + 1
            size[d] = size.get(d, 0) + (f.size or 0)
            direct.setdefault(d, set()).add(segments[i])
            if f.mtime is None:
                has_untimed[d] = True
            else:
                if d not in min_mtime or f.mtime < min_mtime[d]:
                    min_mtime[d] = f.mtime
                if d not in max_mtime or f.mtime > max_mtime[d]:
                    max_mtime[d] = f.mtime

    def _cohesive(d: str) -> bool:
        if leaf_count.get(d, 0) < 2 or has_untimed.get(d) or d not in min_mtime:
            return False
        lo, hi = min_mtime[d], max_mtime[d]
        i = bisect_left(distinct, lo)
        pred = distinct[i - 1] if i > 0 else None  # newest write older than D
        j = bisect_right(distinct, hi)
        succ = distinct[j] if j < len(distinct) else None  # oldest write newer than D
        gaps = []
        if pred is not None:
            gaps.append(lo - pred)
        if succ is not None:
            gaps.append(succ - hi)
        # Distinct on at least ONE side (max): a clone with a lone later edit just above it is still
        # a batch thanks to its clean separation from the old baseline below.
        return bool(gaps) and (hi - lo) <= max(gaps)

    # Resolve each leaf to its highest cohesive ancestor (shallow→deep, first match wins); many
    # leaves fold into the one folder entry (deduped by path). A leaf with no cohesive ancestor
    # stays a file row.
    chosen: dict[str, MountFile] = {}
    for f in files:
        segments = f.path.split("/")
        rep: Optional[MountFile] = f
        for i in range(1, len(segments)):
            d = "/".join(segments[:i])
            if _cohesive(d):
                if d not in chosen:
                    chosen[d] = MountFile(
                        path=d,
                        size=size.get(d, 0),
                        is_folder=True,
                        mtime=max_mtime.get(d),
                        item_count=len(direct.get(d, ())),
                    )
                rep = None  # represented by the folder
                break
        if rep is not None and rep.path not in chosen:
            chosen[rep.path] = rep

    entries = list(chosen.values())
    entries.sort(key=lambda e: (e.mtime is None, -(e.mtime or 0), e.path))
    if limit is not None:
        entries = entries[: max(0, limit)]
    return entries


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

    async def _load_gitignore_specs(
        self,
        *,
        gitignore_keys: List[Tuple[str, str]],
    ) -> List[Tuple[str, "pathspec.PathSpec"]]:
        """Read `.gitignore` files (given as `(dir_rel, object_key)`) into per-directory pathspecs.

        Processed SHALLOW→DEEP, skipping any `.gitignore` that lives inside a directory already
        ignored (by a shallower spec) or inside `.git` — so after a dependency install we never fetch
        the hundreds of `.gitignore` files buried in `node_modules/`, which would be hundreds of
        object reads and time the listing out. Capped as a final backstop. Bad ones are skipped.
        """
        ordered = sorted(
            gitignore_keys, key=lambda dk: dk[0].count("/") if dk[0] else -1
        )
        specs: List[Tuple[str, "pathspec.PathSpec"]] = []
        for dir_rel, key in ordered:
            if len(specs) >= _MAX_GITIGNORE_FILES:
                break
            if dir_rel and (
                _is_git_plumbing(dir_rel) or _path_gitignored(dir_rel, True, specs)
            ):
                continue  # this .gitignore is itself inside an ignored/plumbing directory
            try:
                raw = await self.mounts_store.get_object(bucket=self._bucket(), key=key)
                spec = pathspec.PathSpec.from_lines(
                    "gitwildmatch", raw.decode("utf-8", "ignore").splitlines()
                )
                specs.append((dir_rel, spec))
            except Exception:  # noqa: BLE001 - a bad .gitignore must never fail the listing
                continue
        return specs

    async def _read_gitignore_specs(
        self,
        reads: List[Tuple[str, str]],
        existing_specs: List[Tuple[str, "pathspec.PathSpec"]],
    ) -> List[Tuple[str, "pathspec.PathSpec"]]:
        """Read a batch of `.gitignore` objects (as `(dir_rel, key)`) CONCURRENTLY into pathspecs,
        skipping any that live inside an already-ignored/plumbing directory. Bad ones are dropped —
        a malformed `.gitignore` must never fail the listing."""

        async def _read_one(dir_rel: str, key: str):
            if dir_rel and (
                _is_git_plumbing(dir_rel)
                or _path_gitignored(dir_rel, True, existing_specs)
            ):
                return None
            try:
                raw = await self.mounts_store.get_object(bucket=self._bucket(), key=key)
                return (
                    dir_rel,
                    pathspec.PathSpec.from_lines(
                        "gitwildmatch", raw.decode("utf-8", "ignore").splitlines()
                    ),
                )
            except Exception:  # noqa: BLE001
                return None

        results = await asyncio.gather(*(_read_one(d, k) for d, k in reads))
        return [r for r in results if r is not None]

    async def _list_pruned_files(
        self,
        *,
        base_prefix: str,
        mount_base: str,
        cap: Optional[int] = None,
    ) -> Tuple[List[StoreObject], List[Tuple[str, "pathspec.PathSpec"]], bool]:
        """Enumerate a mount's FILES by descending the tree LEVEL BY LEVEL, skipping `.git` and
        gitignored DIRECTORIES at the store layer — so a dependency dump (`node_modules`, tens of
        thousands of objects) is never enumerated at all. The flat `recursive=True` listing cannot
        exclude a prefix, so it must scan every object; this walks only what survives, listing sibling
        directories concurrently (bounded by `_LIST_CONCURRENCY`) so wall-clock tracks the tree DEPTH,
        not the object count. Each level's `.gitignore` files are read before that level's children are
        pruned, so the repo's own rules drive the prune.

        `cap` early-stops the descent once that many files are collected — for a bounded COUNT of a
        pathologically large (non-ignored) tree, so the cost never runs away regardless of contents.

        Returns (kept StoreObjects, specs, truncated). `truncated` is True when the `cap` stopped the
        walk early (the real count is higher). The caller still applies FILE-level gitignore for
        ignored FILES inside kept directories (this only prunes whole directories).
        """
        bucket = self._bucket()
        semaphore = asyncio.Semaphore(_LIST_CONCURRENCY)
        specs: List[Tuple[str, "pathspec.PathSpec"]] = []
        kept: List[StoreObject] = []

        async def _shallow(prefix: str):
            async with semaphore:
                return await self.mounts_store.list_objects_shallow(
                    bucket=bucket, prefix=prefix
                )

        truncated = False
        # Guard against re-listing a prefix: an object store returns a directory's own empty-folder
        # MARKER (a trailing-slash key equal to the prefix) as a "subdir", so without this the walk
        # would re-list the same prefix forever (a hang). `visited` also defends against any other
        # cyclic marker the store might surface.
        visited = {base_prefix}
        frontier = [base_prefix]
        while frontier:
            listings = await asyncio.gather(*(_shallow(p) for p in frontier))
            gitignore_reads: List[Tuple[str, str]] = []
            subdir_prefixes: List[str] = []
            for level_files, level_subdirs in listings:
                for obj in level_files:
                    kept.append(obj)
                    rel = (
                        obj.key[len(mount_base) :]
                        if obj.key.startswith(mount_base)
                        else obj.key
                    )
                    if rel == ".gitignore" or rel.endswith("/.gitignore"):
                        dir_rel = (
                            "" if rel == ".gitignore" else rel[: -len("/.gitignore")]
                        )
                        gitignore_reads.append((dir_rel, obj.key))
                subdir_prefixes.extend(level_subdirs)

            # Bounded COUNT: enough to know it's "more than the cap" — stop before descending further.
            if cap is not None and len(kept) >= cap:
                truncated = True
                break

            # This level's `.gitignore`s must be in scope BEFORE we prune this level's children.
            if gitignore_reads and len(specs) < _MAX_GITIGNORE_FILES:
                specs.extend(await self._read_gitignore_specs(gitignore_reads, specs))

            frontier = []
            for sub_prefix in subdir_prefixes:
                if (
                    sub_prefix in visited
                ):  # already walked (or a self-marker) — never re-list
                    continue
                dir_rel = (
                    sub_prefix[len(mount_base) :]
                    if sub_prefix.startswith(mount_base)
                    else sub_prefix
                ).rstrip("/")
                if not dir_rel:
                    continue
                if _is_git_plumbing(dir_rel) or _path_gitignored(dir_rel, True, specs):
                    continue
                visited.add(sub_prefix)
                frontier.append(sub_prefix)
        return kept, specs, truncated

    async def list_files(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: Optional[str] = None,
        order: Optional[str] = None,
        limit: Optional[int] = None,
        depth: Optional[int] = None,
        with_counts: bool = False,
        git_aware: bool = False,
        include_gitignored: bool = False,
    ) -> MountFileList:
        """List a mount's files.

        Default (no `order`/`limit`/`depth`): the whole tree — real files plus synthesized folder
        entries — for the browsable explorer. When `order` (`recent`|`name`|`path`) or `limit` is
        given, a FLAT file view instead, sorted and truncated, with `total` reporting the full
        pre-limit count so the UI can show it without fetching the whole tree. When `depth=1`, ONE
        delimiter listing of just the top level (top-level files + folders, no descent) — the cheap
        "what's in this drive" summary.

        `git_aware` (default False) is OFF by design: a plain `list_files` returns the RAW object
        listing — every key under the prefix, `.git` plumbing and `.gitignore`-matched paths included
        — so the endpoint's contract is "list what's actually stored" for any consumer. When ON (the
        Agenta playground opts in on its own queries), the listing becomes the curated developer view:
        the `.git` directory and repo-`.gitignore`-matched paths (e.g. an agent's `npm install`
        output) are pruned, runner-internal artifacts are hidden, and — for perf — the flat/recency
        modes descend level-by-level pruning ignored DIRECTORIES at the store layer instead of
        enumerating a `node_modules` dump. Pruning drives both the count and the tree in that mode.

        `include_gitignored` (git_aware only) surfaces `.gitignore`-matched files again — the UI's
        "show git-ignored files" toggle — while STILL hiding `.git` plumbing and runner internals.
        Applies to the `depth=1` and browse views (the drawer + its search); the summary flat/count
        view ignores it. Off by default.
        """
        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)

        base = self._storage_key(project_id=project_id, mount=mount).rstrip("/")
        prefix = base
        if path:
            validate_file_path(path)
            prefix = self._storage_key(
                project_id=project_id, mount=mount, path=path
            ).rstrip("/")

        list_prefix = prefix + "/"
        mount_base = base + "/"

        # SHALLOW view (`depth=1`): ONE delimiter listing of just this level — the immediate files and
        # folders under the prefix, with NO descent. Constant cost regardless of subtree size, so the
        # lazy drawer loads one directory at a time (the whole tree is never fetched to open it) and the
        # always-mounted summary can show "what's in this drive" cheaply.
        #
        # When `git_aware`, immediate children are pruned by `.git`, runner internals, AND repo
        # `.gitignore` — so `node_modules` and friends stay hidden while browsing, consistent with the
        # flat/browse curated views. When `with_counts`, each surviving subdir gets an `item_count` of
        # its own immediate (pruned) children via one bounded shallow list, run concurrently.
        if depth == 1 and order is None and limit is None:
            bucket = self._bucket()
            # git applies every ancestor's `.gitignore` to a path, so read the few that live from the
            # mount root down to THIS dir and prune the level (and the counts) with them.
            # `include_gitignored` keeps `.gitignore`-matched files (the user opted to see them) — so
            # there's nothing to prune with, and we skip the ancestor-`.gitignore` reads entirely.
            # `.git` plumbing and runner internals stay hidden regardless.
            specs: List[Tuple[str, "pathspec.PathSpec"]] = []
            if git_aware and not include_gitignored:
                path_rel = list_prefix[len(mount_base) :].rstrip("/")
                gi_dirs = [""]
                if path_rel:
                    segs = path_rel.split("/")
                    gi_dirs += ["/".join(segs[: i + 1]) for i in range(len(segs))]
                specs = await self._read_gitignore_specs(
                    [
                        (d, f"{mount_base}{d + '/' if d else ''}.gitignore")
                        for d in gi_dirs
                    ],
                    [],
                )

            def _keep(rel: str, is_dir: bool) -> bool:
                if not git_aware:
                    return True
                if _is_git_plumbing(rel) or _is_internal_mount_path(rel):
                    return False
                if include_gitignored:
                    return True
                return not (specs and _path_gitignored(rel, is_dir, specs))

            level_files, level_subdirs = await self.mounts_store.list_objects_shallow(
                bucket=bucket, prefix=list_prefix
            )
            shallow: List[MountFile] = []
            seen: set[str] = set()
            for obj in level_files:
                rel = (
                    obj.key[len(mount_base) :]
                    if obj.key.startswith(mount_base)
                    else obj.key
                )
                if not rel or not _keep(rel, False):
                    continue
                seen.add(rel)
                shallow.append(MountFile(path=rel, size=obj.size, mtime=obj.mtime))
            subdir_rels: List[str] = []
            for sub_key in level_subdirs:
                rel = (
                    sub_key[len(mount_base) :]
                    if sub_key.startswith(mount_base)
                    else sub_key
                ).rstrip("/")
                # The store surfaces the prefix's OWN empty-folder marker as a subdir — that strips to
                # "" and is dropped, so the listing never contains the folder it's listing.
                if not rel or rel in seen or not _keep(rel, True):
                    continue
                seen.add(rel)
                subdir_rels.append(rel)

            counts: dict[str, int] = {}
            if with_counts and subdir_rels:
                semaphore = asyncio.Semaphore(_LIST_CONCURRENCY)

                async def _count_children(sub_rel: str) -> Tuple[str, int]:
                    async with semaphore:
                        c_files, c_subs = await self.mounts_store.list_objects_shallow(
                            bucket=bucket, prefix=f"{mount_base}{sub_rel}/"
                        )
                    child_seen: set[str] = set()
                    n = 0
                    for o in c_files:
                        r = (
                            o.key[len(mount_base) :]
                            if o.key.startswith(mount_base)
                            else o.key
                        )
                        if r and r != sub_rel and _keep(r, False):
                            child_seen.add(r)
                            n += 1
                    for s in c_subs:
                        r = (
                            s[len(mount_base) :] if s.startswith(mount_base) else s
                        ).rstrip("/")
                        if (
                            r
                            and r != sub_rel
                            and r not in child_seen
                            and _keep(r, True)
                        ):
                            child_seen.add(r)
                            n += 1
                    return sub_rel, n

                for sub_rel, n in await asyncio.gather(
                    *(_count_children(s) for s in subdir_rels)
                ):
                    counts[sub_rel] = n

            for rel in subdir_rels:
                shallow.append(
                    MountFile(
                        path=rel, size=0, is_folder=True, item_count=counts.get(rel)
                    )
                )
            return MountFileList(files=shallow, total=len(shallow))

        # RECENCY / FLAT view (order or limit set) — FILES only, the query shown on every load.
        if order is not None or limit is not None:
            # Count-only (`limit=0`, no order): the summary derives its recents from records, so it
            # only needs a BOUNDED count — cap the descent so a huge tree can't run away.
            count_only = limit == 0 and order is None
            cap = _COUNT_CAP if count_only else None
            if git_aware:
                # Descend pruning ignored/plumbing DIRECTORIES at the store level (never enumerate a
                # `node_modules` dump) rather than scanning the whole object set.
                store_files, specs, truncated = await self._list_pruned_files(
                    base_prefix=list_prefix, mount_base=mount_base, cap=cap
                )
            elif cap is not None:
                # RAW count-only: page until MORE than `cap` real files are known to exist (the UI
                # then shows "N+") or the tree is exhausted, so a huge tree can't run away (matches
                # the git-aware branch's bounded-count contract). `has_more` counts OBJECTS, not
                # files, so truncation is decided on the file count alone — folder markers never
                # inflate `total` into a false "N+" (they are assumed sparse; a marker-only tree is
                # the one case still paged to exhaustion).
                store_files = []
                specs: List[Tuple[str, "pathspec.PathSpec"]] = []
                truncated = False
                start_after: Optional[str] = None
                while len(store_files) <= cap:
                    objs, has_more = await self.mounts_store.list_objects_page(
                        bucket=self._bucket(),
                        prefix=list_prefix,
                        start_after=start_after,
                        max_keys=max(cap, 200),
                    )
                    if not objs:
                        break
                    start_after = objs[-1].key
                    store_files.extend(o for o in objs if not o.key.endswith("/"))
                    if not has_more:
                        break
                if len(store_files) > cap:
                    truncated = True
                    store_files = store_files[:cap]
            else:
                # RAW: every object under the prefix, no pruning (matches the plain-endpoint contract).
                objects = await self.mounts_store.list_objects_v2(
                    bucket=self._bucket(), prefix=list_prefix
                )
                store_files = [o for o in objects if not o.key.endswith("/")]
                specs: List[Tuple[str, "pathspec.PathSpec"]] = []
                truncated = False
            files = [
                MountFile(
                    path=(
                        o.key[len(mount_base) :]
                        if o.key.startswith(mount_base)
                        else o.key
                    ),
                    size=o.size,
                    mtime=o.mtime,
                )
                for o in store_files
            ]
            if git_aware:
                # Whole-directory pruning happened at the store level; a `.git` file or a gitignored
                # FILE inside a KEPT directory (e.g. a stray `*.pyc`) still needs dropping here.
                files = [f for f in files if not _is_git_plumbing(f.path)]
                if specs:
                    files = [
                        f for f in files if not _path_gitignored(f.path, False, specs)
                    ]
                files = [f for f in files if not _is_internal_mount_path(f.path)]
            total = len(files)
            if count_only:
                return MountFileList(files=[], total=total, total_capped=truncated)
            if order == "recent":
                if git_aware:
                    # Drop dotfile plumbing (`.claude/…`, `.gitignore`) — the recency list reads as
                    # "what did I just work on" — then roll a fresh directory into one folder row.
                    visible = [f for f in files if not _is_hidden_path(f.path)]
                    entries = _rollup_recent_entries(visible, limit)
                    return MountFileList(files=entries, total=total)
                # RAW recency: newest object-store mtime first, no rollup/hidden pruning.
                files.sort(key=lambda f: f.mtime or 0, reverse=True)
                if limit is not None:
                    files = files[: max(0, limit)]
                return MountFileList(files=files, total=total)
            if order == "name":
                files.sort(key=lambda f: basename(f.path).lower())
            elif order == "path":
                files.sort(key=lambda f: f.path.lower())
            if limit is not None:
                files = files[: max(0, limit)]
            return MountFileList(files=files, total=total)

        # BROWSE view (no order/limit): the whole tree + synthesized folder entries, via the flat
        # listing (it must surface empty-folder markers, and only opens on demand — not on every load).
        objects = await self.mounts_store.list_objects_v2(
            bucket=self._bucket(), prefix=list_prefix
        )
        browse_files: List[MountFile] = []
        folders: set[str] = set()
        gitignore_keys: List[Tuple[str, str]] = []
        for obj in objects:
            key = obj.key
            rel = key[len(mount_base) :] if key.startswith(mount_base) else key
            # Hide bare trailing-slash marker objects (empty-folder markers).
            if key.endswith("/"):
                folder_rel = rel.rstrip("/")
                if folder_rel:
                    folders.add(folder_rel)
                continue
            browse_files.append(MountFile(path=rel, size=obj.size, mtime=obj.mtime))
            if rel == ".gitignore" or rel.endswith("/.gitignore"):
                dir_rel = "" if rel == ".gitignore" else rel[: -len("/.gitignore")]
                gitignore_keys.append((dir_rel, key))

        # RAW (git_aware off): keep `.git` + gitignored entries — the plain-endpoint contract. When ON,
        # prune `.git` plumbing (always) and repo-`.gitignore`-matched paths (unless `include_gitignored`,
        # where the user opted to see them — `.git` still goes).
        if git_aware:
            browse_files = [f for f in browse_files if not _is_git_plumbing(f.path)]
            folders = {d for d in folders if not _is_git_plumbing(d)}
            if not include_gitignored and gitignore_keys:
                specs = await self._load_gitignore_specs(gitignore_keys=gitignore_keys)
                if specs:
                    browse_files = [
                        f
                        for f in browse_files
                        if not _path_gitignored(f.path, False, specs)
                    ]
                    folders = {
                        d for d in folders if not _path_gitignored(d, True, specs)
                    }

        existing = {f.path for f in browse_files}
        for folder_rel in sorted(folders):
            if folder_rel not in existing:
                browse_files.append(MountFile(path=folder_rel, size=0, is_folder=True))

        return MountFileList(files=browse_files, total=len(browse_files))

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

    async def build_archive_work_list(
        self,
        *,
        project_id: UUID,
        mounts: List[MountArchiveSource],
    ) -> List[Tuple[str, str, int, Optional[int]]]:
        """Build the ordered archive work list for the given mounts.

        Each mount is a ``(mount_id, zip_prefix, source_path)``:
        ``source_path`` scopes it to a FOLDER within the mount ("" = the whole mount, for "download
        all"); ``zip_prefix`` places its files under ``prefix/`` in the zip (e.g. "agent-files" for
        the folded agent mount). Folder markers are skipped. Each work item is a
        ``(zip_path, storage_key, size, mtime)`` tuple.
        """
        bucket = self._bucket()

        work: List[Tuple[str, str, int, Optional[int]]] = []
        for source in mounts:
            if source.archive_prefix:
                validate_file_path(source.archive_prefix)
            if source.source_path:
                validate_file_path(source.source_path)
            mount = await self._resolve_mount(
                project_id=project_id, mount_id=source.mount_id
            )
            mount_base = self._storage_key(project_id=project_id, mount=mount)
            pfx_segments = _safe_zip_segments(source.archive_prefix)
            src = source.source_path.strip("/")
            # Scope the listing to a folder when `source_path` is set (folder download); the
            # rel path still keeps the folder, so the zip has "<folder>/…" entries.
            list_prefix = f"{mount_base}{src}/" if src else mount_base
            objects = await self.mounts_store.list_objects_v2(
                bucket=bucket, prefix=list_prefix
            )
            for obj in objects:
                if obj.key.endswith("/"):
                    continue
                rel = (
                    obj.key[len(mount_base) :]
                    if obj.key.startswith(mount_base)
                    else obj.key
                )
                rel_segments = _zip_segments(rel)
                # Store keys come from signed-credential writers, so `rel` can carry `..` or a
                # backslash. Don't REWRITE such a key — `a/../report.txt` would collapse onto a real
                # `a/report.txt` and overwrite it on extraction — skip the member instead.
                if _has_unsafe_zip_segment(rel_segments):
                    log.warning(
                        "mounts.archive: skipping member with unsafe store key",
                        key=obj.key,
                    )
                    continue
                zip_path = "/".join([*pfx_segments, *rel_segments])
                work.append((zip_path, obj.key, obj.size or 0, obj.mtime))

        return work

    async def iter_archive_members(
        self,
        *,
        work: List[Tuple[str, str, int, Optional[int]]],
        concurrency: int = _ARCHIVE_READ_CONCURRENCY,
    ) -> AsyncIterator[Tuple[str, int, Optional[int], bytes]]:
        """Yield ``(zip_path, size, mtime, raw_bytes)`` with bounded ordered prefetch."""
        bucket = self._bucket()

        # Ordered bounded-concurrency prefetch: keep ~`concurrency` reads in flight, yield in order.
        inflight: deque = deque()
        cursor = 0

        def schedule() -> None:
            nonlocal cursor
            while len(inflight) < max(1, concurrency) and cursor < len(work):
                zip_path, key, size, mtime = work[cursor]
                task = asyncio.create_task(
                    self.mounts_store.get_object(bucket=bucket, key=key)
                )
                inflight.append((zip_path, size, mtime, task))
                cursor += 1

        try:
            schedule()
            while inflight:
                zip_path, size, mtime, task = inflight.popleft()
                body = await task
                yield zip_path, size, mtime, body
                schedule()
        finally:
            # Client disconnect / early close: cancel reads still in flight so they don't orphan.
            for _zip_path, _size, _mtime, task in inflight:
                task.cancel()

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
        keys = [obj.key for obj in objects]

        # The exact file (or the folder marker) may also exist alongside contents.
        single = await self.mounts_store.list_objects_v2(
            bucket=bucket,
            prefix=exact_key,
        )
        if any(obj.key == exact_key for obj in single):
            keys.append(exact_key)

        unique_keys = list(dict.fromkeys(keys))
        if not unique_keys:
            raise MountFileNotFound()

        count = await self.mounts_store.delete_keys(
            bucket=bucket,
            keys=unique_keys,
        )
        return MountFileDeleted(deleted=path, count=count)
