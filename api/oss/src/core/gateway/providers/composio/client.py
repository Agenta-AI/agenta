import httpx

COMPOSIO_TIMEOUT_SECONDS = 30.0
# httpx retries only a failed connect (DNS lookup, refused, connect timeout). Nothing
# was sent, so a retry cannot repeat a write. Without it, one resolver blip fails the
# whole user flow with "No address associated with hostname".
COMPOSIO_CONNECT_RETRIES = 2


def composio_http_client() -> httpx.AsyncClient:
    """The pooled client every Composio adapter holds for its lifetime."""
    return httpx.AsyncClient(
        timeout=COMPOSIO_TIMEOUT_SECONDS,
        transport=httpx.AsyncHTTPTransport(retries=COMPOSIO_CONNECT_RETRIES),
    )
