import asyncio
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from oss.src.core.mounts.dtos import Mount
from oss.src.core.mounts.service import MountsService
from oss.src.core.mounts.types import MountFileNotFound
from oss.src.core.store.storage import ObjectStore
from oss.src.dbs.postgres.sessions.attachments.dbes import SessionAttachmentDBE
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.src.utils.env import env
from oss.tests.pytest.utils.mounts import skip_if_mount_storage_unavailable

# Reads the database directly, so it only runs adjacent to the stack (see conftest).
pytestmark = pytest.mark.integration

_PNG = b"\x89PNG\r\n\x1a\n" + b"teardown"


def _create_session(authed_api, session_id):
    response = authed_api(
        "PUT",
        "/sessions/streams/header",
        params={"session_id": session_id},
        json={"name": "Attachment teardown"},
    )
    assert response.status_code == 200, response.text


def _upload(authed_api, session_id):
    response = authed_api(
        "POST",
        "/sessions/attachments",
        params={"session_id": session_id},
        data={"idempotency_key": uuid4().hex},
        files={"file": ("image.png", _PNG, "image/png")},
    )
    skip_if_mount_storage_unavailable(response)
    assert response.status_code == 200, response.text
    return response.json()["attachment"]["attachment_id"]


async def _coordinates(attachment_id):
    engine = TransactionsEngine()
    try:
        async with engine.session() as session:
            result = await session.execute(
                select(
                    SessionAttachmentDBE.project_id,
                    SessionAttachmentDBE.mount_id,
                    SessionAttachmentDBE.path,
                ).where(SessionAttachmentDBE.id == UUID(attachment_id))
            )
            return result.one()
    finally:
        await engine.close()


def _storage_key(coordinates):
    """Derive the object key through the service so a key-construction bug fails here too."""
    project_id, mount_id, path = coordinates
    service = MountsService(mounts_dao=None, namespace=env.store.namespace)
    return service._storage_key(
        project_id=project_id,
        mount=Mount(id=mount_id, project_id=project_id, slug=str(mount_id)),
        path=path,
    )


async def _read_original(coordinates):
    key = _storage_key(coordinates)
    store = ObjectStore(
        endpoint_url=env.store.endpoint_url,
        access_key=env.store.access_key,
        secret_key=env.store.secret_key,
        region=env.store.region,
        sts_endpoint_url=env.store.sts_endpoint_url,
        signing_key=env.store.signing_key,
    )
    return await store.get_object(bucket=env.store.bucket, key=key)


class TestSessionAttachmentTeardown:
    def test_delete_removes_attachment_row_and_original(self, authed_api):
        session_id = f"session-{uuid4().hex}"
        _create_session(authed_api, session_id)
        attachment_id = _upload(authed_api, session_id)
        coordinates = asyncio.run(_coordinates(attachment_id))
        assert asyncio.run(_read_original(coordinates)) == _PNG

        deleted = authed_api(
            "DELETE",
            "/sessions/",
            params={"session_id": session_id},
        )
        assert deleted.status_code == 200, deleted.text

        content = authed_api(
            "GET",
            f"/sessions/attachments/{attachment_id}/content",
            params={"session_id": session_id},
        )
        assert content.status_code == 404, content.text
        with pytest.raises(MountFileNotFound):
            asyncio.run(_read_original(coordinates))

    def test_archive_keeps_attachment_original(self, authed_api):
        session_id = f"session-{uuid4().hex}"
        _create_session(authed_api, session_id)
        attachment_id = _upload(authed_api, session_id)
        coordinates = asyncio.run(_coordinates(attachment_id))

        archived = authed_api(
            "POST",
            "/sessions/archive",
            params={"session_id": session_id},
        )
        assert archived.status_code == 200, archived.text

        content = authed_api(
            "GET",
            f"/sessions/attachments/{attachment_id}/content",
            params={"session_id": session_id},
        )
        assert content.status_code == 200, content.text
        assert content.content == _PNG
        assert asyncio.run(_read_original(coordinates)) == _PNG
