import asyncio
from typing import Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

from oss.src.core.gateways.dtos import no_cookie_jar
from oss.src.core.links.guard import resolve_link_target
from oss.src.core.links.parser import head_section, parse_link_meta
from oss.src.core.links.types import (
    LinkPreview,
    LinkPreviewError,
    LinkPreviewRefused,
    LinkPreviewUnreachable,
)
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.logging import get_module_logger
from oss.src.utils.network import pin_to_resolved_address

log = get_module_logger(__name__)

_CACHE_NAMESPACE = "links:preview"
_REFUSED_CACHE_NAMESPACE = "links:preview:refused"
_CACHE_TTL_SECONDS = 24 * 60 * 60
_NEGATIVE_CACHE_TTL_SECONDS = 10 * 60

_TIMEOUT_SECONDS = 3.0
_MAX_REDIRECTS = 3
_MAX_BYTES = 512 * 1024
_PARSE_INLINE_CHARS = 64 * 1024
_HTML_TYPES = {"text/html", "application/xhtml+xml"}
_USER_AGENT = "Mozilla/5.0 (compatible; AgentaLinkPreview/1.0; +https://agenta.ai)"
# Built once at import: loading the CA bundle per request blocked the event loop.
_SSL_CONTEXT = httpx.create_ssl_context()


def normalize_link_url(url: str) -> str:
    """The cache key: scheme and host lowercased, fragment dropped."""
    parsed = urlparse(url.strip())
    return urlunparse(
        parsed._replace(
            scheme=parsed.scheme.lower(),
            netloc=parsed.netloc.lower(),
            fragment="",
        )
    )


def _domain(url: str) -> Optional[str]:
    host = (urlparse(url).hostname or "").lower()
    return host.removeprefix("www.") or None


async def _read_html(response: httpx.Response) -> Optional[str]:
    content_type = (
        response.headers.get("content-type", "").split(";")[0].strip().lower()
    )
    if content_type not in _HTML_TYPES:
        return None
    # Raw bytes only: the size cap must bound what arrives, not what a compressed body inflates to.
    if response.headers.get("content-encoding", "identity").lower() != "identity":
        return None
    body = bytearray()
    async for chunk in response.aiter_raw():
        body += chunk
        if len(body) >= _MAX_BYTES:
            break
    try:
        return bytes(body[:_MAX_BYTES]).decode(
            response.charset_encoding or "utf-8", errors="replace"
        )
    except LookupError:
        return bytes(body[:_MAX_BYTES]).decode("utf-8", errors="replace")


async def _fetch_html(url: str) -> tuple[str, Optional[str]]:
    """GET `url`, following at most `_MAX_REDIRECTS` redirects, each hop re-checked and pinned.

    Returns the final URL and its HTML, or None for a body that is not HTML or not a 200.
    Raises `LinkPreviewRefused` only for the first hop; a redirect into a refused target
    reads as unreachable.
    """
    current = url
    # One client per preview, never pooled: each hop is pinned to its own checked address.
    async with httpx.AsyncClient(
        timeout=_TIMEOUT_SECONDS,
        follow_redirects=False,
        cookies=no_cookie_jar(),
        verify=_SSL_CONTEXT,
    ) as client:
        for hop in range(_MAX_REDIRECTS + 1):
            try:
                target = await resolve_link_target(current)
            except LinkPreviewError:
                if hop == 0:
                    raise
                raise LinkPreviewUnreachable(
                    "A redirect led to a refused target."
                ) from None

            pinned_url, host_header = pin_to_resolved_address(current, target.address)
            request = client.build_request(
                "GET",
                pinned_url,
                headers={
                    "Host": host_header,
                    "User-Agent": _USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Encoding": "identity",
                },
                # The TLS handshake must name the host, not the pinned address.
                extensions={"sni_hostname": target.hostname},
            )
            response = await client.send(request, stream=True)
            try:
                if response.is_redirect:
                    location = response.headers.get("location")
                    if not location:
                        return current, None
                    current = urljoin(current, location)
                    continue
                if response.status_code != 200:
                    return current, None
                return current, await _read_html(response)
            finally:
                await response.aclose()

    raise LinkPreviewUnreachable("The link redirected too many times.")


class LinksService:
    def __init__(self) -> None:
        # In-process single flight: concurrent requests for one uncached URL share a fetch.
        self._inflight: dict[str, asyncio.Future] = {}

    async def preview(self, *, url: str) -> LinkPreview:
        """A link's preview, from cache or fetched. A page that cannot be read still yields its
        URL and domain; a refused URL raises `LinkPreviewRefused`."""
        key = normalize_link_url(url)

        refused = await get_cache(
            namespace=_REFUSED_CACHE_NAMESPACE, key=key, retry=False
        )
        if isinstance(refused, str):
            raise LinkPreviewRefused(refused)

        cached = await get_cache(
            namespace=_CACHE_NAMESPACE,
            key=key,
            model=LinkPreview,
            retry=False,
        )
        if cached is not None:
            return cached

        running = self._inflight.get(key)
        if running is not None:
            return await asyncio.shield(running)

        task = asyncio.ensure_future(self._fetch_and_cache(url=url, key=key))
        self._inflight[key] = task
        task.add_done_callback(lambda _: self._inflight.pop(key, None))
        return await asyncio.shield(task)

    async def _fetch_and_cache(self, *, url: str, key: str) -> LinkPreview:
        final_url, html = url, None
        try:
            async with asyncio.timeout(_TIMEOUT_SECONDS):
                final_url, html = await _fetch_html(url)
        except LinkPreviewRefused as exc:
            await set_cache(
                namespace=_REFUSED_CACHE_NAMESPACE,
                key=key,
                value=exc.message,
                ttl=_NEGATIVE_CACHE_TTL_SECONDS,
            )
            raise
        except LinkPreviewUnreachable:
            pass
        except (TimeoutError, httpx.HTTPError) as exc:
            log.debug("[links] preview fetch failed", url=key, error=type(exc).__name__)

        meta = None
        if html:
            head = head_section(html)
            # A page with no head end can still be 512 KB of markup: parse that off the loop.
            meta = (
                await asyncio.to_thread(parse_link_meta, head, final_url)
                if len(head) > _PARSE_INLINE_CHARS
                else parse_link_meta(head, final_url)
            )
        preview = LinkPreview(
            url=final_url,
            domain=_domain(final_url),
            **(meta.model_dump() if meta else {}),
        )
        found = any((preview.title, preview.description, preview.image))

        await set_cache(
            namespace=_CACHE_NAMESPACE,
            key=key,
            value=preview,
            ttl=_CACHE_TTL_SECONDS if found else _NEGATIVE_CACHE_TTL_SECONDS,
        )
        return preview
