"""Bounded text reads (#7522): the store refuses an object over `max_bytes` without buffering
it, `read_file` caps text reads at 4 MiB, and the route answers 413 above the cap."""

from hashlib import md5
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.mounts.router import MountsRouter
from oss.src.core.mounts import service as mounts_service_module
from oss.src.core.mounts.service import MountsService
from oss.src.core.mounts.types import MountFileTooLarge
from oss.src.core.store.storage import ObjectStore
from oss.src.core.store.types import StoreObjectTooLarge
from unit.test_mounts_file_ops import (
    _BUCKET,
    FakeMountStorage,
    _make_mount,
    _make_service,
    _StubDAO,
)

LIMIT = 8


class _StreamResponse:
    """A GET response whose body arrives in `fragment`-byte pieces, like a real socket."""

    def __init__(self, body: bytes, *, fragment: int, content_length: bool = True):
        self.headers = {"ETag": f'"{md5(body).hexdigest()}"'}
        if content_length:
            self.headers["Content-Length"] = str(len(body))
        self.content = SimpleNamespace(read=self._read)
        self._body = body
        self._fragment = fragment
        self.read_bytes = 0
        self.released = False

    async def _read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            n = len(self._body) - self.read_bytes
        n = min(n, self._fragment)
        chunk = self._body[self.read_bytes : self.read_bytes + n]
        self.read_bytes += len(chunk)
        return chunk

    async def release(self) -> None:
        self.released = True


def _store(response: _StreamResponse) -> ObjectStore:
    store = ObjectStore(endpoint_url="http://store", access_key="k", secret_key="s")

    async def get_object(bucket, key, session):
        return response

    store._client = lambda: SimpleNamespace(get_object=get_object)  # type: ignore[method-assign]
    return store


@pytest.mark.asyncio
class TestBoundedStoreRead:
    async def test_exact_limit_is_returned_with_its_etag(self):
        body = b"x" * LIMIT
        resp = _StreamResponse(body, fragment=3)

        got, etag = await _store(resp).get_object_with_etag(
            bucket=_BUCKET, key="k", max_bytes=LIMIT
        )

        assert got == body
        assert etag == md5(body).hexdigest()
        assert resp.released

    async def test_limit_plus_one_is_refused_from_content_length_before_reading(self):
        resp = _StreamResponse(b"x" * (LIMIT + 1), fragment=100)

        with pytest.raises(StoreObjectTooLarge):
            await _store(resp).get_object_with_etag(
                bucket=_BUCKET, key="k", max_bytes=LIMIT
            )

        assert resp.read_bytes == 0
        assert resp.released

    async def test_missing_content_length_stops_after_limit_plus_one(self):
        resp = _StreamResponse(b"x" * 1000, fragment=3, content_length=False)

        with pytest.raises(StoreObjectTooLarge):
            await _store(resp).get_object_with_etag(
                bucket=_BUCKET, key="k", max_bytes=LIMIT
            )

        assert resp.read_bytes == LIMIT + 1
        assert resp.released

    async def test_small_fragments_are_read_to_the_end_not_truncated(self):
        body = b"abcdefg"
        resp = _StreamResponse(body, fragment=1, content_length=False)

        got, _ = await _store(resp).get_object_with_etag(
            bucket=_BUCKET, key="k", max_bytes=LIMIT
        )

        assert got == body

    async def test_without_a_limit_the_whole_body_and_etag_come_back(self):
        body = b"y" * 1000
        resp = _StreamResponse(body, fragment=10_000)

        got, etag = await _store(resp).get_object_with_etag(bucket=_BUCKET, key="k")

        assert got == body
        assert etag == md5(body).hexdigest()


@pytest.mark.asyncio
class TestReadFileCap:
    async def test_text_read_cap_is_4_mib(self):
        assert mounts_service_module._TEXT_READ_MAX_BYTES == 4 * 1024 * 1024

    async def test_over_the_cap_raises_mount_file_too_large(self, monkeypatch):
        monkeypatch.setattr(mounts_service_module, "_TEXT_READ_MAX_BYTES", LIMIT)
        service, pid, mid = _make_service(_make_mount())
        await service.write_file(
            project_id=pid, mount_id=mid, path="exact.txt", content=b"x" * LIMIT
        )
        await service.write_file(
            project_id=pid, mount_id=mid, path="clip.mp4", content=b"x" * (LIMIT + 1)
        )

        exact = await service.read_file(project_id=pid, mount_id=mid, path="exact.txt")
        assert exact.content == "x" * LIMIT
        with pytest.raises(MountFileTooLarge):
            await service.read_file(project_id=pid, mount_id=mid, path="clip.mp4")


def test_route_answers_413_and_points_at_the_download_endpoint(monkeypatch):
    monkeypatch.setattr(mounts_service_module, "_TEXT_READ_MAX_BYTES", LIMIT)
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
    client = TestClient(app)
    base = f"/mounts/{mount.id}/files"

    with patch(
        "oss.src.apis.fastapi.mounts.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        put = client.put(
            f"{base}?path=clip.mp4",
            content=b"x" * (LIMIT + 1),
            headers={"Content-Type": "application/octet-stream"},
        )
        assert put.status_code == 200
        res = client.get(f"{base}?read=clip.mp4")

    assert res.status_code == 413
    assert "/files/download" in res.json()["detail"]
