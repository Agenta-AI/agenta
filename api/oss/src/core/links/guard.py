"""Which link targets the preview fetcher may dial; every resolved address must pass."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from urllib.parse import urlparse

from oss.src.core.links.types import LinkPreviewRefused, LinkPreviewUnreachable
from oss.src.core.webhooks.utils import resolve_validated_ip

_DEFAULT_PORTS = {"http": 80, "https": 443}
_RESOLVE_TIMEOUT_SECONDS = 1.5
# Own pool: a chat-controlled host whose DNS hangs must not hold shared executor threads.
_RESOLVER = ThreadPoolExecutor(max_workers=2, thread_name_prefix="link-resolver")


async def resolve_link_address(*, url: str) -> str:
    """Refuse anything but a credential-free http(s) URL on its default port; return one address every DNS answer cleared."""
    parsed = urlparse(url)
    scheme = parsed.scheme.lower()
    if scheme not in _DEFAULT_PORTS:
        raise LinkPreviewRefused(
            "Only http and https links can be previewed.", reason="unsupported_scheme"
        )
    if parsed.username or parsed.password:
        raise LinkPreviewRefused(
            "Links with credentials cannot be previewed.", reason="credentials"
        )
    if not parsed.hostname:
        raise LinkPreviewRefused("The link has no host.", reason="missing_host")
    try:
        port = parsed.port or _DEFAULT_PORTS[scheme]
    except ValueError as exc:
        raise LinkPreviewRefused(
            "The link has an invalid port.", reason="invalid_port"
        ) from exc
    if port not in _DEFAULT_PORTS.values():
        raise LinkPreviewRefused(
            "Only ports 80 and 443 can be previewed.", reason="unsupported_port"
        )

    # Scheme and port are settled above; `https` only stops the shared check refusing plain http.
    check = partial(
        resolve_validated_ip,
        f"https://{parsed.netloc}",
        allow_insecure=False,
        label="Link",
    )
    try:
        # A timeout also cancels a lookup still queued for a thread.
        return await asyncio.wait_for(
            asyncio.get_running_loop().run_in_executor(_RESOLVER, check),
            _RESOLVE_TIMEOUT_SECONDS,
        )
    except (OSError, TimeoutError) as exc:
        raise LinkPreviewUnreachable("The link's host could not be resolved.") from exc
    except ValueError as exc:
        if "could not be resolved" in str(exc):
            raise LinkPreviewUnreachable(
                "The link's host could not be resolved."
            ) from exc
        raise LinkPreviewRefused(
            "The link points to a non-public address.", reason="non_public_address"
        ) from exc
