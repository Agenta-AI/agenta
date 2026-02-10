import httpx

import agenta as ag
from agenta.sdk.utils.logging import get_module_logger

BASE_TIMEOUT = 10

log = get_module_logger(__name__)


def authed_api():
    """
    Preconfigured httpx client for authenticated endpoints (supports all methods).
    """

    api_url = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_url
    api_key = ag.DEFAULT_AGENTA_SINGLETON_INSTANCE.api_key

    if not api_url or not api_key:
        log.error("Please call ag.init() first.")
        log.error("And don't forget to set AGENTA_API_URL and AGENTA_API_KEY.")
        raise ValueError("API URL and API Key must be set.")

    def _request(method: str, endpoint: str, **kwargs):
        url = f"{api_url}{endpoint}"
        headers = kwargs.pop("headers", {})
        headers.setdefault("Authorization", f"ApiKey {api_key}")

        with httpx.Client() as client:
            return client.request(
                method=method,
                url=url,
                headers=headers,
                timeout=BASE_TIMEOUT,
                **kwargs,
            )

    return _request
