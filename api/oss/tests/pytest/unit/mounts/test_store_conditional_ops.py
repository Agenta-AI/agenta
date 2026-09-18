"""ObjectStore conditional ops against a fake miniopy client.

Two mechanisms are under test:
- PUT conditions ride NATIVELY as `If-Match` / `If-None-Match: *` headers through miniopy's
  single-shot `_put_object`; the store's 412 (or AWS's 404 for If-Match on a missing key) maps
  to `StorePreconditionFailed` carrying the current etag.
- DELETE conditions are EMULATED as stat-compare-delete, since conditional DeleteObject is not
  portable across S3-compatible stores.
"""

from hashlib import md5
from types import SimpleNamespace

import pytest
from miniopy_async.error import S3Error

from oss.src.core.mounts.types import MountFileNotFound
from oss.src.core.store.storage import ObjectStore, _normalize_etag
from oss.src.core.store.types import StorePreconditionFailed

_BUCKET = "b"


def _s3error(code: str) -> S3Error:
    return S3Error(code, code, "/b/k", "rid", "hid", SimpleNamespace(status=412))


def _etag(body: bytes) -> str:
    return md5(body).hexdigest()


class _Response:
    def __init__(self, body: bytes):
        self.headers = {"ETag": f'"{_etag(body)}"'}
        self.content = SimpleNamespace(read=self._read)
        self._body = body

    async def _read(self) -> bytes:
        return self._body

    async def release(self) -> None:
        pass


class _FakeMinio:
    """Mirrors the store behaviour verified live against SeaweedFS: 412 on a failed If-Match /
    If-None-Match, plus AWS's 404 for If-Match on a missing key."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.calls: list = []

    async def put_object(self, bucket, key, data, length, **_):
        body = data.read()
        self.calls.append(("put_object", None))
        self.objects[key] = body
        return SimpleNamespace(etag=_etag(body))

    async def _put_object(self, bucket, key, data, headers):
        self.calls.append(("_put_object", dict(headers)))
        current = self.objects.get(key)
        if "If-Match" in headers:
            if current is None:
                raise _s3error("NoSuchKey")
            if headers["If-Match"] != f'"{_etag(current)}"':
                raise _s3error("PreconditionFailed")
        if headers.get("If-None-Match") == "*" and current is not None:
            raise _s3error("PreconditionFailed")
        self.objects[key] = data
        return SimpleNamespace(etag=_etag(data))

    async def stat_object(self, bucket, key):
        if key not in self.objects:
            raise _s3error("NoSuchKey")
        return SimpleNamespace(
            etag=_etag(self.objects[key]), size=len(self.objects[key])
        )

    async def get_object(self, bucket, key, session):
        if key not in self.objects:
            raise _s3error("NoSuchKey")
        return _Response(self.objects[key])

    async def remove_object(self, bucket, key):
        self.calls.append(("remove_object", key))
        self.objects.pop(key, None)


def _store() -> tuple[ObjectStore, _FakeMinio]:
    store = ObjectStore(endpoint_url="http://store", access_key="k", secret_key="s")
    fake = _FakeMinio()
    store._client = lambda: fake  # type: ignore[method-assign]
    return store, fake


class TestEtagNormalization:
    @pytest.mark.parametrize("raw", ['"abc"', "abc", 'W/"abc"', ' "abc" '])
    def test_quoted_weak_and_bare_forms_compare_equal(self, raw):
        assert _normalize_etag(raw) == "abc"

    def test_none_and_empty_stay_none(self):
        assert _normalize_etag(None) is None
        assert _normalize_etag('""') is None


@pytest.mark.asyncio
class TestNativeConditionalPut:
    async def test_unconditional_put_uses_the_public_path_and_returns_the_etag(self):
        store, fake = _store()

        result = await store.put_object(bucket=_BUCKET, key="k", body=b"v1")

        assert fake.calls == [("put_object", None)]
        assert result.size == 2
        assert result.etag == _etag(b"v1")

    async def test_if_match_rides_as_a_quoted_header(self):
        store, fake = _store()
        fake.objects["k"] = b"v1"

        result = await store.put_object(
            bucket=_BUCKET, key="k", body=b"v2", if_match=_etag(b"v1")
        )

        assert fake.calls[-1] == (
            "_put_object",
            {
                "Content-Type": "application/octet-stream",
                "If-Match": f'"{_etag(b"v1")}"',
            },
        )
        assert result.etag == _etag(b"v2")

    async def test_a_quoted_if_match_from_the_caller_is_not_double_quoted(self):
        store, fake = _store()
        fake.objects["k"] = b"v1"

        await store.put_object(
            bucket=_BUCKET, key="k", body=b"v2", if_match=f'"{_etag(b"v1")}"'
        )

        assert fake.calls[-1][1]["If-Match"] == f'"{_etag(b"v1")}"'

    async def test_if_none_match_any_rides_as_star(self):
        store, fake = _store()

        result = await store.put_object(
            bucket=_BUCKET, key="k", body=b"new", if_none_match_any=True
        )

        assert fake.calls[-1][1]["If-None-Match"] == "*"
        assert result.etag == _etag(b"new")

    async def test_if_match_mismatch_carries_the_current_etag(self):
        store, fake = _store()
        fake.objects["k"] = b"v1"

        with pytest.raises(StorePreconditionFailed) as exc:
            await store.put_object(
                bucket=_BUCKET, key="k", body=b"v2", if_match="stale"
            )

        assert exc.value.current_etag == _etag(b"v1")
        assert fake.objects["k"] == b"v1"

    async def test_if_match_on_a_missing_key_is_a_precondition_failure_with_no_etag(
        self,
    ):
        store, _ = _store()

        with pytest.raises(StorePreconditionFailed) as exc:
            await store.put_object(
                bucket=_BUCKET, key="missing", body=b"v", if_match="x"
            )

        assert exc.value.current_etag is None

    async def test_if_none_match_any_on_an_existing_key_carries_its_etag(self):
        store, fake = _store()
        fake.objects["k"] = b"v1"

        with pytest.raises(StorePreconditionFailed) as exc:
            await store.put_object(
                bucket=_BUCKET, key="k", body=b"v2", if_none_match_any=True
            )

        assert exc.value.current_etag == _etag(b"v1")

    async def test_other_store_errors_are_not_swallowed(self):
        store, fake = _store()

        async def _boom(*_a, **_k):
            raise _s3error("AccessDenied")

        fake._put_object = _boom

        with pytest.raises(S3Error):
            await store.put_object(bucket=_BUCKET, key="k", body=b"v", if_match="x")


@pytest.mark.asyncio
class TestEmulatedConditionalDelete:
    async def test_matching_etag_deletes_the_object(self):
        store, fake = _store()
        fake.objects["k"] = b"v1"

        count = await store.delete_object_if_match(
            bucket=_BUCKET, key="k", if_match=f'"{_etag(b"v1")}"'
        )

        assert count == 1
        assert ("remove_object", "k") in fake.calls
        assert "k" not in fake.objects

    async def test_mismatch_keeps_the_object_and_reports_its_etag(self):
        store, fake = _store()
        fake.objects["k"] = b"v1"

        with pytest.raises(StorePreconditionFailed) as exc:
            await store.delete_object_if_match(
                bucket=_BUCKET, key="k", if_match="stale"
            )

        assert exc.value.current_etag == _etag(b"v1")
        assert "k" in fake.objects
        assert not any(name == "remove_object" for name, _ in fake.calls)

    async def test_missing_object_is_a_precondition_failure_with_no_etag(self):
        store, _ = _store()

        with pytest.raises(StorePreconditionFailed) as exc:
            await store.delete_object_if_match(
                bucket=_BUCKET, key="missing", if_match="x"
            )

        assert exc.value.current_etag is None


@pytest.mark.asyncio
class TestStatAndRead:
    async def test_stat_returns_the_unquoted_etag_and_size(self):
        store, fake = _store()
        fake.objects["k"] = b"hello"

        stat = await store.stat_object(bucket=_BUCKET, key="k")

        assert stat.etag == _etag(b"hello")
        assert stat.size == 5

    async def test_stat_missing_raises_the_not_found_path(self):
        store, _ = _store()

        with pytest.raises(MountFileNotFound):
            await store.stat_object(bucket=_BUCKET, key="missing")

    async def test_get_with_etag_reads_the_header_off_the_get_response(self):
        store, fake = _store()
        fake.objects["k"] = b"hello"

        body, etag = await store.get_object_with_etag(bucket=_BUCKET, key="k")

        assert body == b"hello"
        assert etag == _etag(b"hello")

    async def test_plain_get_still_returns_bytes(self):
        store, fake = _store()
        fake.objects["k"] = b"hello"

        assert await store.get_object(bucket=_BUCKET, key="k") == b"hello"
