from re import fullmatch
from typing import List, Optional
from uuid import UUID

from oss.src.core.mounts.dtos import (
    Mount,
    MountCreate,
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
from oss.src.core.mounts.storage import MountStorage
from oss.src.core.mounts.types import (
    MountDataInvalid,
    MountFileNotFound,
    MountNotFound,
    MountPathInvalid,
)
from oss.src.core.shared.dtos import Windowing

# Folder segments must match word chars, spaces, and hyphens — no path traversal.
_SEGMENT_RE = r"[\w. -]+"
_DATA_SEGMENT_RE = r"[\w -]+"


def _validate_path_segment(value: str, field: str, segment_re: str) -> None:
    if value.startswith("/"):
        raise MountDataInvalid(f"Mount '{field}' must not be an absolute path.")
    for segment in value.split("/"):
        if not segment:
            continue
        if segment == ".." or not fullmatch(segment_re, segment):
            raise MountDataInvalid(
                f"Mount '{field}' contains invalid characters or path traversal."
            )


def validate_bucket(bucket: str) -> None:
    _validate_path_segment(bucket, "bucket", _DATA_SEGMENT_RE)


def validate_prefix(prefix: str) -> None:
    _validate_path_segment(prefix, "prefix", _DATA_SEGMENT_RE)


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


def _join_key(prefix: str, path: str) -> str:
    return f"{prefix.rstrip('/')}/{path.lstrip('/')}"


def _relativize(key: str, prefix: str) -> str:
    base = prefix.rstrip("/") + "/"
    return key[len(base) :] if key.startswith(base) else key


class MountsService:
    def __init__(
        self,
        *,
        mounts_dao: MountsDAOInterface,
        mount_storage: Optional[MountStorage] = None,
    ):
        self.mounts_dao = mounts_dao
        self.mount_storage = mount_storage

    async def create_mount(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        mount_create: MountCreate,
    ) -> Mount:
        validate_bucket(mount_create.data.bucket)
        validate_prefix(mount_create.data.prefix)

        return await self.mounts_dao.create_mount(
            project_id=project_id,
            user_id=user_id,
            #
            mount_create=mount_create,
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

    async def list_files(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: Optional[str] = None,
    ) -> MountFileList:
        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)

        prefix = mount.data.prefix.rstrip("/")
        if path:
            validate_file_path(path)
            prefix = _join_key(mount.data.prefix, path).rstrip("/")

        list_prefix = prefix + "/"
        objects = await self.mount_storage.list_objects(
            bucket=mount.data.bucket,
            prefix=list_prefix,
        )

        files: List[MountFile] = []
        folders: set[str] = set()
        for key, size in objects:
            rel = _relativize(key, mount.data.prefix)
            # Hide bare trailing-slash marker objects (empty-folder markers).
            if key.endswith("/"):
                folder_rel = rel.rstrip("/")
                if folder_rel:
                    folders.add(folder_rel)
                continue
            files.append(MountFile(path=rel, size=size))

        existing = {f.path for f in files}
        for folder_rel in sorted(folders):
            if folder_rel not in existing:
                files.append(MountFile(path=folder_rel, size=0, is_folder=True))

        return MountFileList(files=files)

    async def read_file(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
    ) -> MountFileContent:
        validate_file_path(path)
        mount = await self._resolve_mount(project_id=project_id, mount_id=mount_id)

        key = _join_key(mount.data.prefix, path)
        body = await self.mount_storage.get_object(
            bucket=mount.data.bucket,
            key=key,
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

        key = _join_key(mount.data.prefix, path)
        size = await self.mount_storage.put_object(
            bucket=mount.data.bucket,
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
        key = _join_key(mount.data.prefix, folder) + "/"
        await self.mount_storage.put_object(
            bucket=mount.data.bucket,
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
        exact_key = _join_key(mount.data.prefix, path.rstrip("/"))
        folder_prefix = exact_key + "/"

        objects = await self.mount_storage.list_objects(
            bucket=mount.data.bucket,
            prefix=folder_prefix,
        )
        keys = [key for key, _ in objects]

        # The exact file (or the folder marker) may also exist alongside contents.
        single = await self.mount_storage.list_objects(
            bucket=mount.data.bucket,
            prefix=exact_key,
        )
        if any(key == exact_key for key, _ in single):
            keys.append(exact_key)

        unique_keys = list(dict.fromkeys(keys))
        if not unique_keys:
            raise MountFileNotFound()

        count = await self.mount_storage.delete_keys(
            bucket=mount.data.bucket,
            keys=unique_keys,
        )
        return MountFileDeleted(deleted=path, count=count)
