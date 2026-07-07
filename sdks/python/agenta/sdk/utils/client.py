import os

import httpx

import agenta as ag
from agenta.sdk.utils.logging import get_module_logger

BASE_TIMEOUT = 10

log = get_module_logger(__name__)


def _authorization(api_key):
    """The Authorization header value: prefer the bare API key, else the full
    (scheme-tagged) ephemeral credential used verbatim (`AGENTA_CREDENTIALS` is a
    `Secret ...` when `/check` minted one)."""
    if api_key:
        return f"ApiKey {api_key}"
    credentials = os.getenv("AGENTA_CREDENTIALS")
    return credentials or None


def authed_api():
    """
    Preconfigured httpx client for authenticated endpoints (supports all methods).
    """

    api_url = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_url
    api_key = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key
    authorization = _authorization(api_key)

    if not api_url or not authorization:
        log.error("Please call ag.init() first.")
        log.error("And don't forget to set AGENTA_API_URL and AGENTA_API_KEY.")
        raise ValueError("API URL and credentials must be set.")

    def _request(method: str, endpoint: str, **kwargs):
        url = f"{api_url}{endpoint}"
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", authorization)

        with httpx.Client() as client:
            return client.request(
                method=method,
                url=url,
                headers=headers,
                timeout=BASE_TIMEOUT,
                **kwargs,
            )

    return _request


def authed_async_api():
    """
    Async preconfigured httpx client for authenticated endpoints.
    """

    api_url = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_url
    api_key = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key
    authorization = _authorization(api_key)

    if not api_url or not authorization:
        log.error("Please call ag.init() first.")
        log.error("And don't forget to set AGENTA_API_URL and AGENTA_API_KEY.")
        raise ValueError("API URL and credentials must be set.")

    async def _request(method: str, endpoint: str, **kwargs):
        url = f"{api_url}{endpoint}"
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", authorization)

        async with httpx.AsyncClient() as client:
            return await client.request(
                method=method,
                url=url,
                headers=headers,
                timeout=BASE_TIMEOUT,
                **kwargs,
            )

    return _request
