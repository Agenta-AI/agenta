"""The drive upload and write routes cap the request body at AGENTA_MOUNTS_MAX_UPLOAD_BYTES.

- A declared Content-Length over the cap is 413; the body is read and dropped first, so a browser
  that is still sending gets the response. Over the drain limit it is 413 before any byte is read.
- A body without Content-Length is counted as it arrives and stops at the cap with 413.
- A file one byte over the cap is 413, even though the multipart allowance lets its body in.
- A body under the cap is written as before.
- Every route that takes a file body uses the capped route class.
"""

import asyncio
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.mounts import utils as mount_utils
from oss.src.apis.fastapi.mounts.router import MountsRouter
from oss.src.apis.fastapi.mounts.utils import (
    SizeCappedUploadRoute,
    _size_capped_request,
)
from oss.src.apis.fastapi.sessions.router import SessionMountsRouter
from oss.src.core.mounts.service import MountsService
from oss.src.utils.env import env
from unit.test_mounts_file_ops import (
    _BUCKET,
    FakeMountStorage,
    _make_mount,
    _StubDAO,
)

_CAP = 1024
# The cap plus the multipart allowance: the largest body the routes accept.
_MAX_BODY = _CAP + mount_utils._UPLOAD_MULTIPART_OVERHEAD_BYTES


@pytest.fixture(autouse=True)
def small_cap(monkeypatch):
    monkeypatch.setattr(env.mounts, "max_upload_bytes", _CAP)


@pytest.fixture
def allow_access():
    with patch(
        "oss.src.apis.fastapi.mounts.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        yield


def _client() -> tuple[TestClient, FakeMountStorage, str]:
    mount = _make_mount()
    store = FakeMountStorage()
    service = MountsService(
        mounts_dao=_StubDAO(mount), mounts_store=store, bucket=_BUCKET
    )
    app = FastAPI()

    @app.middleware("http")
    async def set_request_scope(request: Request, call_next):
        request.state.project_id = str(mount.project_id)
        request.state.user_id = str(uuid4())
        return await call_next(request)

    app.include_router(MountsRouter(mounts_service=service).router, prefix="/mounts")
    return TestClient(app), store, f"/mounts/{mount.id}/files"


def _request(headers: dict, receive) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        },
        receive,
    )


class TestCapBeforeRead:
    @pytest.mark.asyncio
    async def test_declared_length_over_cap_drains_body_then_413(self):
        chunks = [
            {"type": "http.request", "body": b"x" * 1000, "more_body": True},
            {"type": "http.request", "body": b"x" * 1000, "more_body": True},
            {"type": "http.request", "body": b"x" * 1000, "more_body": False},
        ]
        receive = AsyncMock(side_effect=chunks)

        with pytest.raises(HTTPException) as raised:
            await _size_capped_request(
                _request({"content-length": str(_MAX_BODY + 1)}, receive)
            )

        assert raised.value.status_code == 413
        assert f"{_CAP}-byte limit" in raised.value.detail
        # The whole body was read, so the response does not race the upload.
        assert receive.await_count == len(chunks)

    @pytest.mark.asyncio
    async def test_declared_length_over_drain_limit_is_413_without_reading(self):
        receive = AsyncMock(side_effect=AssertionError("body was read"))
        too_big = mount_utils._UPLOAD_DRAIN_LIMIT_BYTES + 1

        with pytest.raises(HTTPException) as raised:
            await _size_capped_request(
                _request({"content-length": str(too_big)}, receive)
            )

        assert raised.value.status_code == 413
        receive.assert_not_called()

    @pytest.mark.asyncio
    async def test_non_integer_length_is_400(self):
        with pytest.raises(HTTPException) as raised:
            await _size_capped_request(
                _request({"content-length": "lots"}, AsyncMock())
            )

        assert raised.value.status_code == 400

    @pytest.mark.asyncio
    async def test_body_without_length_stops_at_cap(self):
        chunk = b"x" * 4096
        total_chunks = _MAX_BODY // len(chunk) + 5
        messages = [
            {"type": "http.request", "body": chunk, "more_body": True}
            for _ in range(total_chunks - 1)
        ] + [{"type": "http.request", "body": chunk, "more_body": False}]
        receive = AsyncMock(side_effect=messages)
        capped = await _size_capped_request(_request({}, receive))

        with pytest.raises(HTTPException) as raised:
            async for _ in capped.stream():
                pass

        assert raised.value.status_code == 413
        # The rest of the body was read and dropped before the 413.
        assert receive.await_count == total_chunks

    @pytest.mark.asyncio
    async def test_drain_stops_at_timeout(self, monkeypatch):
        monkeypatch.setattr(mount_utils, "_UPLOAD_DRAIN_TIMEOUT_SECONDS", 0.05)

        async def empty_forever():
            await asyncio.sleep(0.001)
            return {"type": "http.request", "body": b"", "more_body": True}

        with pytest.raises(HTTPException) as raised:
            await _size_capped_request(
                _request({"content-length": str(_MAX_BODY + 1)}, empty_forever)
            )

        assert raised.value.status_code == 413

    @pytest.mark.asyncio
    async def test_body_without_length_stops_draining_at_limit(self, monkeypatch):
        chunk = b"x" * 4096
        monkeypatch.setattr(mount_utils, "_UPLOAD_DRAIN_LIMIT_BYTES", _MAX_BODY * 2)
        receive = AsyncMock(
            return_value={"type": "http.request", "body": chunk, "more_body": True}
        )
        capped = await _size_capped_request(_request({}, receive))

        with pytest.raises(HTTPException) as raised:
            async for _ in capped.stream():
                pass

        assert raised.value.status_code == 413
        # An endless body is not read forever.
        assert receive.await_count <= (_MAX_BODY * 2) // len(chunk) + 2


@pytest.mark.usefixtures("allow_access")
class TestMountRoutes:
    def test_upload_under_cap_is_written(self):
        client, store, base = _client()

        response = client.post(
            f"{base}/upload?path=small.bin",
            files={"file": ("small.bin", b"a" * _CAP)},
        )

        assert response.status_code == 200
        assert response.json()["size"] == _CAP

    def test_upload_over_cap_is_413_and_not_written(self):
        client, store, base = _client()
        store.put_object = AsyncMock(side_effect=AssertionError("store was written"))

        response = client.post(
            f"{base}/upload?path=big.bin",
            files={"file": ("big.bin", b"a" * (_MAX_BODY + 1))},
        )

        assert response.status_code == 413
        assert f"{_CAP}-byte limit" in response.json()["detail"]

    def test_chunked_upload_over_cap_is_413(self):
        client, store, base = _client()
        store.put_object = AsyncMock(side_effect=AssertionError("store was written"))

        def body():
            yield b"--b\r\nContent-Disposition: form-data; name=file; filename=c\r\n\r\n"
            for _ in range(_MAX_BODY // 1024 + 2):
                yield b"a" * 1024
            yield b"\r\n--b--\r\n"

        response = client.post(
            f"{base}/upload?path=chunked.bin",
            content=body(),
            headers={"Content-Type": "multipart/form-data; boundary=b"},
        )

        assert response.status_code == 413

    def test_put_over_cap_is_413(self):
        client, store, base = _client()
        store.put_object = AsyncMock(side_effect=AssertionError("store was written"))

        response = client.put(f"{base}?path=big.txt", content=b"a" * (_MAX_BODY + 1))

        assert response.status_code == 413

    def test_file_one_byte_over_cap_is_413(self):
        # The body fits the multipart allowance, so only the exact file check catches it.
        client, store, base = _client()
        store.put_object = AsyncMock(side_effect=AssertionError("store was written"))

        uploaded = client.post(
            f"{base}/upload?path=edge.bin",
            files={"file": ("edge.bin", b"a" * (_CAP + 1))},
        )
        written = client.put(f"{base}?path=edge.txt", content=b"a" * (_CAP + 1))

        assert uploaded.status_code == 413
        assert written.status_code == 413

    def test_put_under_cap_is_written(self):
        client, _, base = _client()

        response = client.put(f"{base}?path=small.txt", content=b"hello")

        assert response.status_code == 200
        assert response.json()["size"] == 5


def test_every_file_body_route_is_capped():
    def capped_paths(router) -> set[tuple[str, str]]:
        return {
            (route.path, method)
            for route in router.routes
            if isinstance(route, SizeCappedUploadRoute)
            for method in route.methods
        }

    mounts = MountsRouter(mounts_service=AsyncMock()).router
    assert capped_paths(mounts) == {
        ("/{mount_id}/files/upload", "POST"),
        ("/{mount_id}/files", "PUT"),
    }

    sessions = SessionMountsRouter(
        session_mounts_service=AsyncMock(), mounts_service=AsyncMock()
    ).router
    assert capped_paths(sessions) == {
        ("/mounts/files/upload", "POST"),
        ("/mounts/{mount_id}/files/upload", "POST"),
    }
