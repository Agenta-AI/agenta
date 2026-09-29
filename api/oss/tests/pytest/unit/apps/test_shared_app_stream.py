"""The viewer body: a read that fails after the 200 still ends in valid JSON with `error`."""

import json
from types import SimpleNamespace

import pytest

from oss.src.apis.fastapi.shared_apps.router import SharedAppsRouter


class _Shares:
    def __init__(self, fail_after):
        self.fail_after = fail_after

    async def iter_blobs(self, snapshot, section):
        for i in range(3):
            if i == self.fail_after:
                raise OSError("store went away")
            yield f"{section}{i}", SimpleNamespace(content_type="text/plain"), b"x"


async def _body(fail_after):
    router = SharedAppsRouter(app_shares_service=_Shares(fail_after))
    chunks = [chunk async for chunk in router._stream({"name": "Board"}, snapshot=None)]
    return json.loads(b"".join(chunks))


@pytest.mark.asyncio
async def test_a_complete_body_has_no_error():
    body = await _body(fail_after=None)
    assert "error" not in body and len(body["files"]) == 3 == len(body["external"])


@pytest.mark.asyncio
async def test_a_failed_read_ends_the_body_with_an_error():
    body = await _body(fail_after=1)
    assert body["error"]["code"] == "storage_unavailable"
    assert list(body["files"]) == ["files0"] and body["external"] == {}
