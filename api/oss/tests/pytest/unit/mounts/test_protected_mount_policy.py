from datetime import datetime, timezone
from re import compile, escape
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException, status
from pydantic import ValidationError

from oss.src.apis.fastapi.mounts.models import MountCreateRequest, PublicMountCreate
from oss.src.apis.fastapi.mounts.router import handle_mount_exceptions
from oss.src.core.mounts.dtos import (
    Mount,
    MountArchiveSource,
    MountCreate,
    MountEdit,
    MountFlags,
    MountQuery,
)
from oss.src.core.mounts.service import (
    ATTACHMENTS_MOUNT_NAME,
    ATTACHMENTS_MOUNT_PURPOSE,
    MountsService,
    is_protected_mount,
    mint_session_slug,
)
from oss.src.core.mounts.types import (
    PROTECTED_MOUNT_SLUG_LIKE_ESCAPE,
    MountImmutableField,
    MountNameInvalid,
    MountProtected,
    MountStorageUnavailable,
    protected_mount_slug_like_pattern,
)

_PROJECT_ID = uuid4()
_USER_ID = uuid4()
_SESSION_ID = "protected-mount-policy"
_BUCKET = "test-bucket"
_PATH = "attachment.txt"


def _mount(
    *,
    name: str,
    purpose: str | None = None,
    session_id: str = _SESSION_ID,
    archived: bool = False,
) -> Mount:
    return Mount(
        id=uuid4(),
        project_id=_PROJECT_ID,
        slug=mint_session_slug(session_id=session_id, name=name),
        name=name,
        session_id=session_id,
        purpose=purpose,
        deleted_at=datetime.now(timezone.utc) if archived else None,
    )


class _MountsDAO:
    def __init__(self, mounts: list[Mount]):
        self.mounts = {mount.id: mount for mount in mounts}
        self.fetch_by_slug_override: Mount | None = None
        self.last_upsert: MountCreate | None = None

    async def fetch_mount(self, *, project_id, mount_id):
        mount = self.mounts.get(mount_id)
        return mount if mount and mount.project_id == project_id else None

    async def fetch_mount_by_slug(self, *, project_id, slug):
        if self.fetch_by_slug_override is not None:
            return self.fetch_by_slug_override
        return next(
            (
                mount
                for mount in self.mounts.values()
                if mount.project_id == project_id
                and mount.slug == slug
                and mount.deleted_at is None
            ),
            None,
        )

    async def query_mounts(
        self,
        *,
        project_id,
        mount_query=None,
        windowing=None,
    ):
        del windowing
        mounts = [
            mount for mount in self.mounts.values() if mount.project_id == project_id
        ]
        if mount_query:
            if mount_query.session_id is not None:
                mounts = [
                    mount
                    for mount in mounts
                    if mount.session_id == mount_query.session_id
                ]
            if mount_query.agent_id is not None:
                mounts = [
                    mount for mount in mounts if mount.agent_id == mount_query.agent_id
                ]
            if not mount_query.include_archived:
                mounts = [mount for mount in mounts if mount.deleted_at is None]
        else:
            mounts = [mount for mount in mounts if mount.deleted_at is None]
        mounts = [mount for mount in mounts if not is_protected_mount(mount)]
        return mounts

    async def upsert_mount(self, *, project_id, user_id, mount_create):
        del user_id
        self.last_upsert = mount_create
        existing = next(
            (
                mount
                for mount in self.mounts.values()
                if mount.project_id == project_id and mount.slug == mount_create.slug
            ),
            None,
        )
        if existing:
            return existing
        mount = Mount(
            id=uuid4(),
            project_id=project_id,
            slug=mount_create.slug,
            name=mount_create.name,
            session_id=mount_create.session_id,
            purpose=mount_create.purpose,
        )
        self.mounts[mount.id] = mount
        return mount

    async def edit_mount(self, *, project_id, user_id, mount_edit):
        del user_id
        mount = await self.fetch_mount(project_id=project_id, mount_id=mount_edit.id)
        if mount is None:
            return None
        edited = mount.model_copy(
            update={
                "name": mount_edit.name,
                "description": mount_edit.description,
            }
        )
        self.mounts[mount.id] = edited
        return edited

    async def archive_mount(self, *, project_id, user_id, mount_id):
        mount = await self.fetch_mount(project_id=project_id, mount_id=mount_id)
        if mount is None:
            return None
        archived = mount.model_copy(
            update={
                "deleted_at": datetime.now(timezone.utc),
                "deleted_by_id": user_id,
            }
        )
        self.mounts[mount.id] = archived
        return archived

    async def unarchive_mount(self, *, project_id, user_id, mount_id):
        mount = await self.fetch_mount(project_id=project_id, mount_id=mount_id)
        if mount is None:
            return None
        unarchived = mount.model_copy(
            update={
                "deleted_at": None,
                "deleted_by_id": None,
                "updated_by_id": user_id,
            }
        )
        self.mounts[mount.id] = unarchived
        return unarchived

    async def delete_by_session_id(self, *, project_id, session_id):
        deleted = [
            mount
            for mount in self.mounts.values()
            if mount.project_id == project_id and mount.session_id == session_id
        ]
        for mount in deleted:
            del self.mounts[mount.id]
        return deleted


class _ObjectStore:
    endpoint_url = "http://store"
    region = "test-region"

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.deleted_prefixes: list[str] = []

    async def put_object(self, *, bucket, key, body):
        assert bucket == _BUCKET
        self.objects[key] = body
        return len(body)

    async def get_object(self, *, bucket, key):
        assert bucket == _BUCKET
        return self.objects[key]

    async def list_objects_v2(self, *, bucket, prefix):
        assert bucket == _BUCKET
        return [
            SimpleNamespace(key=key, size=len(body), mtime=1)
            for key, body in self.objects.items()
            if key.startswith(prefix)
        ]

    async def delete_keys(self, *, bucket, keys):
        assert bucket == _BUCKET
        deleted = 0
        for key in keys:
            if key in self.objects:
                del self.objects[key]
                deleted += 1
        return deleted

    async def delete_prefix(self, *, bucket, prefix):
        assert bucket == _BUCKET
        self.deleted_prefixes.append(prefix)
        keys = [key for key in self.objects if key.startswith(prefix)]
        for key in keys:
            del self.objects[key]
        return len(keys)

    async def sign_temp_credentials(self, *, bucket, prefix, duration_seconds):
        assert bucket == _BUCKET
        assert prefix
        assert duration_seconds > 0
        return SimpleNamespace(
            access_key="access",
            secret_key="secret",
            session_token="token",
        )


@pytest.fixture
def mount_context():
    protected = _mount(
        name=ATTACHMENTS_MOUNT_NAME,
        purpose=ATTACHMENTS_MOUNT_PURPOSE,
    )
    cwd = _mount(name="cwd")
    dao = _MountsDAO([protected, cwd])
    store = _ObjectStore()
    store.objects[f"mounts/{_PROJECT_ID}/{cwd.id}/{_PATH}"] = b"content"
    service = MountsService(
        mounts_dao=dao,
        mounts_store=store,
        bucket=_BUCKET,
    )
    return service, dao, store, protected, cwd


_GENERIC_OPERATIONS = (
    "edit_mount",
    "archive_mount",
    "unarchive_mount",
    "list_files",
    "read_file",
    "read_file_bytes",
    "build_archive_work_list",
    "write_file",
    "create_folder",
    "delete_path",
    "sign_mount_credentials",
)


def _generic_mount_calls(service, mount):
    return {
        "edit_mount": lambda: service.edit_mount(
            project_id=_PROJECT_ID,
            user_id=_USER_ID,
            mount_edit=MountEdit(id=mount.id, name="renamed"),
        ),
        "archive_mount": lambda: service.archive_mount(
            project_id=_PROJECT_ID,
            user_id=_USER_ID,
            mount_id=mount.id,
        ),
        "unarchive_mount": lambda: service.unarchive_mount(
            project_id=_PROJECT_ID,
            user_id=_USER_ID,
            mount_id=mount.id,
        ),
        "list_files": lambda: service.list_files(
            project_id=_PROJECT_ID,
            mount_id=mount.id,
        ),
        "read_file": lambda: service.read_file(
            project_id=_PROJECT_ID,
            mount_id=mount.id,
            path=_PATH,
        ),
        "read_file_bytes": lambda: service.read_file_bytes(
            project_id=_PROJECT_ID,
            mount_id=mount.id,
            path=_PATH,
        ),
        "build_archive_work_list": lambda: service.build_archive_work_list(
            project_id=_PROJECT_ID,
            mounts=[MountArchiveSource(mount_id=mount.id)],
        ),
        "write_file": lambda: service.write_file(
            project_id=_PROJECT_ID,
            mount_id=mount.id,
            path=_PATH,
            content=b"replacement",
        ),
        "create_folder": lambda: service.create_folder(
            project_id=_PROJECT_ID,
            mount_id=mount.id,
            path="folder",
        ),
        "delete_path": lambda: service.delete_path(
            project_id=_PROJECT_ID,
            mount_id=mount.id,
            path=_PATH,
        ),
        "sign_mount_credentials": lambda: service.sign_mount_credentials(
            project_id=_PROJECT_ID,
            mount_id=mount.id,
        ),
    }


def test_protected_classification_uses_purpose_then_legacy_slug_fallback():
    purpose_mount = _mount(name="not-attachments", purpose=ATTACHMENTS_MOUNT_PURPOSE)
    legacy_mount = _mount(name=ATTACHMENTS_MOUNT_NAME)
    cwd = _mount(name="cwd")

    assert is_protected_mount(purpose_mount)
    assert is_protected_mount(legacy_mount)
    assert not is_protected_mount(cwd)


def _like_to_regex(pattern: str) -> str:
    """Translate a SQL `LIKE ... ESCAPE` pattern to an equivalent regular expression."""
    regex = ""
    literal = False
    for char in pattern:
        if literal:
            regex += escape(char)
            literal = False
        elif char == PROTECTED_MOUNT_SLUG_LIKE_ESCAPE:
            literal = True
        elif char == "%":
            regex += ".*"
        elif char == "_":
            regex += "."
        else:
            regex += escape(char)
    return regex


def test_dao_slug_predicate_matches_what_the_service_mints():
    # The DAO applies this pattern in SQL and the service re-checks in Python; a drift
    # between the two silently returns a protected mount from the query path.
    pattern = compile(_like_to_regex(protected_mount_slug_like_pattern()))

    assert pattern.fullmatch(
        mint_session_slug(session_id=_SESSION_ID, name=ATTACHMENTS_MOUNT_NAME)
    )
    assert not pattern.fullmatch(mint_session_slug(session_id=_SESSION_ID, name="cwd"))
    # The literal underscores are escaped, so they match underscores and nothing else.
    assert not pattern.fullmatch(
        mint_session_slug(session_id=_SESSION_ID, name=ATTACHMENTS_MOUNT_NAME).replace(
            "_", "x"
        )
    )


def test_purpose_is_server_owned_create_data_not_an_editable_flag():
    assert "purpose" in Mount.model_fields
    assert "purpose" in MountCreate.model_fields
    assert "purpose" not in MountEdit.model_fields
    assert "purpose" not in MountFlags.model_fields
    assert "purpose" not in PublicMountCreate.model_fields


@pytest.mark.asyncio
async def test_generic_create_rejects_client_authored_purpose(mount_context):
    service, _, _, _, _ = mount_context

    with pytest.raises(MountImmutableField) as exc_info:
        await service.create_mount(
            project_id=_PROJECT_ID,
            user_id=_USER_ID,
            mount_create=MountCreate(
                slug="client-mount",
                name="client-mount",
                purpose=ATTACHMENTS_MOUNT_PURPOSE,
            ),
        )

    assert exc_info.value.field == "purpose"


def test_public_create_rejects_client_authored_purpose():
    with pytest.raises(ValidationError):
        MountCreateRequest(
            mount={
                "slug": "client-mount",
                "name": "client-mount",
                "purpose": ATTACHMENTS_MOUNT_PURPOSE,
            }
        )


@pytest.mark.parametrize(
    "slug,name",
    [
        ("attachments", None),
        ("other", "attachments"),
        ("ATTACHMENTS", "display-name"),
    ],
)
@pytest.mark.asyncio
async def test_generic_session_create_rejects_reserved_attachment_name(
    mount_context,
    slug,
    name,
):
    service, _, _, _, _ = mount_context

    with pytest.raises(MountNameInvalid):
        await service.create_mount(
            project_id=_PROJECT_ID,
            user_id=_USER_ID,
            mount_create=MountCreate(
                slug=slug,
                name=name,
                session_id=_SESSION_ID,
            ),
        )


@pytest.mark.asyncio
async def test_fetch_and_query_hide_protected_mounts(mount_context):
    service, _, _, protected, cwd = mount_context

    assert (
        await service.fetch_mount(
            project_id=_PROJECT_ID,
            mount_id=protected.id,
        )
        is None
    )
    assert await service.fetch_mount(project_id=_PROJECT_ID, mount_id=cwd.id) == cwd

    mounts = await service.query_mounts(
        project_id=_PROJECT_ID,
        mount_query=MountQuery(session_id=_SESSION_ID),
    )
    assert [mount.id for mount in mounts] == [cwd.id]


@pytest.mark.parametrize("operation", _GENERIC_OPERATIONS)
@pytest.mark.asyncio
async def test_every_generic_by_id_operation_rejects_protected_mount(
    mount_context,
    operation,
):
    service, _, _, protected, _ = mount_context
    calls = _generic_mount_calls(service, protected)

    with pytest.raises(MountProtected):
        await calls[operation]()


@pytest.mark.parametrize("operation", _GENERIC_OPERATIONS)
@pytest.mark.asyncio
async def test_every_generic_by_id_operation_still_accepts_cwd(
    mount_context,
    operation,
):
    service, _, _, _, cwd = mount_context
    calls = _generic_mount_calls(service, cwd)

    assert await calls[operation]() is not None


@pytest.mark.asyncio
async def test_attachments_name_is_reserved_without_server_purpose(mount_context):
    service, dao, _, _, _ = mount_context

    with pytest.raises(MountNameInvalid):
        await service.get_or_create_session_mount(
            project_id=_PROJECT_ID,
            user_id=_USER_ID,
            session_id=_SESSION_ID,
            name="ATTACHMENTS",
        )

    assert dao.last_upsert is None


@pytest.mark.asyncio
async def test_attachment_original_operations_are_the_only_protected_bypass(
    mount_context,
):
    service, dao, store, protected, _ = mount_context

    mount_id = await service.get_or_create_attachment_mount(
        project_id=_PROJECT_ID,
        user_id=_USER_ID,
        session_id=_SESSION_ID,
    )
    assert mount_id == protected.id
    assert dao.last_upsert is not None
    assert dao.last_upsert.purpose == ATTACHMENTS_MOUNT_PURPOSE

    await service.write_attachment_original(
        project_id=_PROJECT_ID,
        mount_id=mount_id,
        path=_PATH,
        data=b"original",
    )
    assert (
        await service.read_attachment_original(
            project_id=_PROJECT_ID,
            mount_id=mount_id,
            path=_PATH,
        )
        == b"original"
    )
    await service.delete_attachment_original(
        project_id=_PROJECT_ID,
        mount_id=mount_id,
        path=_PATH,
    )
    assert f"mounts/{_PROJECT_ID}/{mount_id}/{_PATH}" not in store.objects


@pytest.mark.parametrize(
    "operation",
    (
        "write_attachment_original",
        "read_attachment_original",
        "delete_attachment_original",
    ),
)
@pytest.mark.asyncio
async def test_attachment_operations_report_unavailable_storage(
    mount_context,
    operation,
):
    service, _, _, protected, _ = mount_context
    # A configured bucket without a store is a 503, not an AttributeError.
    service.mounts_store = None
    calls = {
        "write_attachment_original": lambda: service.write_attachment_original(
            project_id=_PROJECT_ID,
            mount_id=protected.id,
            path=_PATH,
            data=b"original",
        ),
        "read_attachment_original": lambda: service.read_attachment_original(
            project_id=_PROJECT_ID,
            mount_id=protected.id,
            path=_PATH,
        ),
        "delete_attachment_original": lambda: service.delete_attachment_original(
            project_id=_PROJECT_ID,
            mount_id=protected.id,
            path=_PATH,
        ),
    }

    with pytest.raises(MountStorageUnavailable):
        await calls[operation]()


@pytest.mark.asyncio
async def test_session_hard_delete_still_includes_protected_mount(mount_context):
    service, _, store, protected, cwd = mount_context

    archived = await service.archive_session_mounts(
        project_id=_PROJECT_ID,
        user_id=_USER_ID,
        session_id=_SESSION_ID,
    )
    assert {mount.id for mount in archived} == {cwd.id}

    unarchived = await service.unarchive_session_mounts(
        project_id=_PROJECT_ID,
        user_id=_USER_ID,
        session_id=_SESSION_ID,
    )
    assert {mount.id for mount in unarchived} == {cwd.id}

    deleted = await service.delete_session_mounts(
        project_id=_PROJECT_ID,
        session_id=_SESSION_ID,
    )
    assert {mount.id for mount in deleted} == {protected.id, cwd.id}
    assert {
        f"mounts/{_PROJECT_ID}/{protected.id}/",
        f"mounts/{_PROJECT_ID}/{cwd.id}/",
    } == set(store.deleted_prefixes)


@pytest.mark.asyncio
async def test_mount_protected_maps_to_the_mount_not_found_wire_shape():
    @handle_mount_exceptions()
    async def raise_protected():
        raise MountProtected()

    with pytest.raises(HTTPException) as exc_info:
        await raise_protected()

    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
    assert exc_info.value.detail == "Mount not found."
