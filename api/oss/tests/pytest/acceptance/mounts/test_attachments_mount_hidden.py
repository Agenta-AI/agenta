import pytest
import asyncio
from uuid import UUID, uuid4

from sqlalchemy import select

from oss.src.dbs.postgres.sessions.attachments.dbes import SessionAttachmentDBE
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.tests.pytest.utils.mounts import skip_if_mount_storage_unavailable

# Reads the database directly, so it only runs adjacent to the stack (see conftest).
pytestmark = pytest.mark.integration

_PNG = b"\x89PNG\r\n\x1a\n" + b"hidden-mount"


def _create_attachment(authed_api, session_id):
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


async def _mount_id(attachment_id):
    engine = TransactionsEngine()
    try:
        async with engine.session() as session:
            result = await session.execute(
                select(SessionAttachmentDBE.mount_id).where(
                    SessionAttachmentDBE.id == UUID(attachment_id)
                )
            )
            return str(result.scalar_one())
    finally:
        await engine.close()


class TestAttachmentsMountHidden:
    def test_mount_is_absent_from_generic_and_session_reads(self, authed_api):
        session_id = f"session-{uuid4().hex}"
        attachment_id = _create_attachment(authed_api, session_id)
        mount_id = asyncio.run(_mount_id(attachment_id))

        fetched = authed_api("GET", f"/mounts/{mount_id}")
        assert fetched.status_code == 404, fetched.text

        queried = authed_api("POST", "/mounts/query", json={})
        assert queried.status_code == 200, queried.text
        assert mount_id not in {mount["id"] for mount in queried.json()["mounts"]}

        session_fetched = authed_api(
            "GET",
            "/sessions/mounts/",
            params={"session_id": session_id},
        )
        assert session_fetched.status_code == 200, session_fetched.text
        assert mount_id not in {
            mount["id"] for mount in session_fetched.json()["mounts"]
        }

        session_queried = authed_api(
            "POST",
            "/sessions/mounts/query",
            params={"session_id": session_id},
            json={},
        )
        assert session_queried.status_code == 200, session_queried.text
        assert mount_id not in {
            mount["id"] for mount in session_queried.json()["mounts"]
        }

    def test_every_generic_mutation_and_file_route_returns_404(self, authed_api):
        session_id = f"session-{uuid4().hex}"
        attachment_id = _create_attachment(authed_api, session_id)
        mount_id = asyncio.run(_mount_id(attachment_id))
        path = f"{attachment_id}/image.png"

        requests = [
            (
                "PUT",
                f"/mounts/{mount_id}",
                {"json": {"mount": {"id": mount_id, "name": "changed"}}},
            ),
            ("POST", f"/mounts/{mount_id}/sign", {}),
            (
                "POST",
                "/mounts/files/export",
                {"json": {"mounts": [{"mount_id": mount_id}]}},
            ),
            ("POST", f"/mounts/{mount_id}/archive", {}),
            ("POST", f"/mounts/{mount_id}/unarchive", {}),
            (
                "POST",
                f"/mounts/{mount_id}/files/folder",
                {"params": {"path": "folder"}},
            ),
            (
                "POST",
                f"/mounts/{mount_id}/files/upload",
                {"files": {"file": ("other.bin", b"other")}},
            ),
            (
                "GET",
                f"/mounts/{mount_id}/files/download",
                {"params": {"path": path}},
            ),
            ("GET", f"/mounts/{mount_id}/files", {}),
            (
                "GET",
                f"/mounts/{mount_id}/files",
                {"params": {"read": path}},
            ),
            (
                "PUT",
                f"/mounts/{mount_id}/files",
                {"params": {"path": path}, "data": b"changed"},
            ),
            (
                "DELETE",
                f"/mounts/{mount_id}/files",
                {"params": {"path": path}},
            ),
        ]

        for method, endpoint, kwargs in requests:
            response = authed_api(method, endpoint, **kwargs)
            assert response.status_code == 404, (
                f"{method} {endpoint}: {response.status_code} {response.text}"
            )
