import asyncio
import json

import httpx
import pytest

from oss.src.core.releases import service as releases_service
from oss.src.core.releases.dtos import ReleaseFeed
from oss.src.core.releases.service import (
    FAILED_FEED_TTL_SECONDS,
    FEED_TTL_SECONDS,
    MAX_FEED_BYTES,
    RELEASE_FEED_URL,
    ReleasesService,
)
from oss.src.utils.env import env

FEED = {
    "releases": [
        {
            "id": "v0.129.0",
            "date": "2026-11-20",
            "features": [],
            "improvements": [],
            "fixes": [],
            "securityFix": True,
        }
    ],
    "notices": [
        {
            "id": "trial",
            "title": "Try Enterprise",
            "body": "Body",
            "link": "https://agenta.ai/pricing",
            "severity": "info",
        }
    ],
}


class FakeCache:
    def __init__(self, value=None):
        self.value = value
        self.writes = []

    async def get(self, **kwargs):
        if self.value is None:
            return None
        return ReleaseFeed.model_validate(self.value)

    async def set(self, **kwargs):
        self.writes.append(kwargs)
        return True


@pytest.fixture
def cache(monkeypatch):
    fake = FakeCache()
    monkeypatch.setattr(releases_service, "get_cache", fake.get)
    monkeypatch.setattr(releases_service, "set_cache", fake.set)
    return fake


@pytest.fixture
def requests(monkeypatch):
    """Answers the feed request with `requests.handler` and records each request."""

    class Recorder(list):
        handler = staticmethod(lambda request: httpx.Response(200, json=FEED))

    recorder = Recorder()
    real_client = httpx.AsyncClient

    def handle(request):
        recorder.append(request)
        return recorder.handler(request)

    def client(**kwargs):
        return real_client(transport=httpx.MockTransport(handle), **kwargs)

    monkeypatch.setattr(releases_service.httpx, "AsyncClient", client)
    monkeypatch.setattr(releases_service, "get_agenta_version", lambda: "v0.128.11")
    monkeypatch.setattr(env.releases, "update_check_enabled", True)
    return recorder


async def test_returns_the_feed_and_the_running_version(cache, requests):
    result = await ReleasesService().fetch_instance_releases()

    assert result.version == "v0.128.11"
    assert result.releases == FEED["releases"]
    assert result.notices == FEED["notices"]
    assert cache.writes[0]["ttl"] == FEED_TTL_SECONDS
    assert cache.writes[0]["namespace"] == "releases:feed"
    assert cache.writes[0]["key"] == "feed"


async def test_request_carries_no_instance_data(cache, requests):
    await ReleasesService().fetch_instance_releases()

    assert len(requests) == 1
    request = requests[0]
    assert request.method == "GET"
    assert str(request.url) == RELEASE_FEED_URL
    assert request.content == b""
    sent = json.dumps(dict(request.headers)).lower()
    assert "v0.128.11" not in sent
    assert "0.128.11" not in str(request.url)
    assert not any(name.lower().startswith("x-") for name in request.headers)
    assert "authorization" not in {name.lower() for name in request.headers}
    assert "cookie" not in {name.lower() for name in request.headers}


async def test_update_check_off_makes_no_request(cache, requests, monkeypatch):
    monkeypatch.setattr(env.releases, "update_check_enabled", False)

    result = await ReleasesService().fetch_instance_releases()

    assert requests == []
    assert cache.writes == []
    assert result.version == "v0.128.11"
    assert result.releases == []
    assert result.notices == []


async def test_cached_feed_makes_no_request(cache, requests):
    cache.value = FEED

    result = await ReleasesService().fetch_instance_releases()

    assert requests == []
    assert result.releases == FEED["releases"]


@pytest.mark.parametrize(
    "handler",
    [
        pytest.param(lambda request: httpx.Response(503), id="server-error"),
        pytest.param(
            lambda request: httpx.Response(200, content=b"<html>"), id="not-json"
        ),
        pytest.param(
            lambda request: httpx.Response(200, json=["v0.129.0"]), id="not-an-object"
        ),
        pytest.param(
            lambda request: httpx.Response(200, json={"releases": "v0.129.0"}),
            id="missing-lists",
        ),
    ],
)
async def test_bad_feed_gives_an_empty_result(cache, requests, handler):
    requests.handler = handler

    result = await ReleasesService().fetch_instance_releases()

    assert result.releases == []
    assert result.notices == []
    assert cache.writes[0]["ttl"] == FAILED_FEED_TTL_SECONDS


@pytest.mark.parametrize(
    "error",
    [
        pytest.param(httpx.ConnectError("unreachable"), id="unreachable"),
        pytest.param(httpx.ReadTimeout("slow"), id="slow"),
    ],
)
async def test_unreachable_or_slow_feed_gives_an_empty_result(cache, requests, error):
    def fail(request):
        raise error

    requests.handler = fail

    result = await ReleasesService().fetch_instance_releases()

    assert result.releases == []
    assert result.notices == []
    assert cache.writes[0]["ttl"] == FAILED_FEED_TTL_SECONDS


async def test_request_has_a_short_timeout(cache, requests):
    await ReleasesService().fetch_instance_releases()

    timeout = requests[0].extensions["timeout"]
    assert all(value == 5.0 for value in timeout.values())


async def test_skips_entries_that_are_not_objects(cache, requests):
    requests.handler = lambda request: httpx.Response(
        200, json={"releases": [FEED["releases"][0], "bad"], "notices": [1]}
    )

    result = await ReleasesService().fetch_instance_releases()

    assert result.releases == FEED["releases"]
    assert result.notices == []


async def test_shared_cache_off_fetches_once_per_ttl(cache, requests):
    # FakeCache never stores, like an instance with API caching off.
    service = ReleasesService()

    await service.fetch_instance_releases()
    result = await service.fetch_instance_releases()

    assert len(requests) == 1
    assert result.releases == FEED["releases"]


async def test_failed_fetch_is_not_retried_on_the_next_request(cache, requests):
    requests.handler = lambda request: httpx.Response(503)
    service = ReleasesService()

    await service.fetch_instance_releases()
    await service.fetch_instance_releases()

    assert len(requests) == 1


async def test_concurrent_requests_share_one_fetch(cache, requests):
    service = ReleasesService()

    await asyncio.gather(*(service.fetch_instance_releases() for _ in range(5)))

    assert len(requests) == 1


async def test_too_large_feed_gives_an_empty_result(cache, requests):
    requests.handler = lambda request: httpx.Response(
        200, content=b" " * (MAX_FEED_BYTES + 1)
    )

    result = await ReleasesService().fetch_instance_releases()

    assert result.releases == []
    assert cache.writes[0]["ttl"] == FAILED_FEED_TTL_SECONDS


async def test_whole_download_has_a_deadline(cache, requests, monkeypatch):
    async def never_ends():
        await asyncio.sleep(10)

    monkeypatch.setattr(releases_service, "_read_feed_body", never_ends)
    monkeypatch.setattr(releases_service, "FETCH_TIMEOUT_SECONDS", 0.05)

    result = await ReleasesService().fetch_instance_releases()

    assert result.releases == []
    assert cache.writes[0]["ttl"] == FAILED_FEED_TTL_SECONDS
