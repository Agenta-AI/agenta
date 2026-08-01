import pytest
import asyncio
from uuid import UUID, uuid4

from sqlalchemy import select

from oss.src.dbs.postgres.sessions.attachments.dbes import SessionAttachmentDBE
from oss.src.dbs.postgres.shared.engine import TransactionsEngine
from oss.tests.pytest.utils.mounts import skip_if_mount_storage_unavailable

# Reads the database directly, so it only runs adjacent to the stack (see conftest).
pytestmark = pytest.mark.integration

_PNG = b"\x89PNG\r\n\x1a\n" + b"attachment-content"
_AUDIO_CAP_BYTES = 15 * 1024 * 1024


def _wav_bytes(size):
    data_size = size - 44
    header = (
        b"RIFF"
        + (size - 8).to_bytes(4, "little")
        + b"WAVEfmt "
        + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little")
        + (1).to_bytes(2, "little")
        + (8_000).to_bytes(4, "little")
        + (8_000).to_bytes(4, "little")
        + (1).to_bytes(2, "little")
        + (8).to_bytes(2, "little")
        + b"data"
        + data_size.to_bytes(4, "little")
    )
    return header + bytes(data_size)


def _upload(
    authed_api,
    *,
    session_id,
    data=_PNG,
    filename="image.png",
    media_type="image/png",
):
    response = authed_api(
        "POST",
        "/sessions/attachments",
        params={"session_id": session_id},
        data={"idempotency_key": uuid4().hex},
        files={"file": (filename, data, media_type)},
    )
    skip_if_mount_storage_unavailable(response)
    return response


async def _referenced_at(attachment_id):
    engine = TransactionsEngine()
    try:
        async with engine.session() as session:
            result = await session.execute(
                select(SessionAttachmentDBE.referenced_at).where(
                    SessionAttachmentDBE.id == UUID(attachment_id)
                )
            )
            return result.scalar_one()
    finally:
        await engine.close()


class TestSessionAttachments:
    def test_create_and_download_verified_content(self, authed_api):
        session_id = f"session-{uuid4().hex}"
        created = _upload(
            authed_api,
            session_id=session_id,
            media_type="text/plain",
        )
        assert created.status_code == 200, created.text

        body = created.json()
        assert body["count"] == 1
        assert set(body["attachment"]) == {
            "attachment_id",
            "filename",
            "media_type",
            "size",
            "created_at",
        }
        assert body["attachment"]["media_type"] == "image/png"
        assert body["attachment"]["size"] == len(_PNG)

        attachment_id = body["attachment"]["attachment_id"]
        downloaded = authed_api(
            "GET",
            f"/sessions/attachments/{attachment_id}/content",
            params={"session_id": session_id},
        )
        assert downloaded.status_code == 200, downloaded.text
        assert downloaded.content == _PNG
        assert downloaded.headers["Content-Type"].startswith("image/png")
        assert downloaded.headers["X-Content-Type-Options"] == "nosniff"
        assert asyncio.run(_referenced_at(attachment_id)) is None

    def test_content_hides_missing_and_foreign_attachments(self, authed_api):
        session_id = f"session-{uuid4().hex}"
        created = _upload(authed_api, session_id=session_id)
        assert created.status_code == 200, created.text
        attachment_id = created.json()["attachment"]["attachment_id"]

        foreign = authed_api(
            "GET",
            f"/sessions/attachments/{attachment_id}/content",
            params={"session_id": f"session-{uuid4().hex}"},
        )
        assert foreign.status_code == 404, foreign.text
        assert session_id not in foreign.text

        missing = authed_api(
            "GET",
            f"/sessions/attachments/{uuid4()}/content",
            params={"session_id": session_id},
        )
        assert missing.status_code == 404, missing.text

    def test_over_kind_cap_returns_structured_413(self, authed_api):
        response = _upload(
            authed_api,
            session_id=f"session-{uuid4().hex}",
            data=b"\x89PNG\r\n\x1a\n" + b"x" * (10 * 1024 * 1024),
        )
        assert response.status_code == 413, response.text
        assert "detail" in response.json()

    def test_exact_audio_cap_succeeds(self, authed_api):
        response = _upload(
            authed_api,
            session_id=f"session-{uuid4().hex}",
            data=_wav_bytes(_AUDIO_CAP_BYTES),
            filename="audio.wav",
            media_type="application/octet-stream",
        )
        assert response.status_code == 200, response.text
        attachment = response.json()["attachment"]
        assert attachment["media_type"].startswith("audio/")
        assert attachment["size"] == _AUDIO_CAP_BYTES

    def test_reference_claims_and_rejects_foreign_attachment(self, authed_api):
        session_id = f"session-{uuid4().hex}"
        created = _upload(authed_api, session_id=session_id)
        assert created.status_code == 200, created.text
        attachment_id = created.json()["attachment"]["attachment_id"]
        assert asyncio.run(_referenced_at(attachment_id)) is None

        claimed = authed_api(
            "POST",
            "/sessions/attachments/reference",
            json={
                "session_id": session_id,
                "attachment_ids": [attachment_id],
            },
        )
        assert claimed.status_code == 200, claimed.text
        assert claimed.json()["count"] == 1
        assert claimed.json()["attachments"][0]["attachment_id"] == attachment_id
        assert asyncio.run(_referenced_at(attachment_id)) is not None

        foreign = authed_api(
            "POST",
            "/sessions/attachments/reference",
            json={
                "session_id": f"session-{uuid4().hex}",
                "attachment_ids": [attachment_id],
            },
        )
        assert foreign.status_code == 404, foreign.text
