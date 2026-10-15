import asyncio
from typing import Optional
from urllib.parse import urljoin, urlparse, urlunparse

import httpx

from oss.src.core.gateways.dtos import no_cookie_jar
from oss.src.core.links.guard import resolve_link_address
from oss.src.core.links.parser import parse_link_preview
from oss.src.core.links.types import (
    LinkPreview,
    LinkPreviewRefused,
    LinkPreviewUnreachable,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_TIMEOUT_SECONDS = 3.0
_MAX_REDIRECTS = 3
_MAX_BYTES = 512 * 1024
_HTML_TYPES = {"text/html", "application/xhtml+xml"}
_USER_AGENT = "Mozilla/5.0 (compatible; AgentaLinkPreview/1.0; +https://agenta.ai)"
# Built once at import: loading the CA bundle per request blocked the event loop.
_SSL_CONTEXT = httpx.create_ssl_context()


async def _read_html(response: httpx.Response) -> Optional[str]:
    content_type = (
        response.headers.get("content-type", "").split(";")[0].strip().lower()
    )
    if response.status_code != 200 or content_type not in _HTML_TYPES:
        return None
    # Raw bytes under `identity`: the cap bounds what arrives, not what a compressed body inflates to.
    body = bytearray()
    async for chunk in response.aiter_raw():
        body += chunk
        if len(body) >= _MAX_BYTES:
            break
    try:
        return body[:_MAX_BYTES].decode(
            response.charset_encoding or "utf-8", errors="replace"
        )
    except LookupError:
        return body[:_MAX_BYTES].decode("utf-8", errors="replace")


async def _fetch_preview(*, url: str) -> LinkPreview:
    """GET `url` with each redirect hop re-checked and pinned; a refused redirect reads as unreachable."""
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
                address = await resolve_link_address(url=current)
            except LinkPreviewRefused:
                if hop == 0:
                    raise
                raise LinkPreviewUnreachable(
                    "A redirect led to a refused target."
                ) from None

            # Dial the checked address, so a name that re-resolves cannot move the request.
            parsed = urlparse(current)
            hostname = parsed.hostname or ""
            host = f"[{hostname}]" if ":" in hostname else hostname
            pinned = f"[{address}]" if ":" in address else address
            port = f":{parsed.port}" if parsed.port else ""
            request = client.build_request(
                "GET",
                urlunparse(parsed._replace(netloc=f"{pinned}{port}")),
                headers={
                    "Host": f"{host}{port}",
                    "User-Agent": _USER_AGENT,
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Encoding": "identity",
                },
                # The TLS handshake must name the host, not the pinned address.
                extensions={"sni_hostname": hostname},
            )
            response = await client.send(request, stream=True)
            try:
                if response.is_redirect:
                    current = urljoin(current, response.headers["location"])
                    continue
                return parse_link_preview(url=current, html=await _read_html(response))
            finally:
                await response.aclose()

    raise LinkPreviewUnreachable("The link redirected too many times.")


class LinksService:
    async def preview(self, *, url: str) -> LinkPreview:
        """A link's preview; an unreadable page still yields its URL and domain."""
        url = url.strip()
        try:
            async with asyncio.timeout(_TIMEOUT_SECONDS):
                return await _fetch_preview(url=url)
        except (LinkPreviewUnreachable, TimeoutError, httpx.HTTPError) as exc:
            log.debug("[links] preview fetch failed", url=url, error=type(exc).__name__)
        return parse_link_preview(url=url)
