"""The inbound check: every Teams request carries a JWT that Microsoft's Bot
Framework signed. Microsoft's steps:
https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
"""

import asyncio
import time
from typing import Any, Dict, Optional

import httpx
import jwt

from oss.src.core.channels.types import ChannelSignatureInvalid
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

OPENID_CONFIGURATION_URL = (
    "https://login.botframework.com/v1/.well-known/openidconfiguration"
)
ISSUER = "https://api.botframework.com"
LEEWAY_SECONDS = 300

# Microsoft asks for a refresh at least once a day.
_KEYS_MAX_AGE_SECONDS = 24 * 60 * 60
# The key id is read before the signature is checked, so an unsigned request
# can name an unknown one. This bounds how often that makes us call Microsoft.
_REFRESH_MIN_INTERVAL_SECONDS = 60.0
_FETCH_TIMEOUT_SECONDS = 10.0


class BotFrameworkKeys:
    """Microsoft's signing keys, shared by every connection in the process."""

    def __init__(self, *, http_client: httpx.AsyncClient) -> None:
        self._client = http_client
        self._keys: Dict[str, Dict[str, Any]] = {}
        self._fetched_at = 0.0
        self._attempted_at: Optional[float] = None
        self._lock = asyncio.Lock()

    async def get(self, key_id: str) -> Optional[Dict[str, Any]]:
        if key_id not in self._keys or self._stale():
            async with self._lock:
                # Another request may have refreshed while this one waited.
                if (key_id not in self._keys or self._stale()) and self._may_refresh():
                    await self._refresh()
        return self._keys.get(key_id)

    def _stale(self) -> bool:
        return time.monotonic() - self._fetched_at > _KEYS_MAX_AGE_SECONDS

    def _may_refresh(self) -> bool:
        return (
            self._attempted_at is None
            or time.monotonic() - self._attempted_at >= _REFRESH_MIN_INTERVAL_SECONDS
        )

    async def _refresh(self) -> None:
        """A failed read keeps the keys already held: Microsoft rotates them
        rarely, and refusing every request while its endpoint is down would
        lose messages."""

        self._attempted_at = time.monotonic()
        try:
            configuration = await self._get_json(OPENID_CONFIGURATION_URL)
            document = await self._get_json(str(configuration["jwks_uri"]))
            keys = {
                str(key["kid"]): key
                for key in document.get("keys") or []
                if isinstance(key, dict) and key.get("kid")
            }
        except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
            log.warning("[TEAMS] signing key read failed: %s", type(exc).__name__)
            return
        if keys:
            self._keys = keys
            self._fetched_at = time.monotonic()

    async def _get_json(self, url: str) -> Dict[str, Any]:
        response = await self._client.get(url, timeout=_FETCH_TIMEOUT_SECONDS)
        response.raise_for_status()
        body = response.json()
        if not isinstance(body, dict):
            raise ValueError("not a JSON object")
        return body


def bearer_token(headers: Dict[str, str]) -> Optional[str]:
    value = {k.lower(): v for k, v in headers.items()}.get("authorization") or ""
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


async def verify_token(
    *,
    token: Optional[str],
    app_id: str,
    service_url: Any,
    keys: BotFrameworkKeys,
) -> None:
    """Raise ChannelSignatureInvalid unless `token` is a Bot Framework JWT for
    `app_id` that vouches for `service_url`. Emulator tokens have another
    issuer, so they fail."""

    def refuse() -> ChannelSignatureInvalid:
        return ChannelSignatureInvalid(channel="teams")

    if not token or not app_id:
        raise refuse()
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as exc:
        raise refuse() from exc
    key_id = header.get("kid")
    if header.get("alg") != "RS256" or not isinstance(key_id, str):
        raise refuse()

    jwk = await keys.get(key_id)
    if jwk is None:
        raise refuse()
    try:
        claims = jwt.decode(
            token,
            jwt.PyJWK(jwk, algorithm="RS256").key,
            algorithms=["RS256"],
            audience=[app_id, f"api://{app_id}", f"api://botid-{app_id}"],
            issuer=ISSUER,
            leeway=LEEWAY_SECONDS,
            options={"require": ["exp", "iss", "aud"]},
        )
    except jwt.PyJWTError as exc:
        raise refuse() from exc

    claimed = claims.get("serviceurl")
    if (
        not isinstance(claimed, str)
        or not isinstance(service_url, str)
        or claimed.rstrip("/") != service_url.rstrip("/")
    ):
        raise refuse()
