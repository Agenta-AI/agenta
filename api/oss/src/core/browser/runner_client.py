"""Asks the runner where a session's browser serves its live view (`POST /browser/live`)."""

from typing import Any
from uuid import UUID

import httpx

from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

_LIVE_TIMEOUT_SECONDS = 15.0


async def fetch_live_link(
    *,
    project_id: UUID,
    session_id: str,
    base_url: str | None = None,
    token: str | None = None,
) -> dict[str, Any] | None:
    """`{url, headers}` of the session's running browser, or None when there is none."""
    base_url = base_url if base_url is not None else env.runner.internal_url
    token = token if token is not None else env.runner.token
    if not base_url or not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=_LIVE_TIMEOUT_SECONDS) as client:
            response = await client.post(
                str(base_url).rstrip("/") + "/browser/live",
                json={"projectId": str(project_id), "sessionId": session_id},
                headers={"Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError as e:
        log.warning("browser.live", outcome="runner_unreachable", error=str(e))
        return None
    if response.status_code != 200:
        if response.status_code != 404:
            log.warning("browser.live", outcome="refused", status=response.status_code)
        return None
    body = response.json()
    if not isinstance(body.get("url"), str) or not isinstance(
        body.get("headers"), dict
    ):
        return None
    return {"url": body["url"], "headers": body["headers"]}
