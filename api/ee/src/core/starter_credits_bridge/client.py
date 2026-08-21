import re
from typing import Any, Optional

import httpx

from ee.src.core.starter_credits_bridge.types import (
    KeyAliasExistsError,
    MintedKey,
    ProxyRequestError,
)

_REQUEST_TIMEOUT_SECONDS = 10.0

_KEY_PATTERN = re.compile(r"sk-[A-Za-z0-9_\-]+")


class StarterCreditsProxyClient:
    """Admin client for the starter-credits proxy (mint / inspect / block keys).

    Authenticates with the master key, which must never leave the backend.
    """

    def __init__(
        self,
        *,
        base_url: str,
        master_key: str,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self._base_url = base_url.rstrip("/")
        self._master_key = master_key
        self._transport = transport

    def _http_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            headers={"Authorization": f"Bearer {self._master_key}"},
            timeout=_REQUEST_TIMEOUT_SECONDS,
            transport=self._transport,
        )

    async def generate_key(
        self,
        *,
        key_alias: str,
        max_budget: float,
        models: list[str],
        metadata: dict[str, Any],
        team_id: str,
        max_parallel_requests: Optional[int] = None,
        rpm_limit: Optional[int] = None,
        tpm_limit: Optional[int] = None,
    ) -> MintedKey:
        body: dict[str, Any] = {
            "key_alias": key_alias,
            "max_budget": max_budget,
            # An explicit list always; an omitted list would mean "any model".
            "models": models,
            "metadata": metadata,
            # Always under the program team so its ceiling bounds total exposure.
            "team_id": team_id,
        }
        if max_parallel_requests is not None:
            body["max_parallel_requests"] = max_parallel_requests
        if rpm_limit is not None:
            body["rpm_limit"] = rpm_limit
        if tpm_limit is not None:
            body["tpm_limit"] = tpm_limit

        payload = await self._request("POST", "/key/generate", json=body)

        key = payload.get("key") if isinstance(payload, dict) else None
        if not isinstance(key, str) or not key:
            raise ProxyRequestError(
                status_code=200,
                detail="key generation response carried no key",
            )

        return MintedKey(key=key, key_alias=key_alias)

    async def delete_keys(self, *, key_aliases: list[str]) -> None:
        await self._request("POST", "/key/delete", json={"key_aliases": key_aliases})

    async def list_keys(self, *, key_alias: str) -> list[dict[str, Any]]:
        payload = await self._request(
            "GET",
            "/key/list",
            params={"key_alias": key_alias, "return_full_object": "true"},
        )
        keys = payload.get("keys") if isinstance(payload, dict) else None
        return [key for key in keys or [] if isinstance(key, dict)]

    async def get_team_info(self, *, team_id: str) -> dict[str, Any]:
        payload = await self._request("GET", "/team/info", params={"team_id": team_id})
        return payload if isinstance(payload, dict) else {}

    async def block_key(self, *, key: str) -> None:
        await self._request("POST", "/key/block", json={"key": key})

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[dict[str, Any]] = None,
        params: Optional[dict[str, Any]] = None,
    ) -> Any:
        try:
            async with self._http_client() as client:
                response = await client.request(
                    method,
                    f"{self._base_url}{path}",
                    json=json,
                    params=params,
                )
        except httpx.HTTPError as exc:
            raise ProxyRequestError(
                status_code=None,
                detail=f"request to {path} failed: {type(exc).__name__}",
            ) from exc

        if response.status_code >= 400:
            # Redact key material before the body can reach logs (a proxy error
            # may echo the failing request, which can carry a virtual key).
            detail = _KEY_PATTERN.sub("sk-[redacted]", response.text)[:300]
            # Only the measured conflict wording may trigger the destructive
            # delete-and-remint compensation; a validation 400 that merely
            # mentions the alias field must not.
            if (
                response.status_code == 400
                and "alias" in detail.lower()
                and "already exists" in detail.lower()
            ):
                raise KeyAliasExistsError(
                    status_code=response.status_code,
                    detail=detail,
                )
            raise ProxyRequestError(
                status_code=response.status_code,
                detail=detail,
            )

        try:
            return response.json()
        except ValueError as exc:
            raise ProxyRequestError(
                status_code=response.status_code,
                detail=f"non-JSON response from {path}",
            ) from exc
