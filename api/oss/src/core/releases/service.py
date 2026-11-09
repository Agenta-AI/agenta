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
FEED_TTL = 12 * 60 * 60
FAILED_FEED_TTL = 60 * 60
FETCH_TIMEOUT = 5.0


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


async def _download_feed() -> Optional[ReleaseFeed]:
    # A plain GET: no instance id, no version, no other data about the instance.
    try:
        async with httpx.AsyncClient(timeout=FETCH_TIMEOUT) as client:
            response = await client.get(RELEASE_FEED_URL)
            response.raise_for_status()
            feed = _parse_feed(response.json())
    except Exception as e:  # pylint: disable=broad-exception-caught
        log.warning("[releases] release feed fetch failed", error=str(e))
        return None

    if feed is None:
        log.warning("[releases] release feed is malformed")
    return feed


class ReleasesService:
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

    async def _fetch_feed(self) -> ReleaseFeed:
        cached = await get_cache(
            namespace=CACHE_NAMESPACE,
            key=CACHE_KEY,
            model=ReleaseFeed,
            retry=False,
        )
        if cached is not None:
            return cached

        feed = await _download_feed()

        # A failed fetch is cached as empty too, so the next try is an hour later.
        await set_cache(
            namespace=CACHE_NAMESPACE,
            key=CACHE_KEY,
            value=feed or ReleaseFeed(),
            ttl=FEED_TTL if feed is not None else FAILED_FEED_TTL,
        )

        return feed or ReleaseFeed()
