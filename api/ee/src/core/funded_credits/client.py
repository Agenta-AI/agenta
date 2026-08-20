from typing import Any, Optional

import httpx

from ee.src.core.funded_credits.types import (
    KeyAliasExistsError,
    MintedKey,
    ProxyRequestError,
)

_REQUEST_TIMEOUT_SECONDS = 10.0


class FundedCreditsProxyClient:
    """Admin client for the funded-credits proxy (mint / inspect / block keys).

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
        team_id: Optional[str] = None,
        rpm_limit: Optional[int] = None,
        tpm_limit: Optional[int] = None,
    ) -> MintedKey:
        body: dict[str, Any] = {
            "key_alias": key_alias,
            "max_budget": max_budget,
            # An explicit list always; an omitted list would mean "any model".
            "models": models,
            "metadata": metadata,
        }
        if team_id:
            body["team_id"] = team_id
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

    async def get_key_info(self, *, key: str) -> dict[str, Any]:
        payload = await self._request("GET", "/key/info", params={"key": key})
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
            # Truncated body text is safe to log: error bodies never echo minted keys.
            detail = response.text[:300]
            if response.status_code == 400 and "alias" in detail.lower():
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
