import asyncio
import json
import time
from typing import Any, Optional

import httpx

from oss.src.core.releases.dtos import InstanceReleases, ReleaseFeed
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.utils.version import get_agenta_version

log = get_module_logger(__name__)

RELEASE_FEED_URL = "https://agenta.ai/releases.json"

CACHE_NAMESPACE = "releases:feed"
CACHE_KEY = "feed"
FEED_TTL_SECONDS = 12 * 60 * 60
FAILED_FEED_TTL_SECONDS = 60 * 60
FETCH_TIMEOUT_SECONDS = 5.0
# The published feed is about 10 KB; anything far larger is not the feed.
MAX_FEED_BYTES = 1024 * 1024


def _parse_feed(payload: Any) -> Optional[ReleaseFeed]:
    if not isinstance(payload, dict):
        return None
    releases = payload.get("releases")
    notices = payload.get("notices")
    if not isinstance(releases, list) or not isinstance(notices, list):
        return None
    return ReleaseFeed(
        releases=[item for item in releases if isinstance(item, dict)],
        notices=[item for item in notices if isinstance(item, dict)],
    )


async def _read_feed_body() -> bytes:
    body = bytearray()
    async with httpx.AsyncClient(timeout=FETCH_TIMEOUT_SECONDS) as client:
        async with client.stream("GET", RELEASE_FEED_URL) as response:
            response.raise_for_status()
            async for chunk in response.aiter_bytes():
                body += chunk
                if len(body) > MAX_FEED_BYTES:
                    raise ValueError("release feed is too large")
    return bytes(body)


async def _download_feed() -> Optional[ReleaseFeed]:
    # A plain GET: no instance id, no version, no other data about the instance.
    try:
        # The client timeout applies per read; this one bounds the whole download.
        body = await asyncio.wait_for(_read_feed_body(), FETCH_TIMEOUT_SECONDS)
        feed = _parse_feed(json.loads(body))
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warning("[releases] release feed fetch failed", error=str(e) or repr(e))
        return None

    if feed is None:
        log.warning("[releases] release feed is malformed")
    return feed


class ReleasesService:
    def __init__(self):
        # The shared cache is off on some instances. This copy keeps a page load from
        # reaching the website each time, and the lock lets one request fetch at a time.
        self._feed: Optional[ReleaseFeed] = None
        self._feed_expires_at = 0.0
        self._lock = asyncio.Lock()

    async def fetch_instance_releases(self) -> InstanceReleases:
        version = get_agenta_version()

        if not env.releases.update_check_enabled:
            return InstanceReleases(version=version)

        feed = await self._fetch_feed()

        return InstanceReleases(
            version=version,
            releases=feed.releases,
            notices=feed.notices,
        )

    def _keep(self, feed: ReleaseFeed, ttl_seconds: int) -> ReleaseFeed:
        self._feed = feed
        self._feed_expires_at = time.monotonic() + ttl_seconds
        return feed

    def _kept_feed(self) -> Optional[ReleaseFeed]:
        if self._feed is not None and time.monotonic() < self._feed_expires_at:
            return self._feed
        return None

    async def _fetch_feed(self) -> ReleaseFeed:
        kept = self._kept_feed()
        if kept is not None:
            return kept

        async with self._lock:
            kept = self._kept_feed()
            if kept is not None:
                return kept

            cached = await get_cache(
                namespace=CACHE_NAMESPACE,
                key=CACHE_KEY,
                model=ReleaseFeed,
                retry=False,
            )
            if cached is not None:
                # The remaining shared TTL is unknown, so read it again within the hour.
                return self._keep(cached, FAILED_FEED_TTL_SECONDS)

            feed = await _download_feed()
            ttl_seconds = (
                FEED_TTL_SECONDS if feed is not None else FAILED_FEED_TTL_SECONDS
            )
            feed = feed or ReleaseFeed()

            # A failed fetch is kept as empty too, so the next try is an hour later.
            await set_cache(
                namespace=CACHE_NAMESPACE,
                key=CACHE_KEY,
                value=feed,
                ttl=ttl_seconds,
            )

            return self._keep(feed, ttl_seconds)
