"""API to browser-controller calls, through the URL and headers the runner reports."""

from typing import Any, Dict, List, Optional

import httpx

from oss.src.core.browser_profiles.dtos import (
    BrowserControllerState,
    BrowserOpResult,
    BrowserSandbox,
)
from oss.src.core.browser_profiles.types import BrowserToolError, BrowserUnavailable
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)

_SETUP_TIMEOUT_SECONDS = 30.0
_OP_TIMEOUT_SECONDS = 90.0
_STATE_TIMEOUT_SECONDS = 15.0


def controller_live_url(sandbox: BrowserSandbox) -> str:
    base = sandbox.url.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://") :]
    return base + "/live"


class BrowserControllerClient:
    async def _request(
        self,
        sandbox: BrowserSandbox,
        *,
        method: str,
        path: str,
        timeout: float,
        body: Optional[Dict[str, Any]] = None,
    ) -> Any:
        url = sandbox.url.rstrip("/") + path
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.request(
                    method, url, json=body, headers=sandbox.headers
                )
        except httpx.HTTPError as e:
            log.warning(
                "browser.controller", path=path, outcome="unreachable", error=str(e)
            )
            raise BrowserUnavailable() from e
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if not isinstance(payload, dict):
            log.warning(
                "browser.controller",
                path=path,
                outcome="unreadable",
                status=response.status_code,
            )
            raise BrowserUnavailable()
        error = payload.get("error")
        if payload.get("ok") is False and isinstance(error, dict):
            raise BrowserToolError(
                code=str(error.get("code") or "browser_unavailable"),
                message=str(error.get("message") or "The browser refused the action."),
                retryable=bool(error.get("retryable")),
                next_step=(
                    error["next_step"]
                    if isinstance(error.get("next_step"), str)
                    else None
                ),
                details=(
                    error["details"] if isinstance(error.get("details"), dict) else None
                ),
            )
        if response.status_code >= 300:
            log.warning(
                "browser.controller",
                path=path,
                outcome="refused",
                status=response.status_code,
            )
            raise BrowserUnavailable()
        return payload

    async def setup(
        self,
        sandbox: BrowserSandbox,
        *,
        allowed_hosts: List[str],
        storage_state: Optional[Dict[str, Any]],
        generation: Any,
    ) -> None:
        body: Dict[str, Any] = {"allowedHosts": allowed_hosts, "generation": generation}
        if storage_state is not None:
            body["storageState"] = storage_state
        await self._request(
            sandbox,
            method="POST",
            path="/setup",
            timeout=_SETUP_TIMEOUT_SECONDS,
            body=body,
        )

    async def op(
        self,
        sandbox: BrowserSandbox,
        *,
        op: str,
        args: Dict[str, Any],
        logins: Optional[List[str]] = None,
    ) -> BrowserOpResult:
        """`logins`: the profile ids the browser must hold; it refuses (`logins_changed`) otherwise."""
        body: Dict[str, Any] = {"op": op, "args": args}
        if logins is not None:
            body["logins"] = logins
        payload = await self._request(
            sandbox,
            method="POST",
            path="/op",
            timeout=_OP_TIMEOUT_SECONDS,
            body=body,
        )
        return BrowserOpResult(
            text=str(payload.get("text") or ""),
            state_dirty=bool(payload.get("stateDirty")),
        )

    async def state(self, sandbox: BrowserSandbox) -> BrowserControllerState:
        payload = await self._request(
            sandbox,
            method="GET",
            path="/state",
            timeout=_STATE_TIMEOUT_SECONDS,
        )
        storage_state = payload.get("storageState")
        generation = payload.get("generation")
        if not isinstance(storage_state, dict) or generation is None:
            raise BrowserUnavailable(
                message="The browser answered with an unreadable session state."
            )
        return BrowserControllerState(
            storage_state=storage_state, generation=generation
        )
