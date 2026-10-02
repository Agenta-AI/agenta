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


def _request(headers, peer="10.0.0.9"):
    return SimpleNamespace(
        headers={k.lower(): v for k, v in headers.items()},
        client=SimpleNamespace(host=peer),
    )


@pytest.mark.parametrize(
    "headers, ip",
    [
        ({"X-Real-IP": "203.0.113.7", "X-Forwarded-For": "1.2.3.4"}, "203.0.113.7"),
        ({"X-Forwarded-For": "1.2.3.4, 198.51.100.2"}, "198.51.100.2"),
        ({}, "10.0.0.9"),
    ],
    ids=["ingress real ip", "last forwarded hop", "peer"],
)
def test_the_viewer_key_is_never_a_client_chosen_address(headers, ip):
    from oss.src.apis.fastapi.shared_apps.router import _client_ip

    assert _client_ip(_request(headers)) == ip
