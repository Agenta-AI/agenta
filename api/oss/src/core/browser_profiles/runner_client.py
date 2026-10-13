"""API to runner calls for browser sandbox lifecycle; the runner never sees session state."""

from typing import Any, Dict, Optional
from uuid import UUID

import httpx

from oss.src.core.browser_profiles.dtos import BrowserSandbox, BrowserScope
from oss.src.core.browser_profiles.types import BrowserUnavailable
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

# Ensure may create a sandbox and wait for the controller's health check.
_ENSURE_TIMEOUT_SECONDS = 90.0
_FIND_TIMEOUT_SECONDS = 15.0
_DELETE_TIMEOUT_SECONDS = 15.0


class BrowserRunnerClient:
    def __init__(
        self,
        *,
        base_url: Optional[str] = None,
        token: Optional[str] = None,
    ) -> None:
        self._base_url = base_url if base_url is not None else env.runner.internal_url
        self._token = token if token is not None else env.runner.token

    def _url(self, path: str) -> str:
        if not self._base_url or not self._token:
            raise BrowserUnavailable(
                message="The agent runner is not configured on this deployment."
            )
        return str(self._base_url).rstrip("/") + path

    async def _post(
        self, path: str, body: Dict[str, Any], timeout: float
    ) -> httpx.Response:
        url = self._url(path)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                return await client.post(
                    url, json=body, headers={"Authorization": f"Bearer {self._token}"}
                )
        except httpx.HTTPError as e:
            log.warning(
                "browser.runner", path=path, outcome="unreachable", error=str(e)
            )
            raise BrowserUnavailable() from e

    async def ensure(
        self,
        *,
        project_id: UUID,
        scope: BrowserScope,
        ref: str,
        label: str,
    ) -> BrowserSandbox:
        response = await self._post(
            "/browser/ensure",
            _key(project_id=project_id, scope=scope, ref=ref, label=label),
            _ENSURE_TIMEOUT_SECONDS,
        )
        if response.status_code >= 300:
            log.warning(
                "browser.runner",
                path="/browser/ensure",
                outcome="refused",
                status=response.status_code,
            )
            raise BrowserUnavailable()
        return _parse_sandbox(response, label=label)

    async def find(
        self,
        *,
        project_id: UUID,
        scope: BrowserScope,
        ref: str,
        label: str,
    ) -> Optional[BrowserSandbox]:
        response = await self._post(
            "/browser/find",
            _key(project_id=project_id, scope=scope, ref=ref, label=label),
            _FIND_TIMEOUT_SECONDS,
        )
        if response.status_code == 404:
            return None
        if response.status_code >= 300:
            log.warning(
                "browser.runner",
                path="/browser/find",
                outcome="refused",
                status=response.status_code,
            )
            raise BrowserUnavailable()
        return _parse_sandbox(response, label=label)

    async def delete(
        self,
        *,
        project_id: UUID,
        scope: Optional[BrowserScope] = None,
        ref: Optional[str] = None,
        label: Optional[str] = None,
    ) -> None:
        """One browser of a key (`label` narrows it to its owner), or every browser of a label.

        Never raises: an orphaned sandbox auto-stops after 5 idle minutes anyway."""
        body: Dict[str, Any] = {"projectId": str(project_id)}
        if scope is not None and ref is not None:
            body.update({"scope": scope.value, "ref": ref})
        if label is not None:
            body["profileId"] = label
        try:
            response = await self._post(
                "/browser/delete", body, _DELETE_TIMEOUT_SECONDS
            )
        except BrowserUnavailable:
            return
        if response.status_code >= 300 and response.status_code != 404:
            log.warning(
                "browser.runner",
                path="/browser/delete",
                outcome="refused",
                status=response.status_code,
            )


def _key(
    *, project_id: UUID, scope: BrowserScope, ref: str, label: str
) -> Dict[str, Any]:
    """The runner keys a browser by its owner label too, so one session id never shares one."""
    return {
        "projectId": str(project_id),
        "scope": scope.value,
        "ref": ref,
        "profileId": label,
    }


def _parse_sandbox(response: httpx.Response, *, label: str) -> BrowserSandbox:
    try:
        payload = response.json()
        return BrowserSandbox(
            sandbox_id=str(payload["sandboxId"]),
            url=str(payload["url"]),
            headers={str(k): str(v) for k, v in dict(payload["headers"]).items()},
            label=label,
        )
    except (ValueError, KeyError, TypeError, AttributeError) as e:
        raise BrowserUnavailable(
            message="The agent runner answered with an unreadable browser sandbox."
        ) from e
