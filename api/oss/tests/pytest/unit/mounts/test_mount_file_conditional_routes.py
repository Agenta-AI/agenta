"""HTTP contract of the mount file routes' etag / precondition handling.

- `GET ?read=` returns `{path, content, etag}`; list entries carry `etag` (null for folders).
- `PUT` honours `If-Match: <etag>` and `If-None-Match: *`; success returns `{path, size, etag}`.
- `DELETE` honours `If-Match`.
- A failed condition is `412` with body `{"detail": {"code": "conflict", "etag": <current|null>}}`.
- Any `If-None-Match` other than `*` is `400`.
- No header: unconditional, exactly as before.
"""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from oss.src.apis.fastapi.mounts.router import MountsRouter
from oss.src.core.mounts.service import MountsService
from unit.test_mounts_file_ops import (
    _BUCKET,
    FakeMountStorage,
    _make_mount,
    _StubDAO,
)


def _client() -> tuple[TestClient, str]:
    mount = _make_mount()
    service = MountsService(
        mounts_dao=_StubDAO(mount), mounts_store=FakeMountStorage(), bucket=_BUCKET
    )
    app = FastAPI()

    @app.middleware("http")
    async def set_request_scope(request: Request, call_next):
        request.state.project_id = str(mount.project_id)
        request.state.user_id = str(uuid4())
        return await call_next(request)

    app.include_router(MountsRouter(mounts_service=service).router, prefix="/mounts")
    return TestClient(app), f"/mounts/{mount.id}/files"


@pytest.fixture
def allow_access():
    with patch(
        "oss.src.apis.fastapi.mounts.router.check_action_access",
        new_callable=AsyncMock,
        return_value=True,
    ):
        yield


def _put(client, base, path, body, **headers):
    return client.put(
        f"{base}?path={path}",
        content=body,
        headers={"Content-Type": "text/plain; charset=utf-8", **headers},
    )


def _conflict(etag):
    return {"detail": {"code": "conflict", "etag": etag}}


@pytest.mark.usefixtures("allow_access")
class TestUnconditionalPathIsUnchanged:
    def test_write_read_list_delete_without_headers(self):
        client, base = _client()

        written = _put(client, base, "notes.txt", b"hello")
        assert written.status_code == 200
        assert written.json()["path"] == "notes.txt"
        assert written.json()["size"] == 5
        etag = written.json()["etag"]
        assert etag == FakeMountStorage.etag_of(b"hello")

        read = client.get(f"{base}?read=notes.txt")
        assert read.status_code == 200
        assert read.json() == {"path": "notes.txt", "content": "hello", "etag": etag}

        overwritten = _put(client, base, "notes.txt", b"hello again")
        assert overwritten.status_code == 200
        assert overwritten.json()["etag"] != etag

        deleted = client.delete(f"{base}?path=notes.txt")
        assert deleted.status_code == 200
        assert deleted.json() == {"deleted": "notes.txt", "count": 1}

        assert client.get(f"{base}?read=notes.txt").status_code == 404
        assert client.delete(f"{base}?path=notes.txt").status_code == 404

    def test_list_entries_carry_etag_and_folders_carry_null(self):
        client, base = _client()
        client.post(f"{base}/folder?path=dir")
        written = _put(client, base, "dir/a.txt", b"a").json()

        for url in (base, f"{base}?depth=1"):
            listing = client.get(url)
            assert listing.status_code == 200
            by_path = {f["path"]: f for f in listing.json()["files"]}
            assert by_path["dir"]["is_folder"] is True
            assert by_path["dir"]["etag"] is None
            if "dir/a.txt" in by_path:
                assert by_path["dir/a.txt"]["etag"] == written["etag"]

        listing = client.get(f"{base}?path=dir")
        by_path = {f["path"]: f["etag"] for f in listing.json()["files"]}
        assert by_path["dir/a.txt"] == written["etag"]

    def test_folder_delete_cascades_without_headers(self):
        client, base = _client()
        _put(client, base, "dir/a.txt", b"a")
        _put(client, base, "dir/b.txt", b"b")

        deleted = client.delete(f"{base}?path=dir")

        assert deleted.status_code == 200
        assert deleted.json()["count"] == 2


@pytest.mark.usefixtures("allow_access")
class TestIfMatchOnWrite:
    def test_matching_etag_writes_and_returns_the_new_etag(self):
        client, base = _client()
        first = _put(client, base, "f.txt", b"v1").json()

        second = _put(client, base, "f.txt", b"v2", **{"If-Match": first["etag"]})

        assert second.status_code == 200
        assert second.json()["etag"] == FakeMountStorage.etag_of(b"v2")

    def test_quoted_etag_is_accepted(self):
        client, base = _client()
        first = _put(client, base, "f.txt", b"v1").json()

        second = _put(
            client, base, "f.txt", b"v2", **{"If-Match": f'"{first["etag"]}"'}
        )

        assert second.status_code == 200

    def test_stale_etag_is_412_with_the_current_etag(self):
        client, base = _client()
        first = _put(client, base, "f.txt", b"v1").json()
        current = _put(client, base, "f.txt", b"v2").json()

        stale = _put(client, base, "f.txt", b"v3", **{"If-Match": first["etag"]})

        assert stale.status_code == 412
        assert stale.json() == _conflict(current["etag"])
        assert client.get(f"{base}?read=f.txt").json()["content"] == "v2"

    def test_if_match_on_a_missing_file_is_412_with_null_etag(self):
        client, base = _client()

        response = _put(client, base, "ghost.txt", b"v", **{"If-Match": "anything"})

        assert response.status_code == 412
        assert response.json() == _conflict(None)
        assert client.get(f"{base}?read=ghost.txt").status_code == 404


@pytest.mark.usefixtures("allow_access")
class TestIfNoneMatchOnWrite:
    def test_star_creates_a_missing_file(self):
        client, base = _client()

        response = _put(client, base, "new.txt", b"v1", **{"If-None-Match": "*"})

        assert response.status_code == 200
        assert response.json()["etag"] == FakeMountStorage.etag_of(b"v1")

    def test_star_on_an_existing_file_is_412_with_its_etag(self):
        client, base = _client()
        existing = _put(client, base, "new.txt", b"v1").json()

        response = _put(client, base, "new.txt", b"v2", **{"If-None-Match": "*"})

        assert response.status_code == 412
        assert response.json() == _conflict(existing["etag"])
        assert client.get(f"{base}?read=new.txt").json()["content"] == "v1"

    @pytest.mark.parametrize("value", ['"abc"', "abc", "*, abc", ""])
    def test_anything_but_star_is_400_and_writes_nothing(self, value):
        client, base = _client()

        response = _put(client, base, "new.txt", b"v1", **{"If-None-Match": value})

        assert response.status_code == 400
        assert "If-None-Match" in response.json()["detail"]
        assert client.get(f"{base}?read=new.txt").status_code == 404


@pytest.mark.usefixtures("allow_access")
class TestIfMatchOnDelete:
    def test_matching_etag_deletes(self):
        client, base = _client()
        written = _put(client, base, "f.txt", b"v1").json()

        response = client.delete(
            f"{base}?path=f.txt", headers={"If-Match": written["etag"]}
        )

        assert response.status_code == 200
        assert response.json() == {"deleted": "f.txt", "count": 1}
        assert client.get(f"{base}?read=f.txt").status_code == 404

    def test_stale_etag_is_412_and_keeps_the_file(self):
        client, base = _client()
        first = _put(client, base, "f.txt", b"v1").json()
        current = _put(client, base, "f.txt", b"v2").json()

        response = client.delete(
            f"{base}?path=f.txt", headers={"If-Match": first["etag"]}
        )

        assert response.status_code == 412
        assert response.json() == _conflict(current["etag"])
        assert client.get(f"{base}?read=f.txt").status_code == 200

    def test_if_match_on_a_missing_file_is_412_with_null_etag(self):
        client, base = _client()

        response = client.delete(f"{base}?path=ghost.txt", headers={"If-Match": "x"})

        assert response.status_code == 412
        assert response.json() == _conflict(None)
