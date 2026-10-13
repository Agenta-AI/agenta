"""The caller's ready cloud browser logins, from `POST /api/browser-profiles/available`."""

from __future__ import annotations

from typing import List, Optional

import httpx

from agenta.sdk.utils.logging import get_module_logger

from .connection import PlatformConnection
from .session_context import session_context_timeout

log = get_module_logger(__name__)


async def read_browser_profiles(
    *,
    revision_id: Optional[str],
    is_draft: bool,
    connection: Optional[PlatformConnection] = None,
) -> Optional[List[str]]:
    """None when the run may not use the caller's logins; [] when it may but has none."""
    connection = connection or PlatformConnection()
    api_base = connection.base_url()
    if not api_base:
        return None
    async with httpx.AsyncClient(timeout=session_context_timeout()) as client:
        response = await client.post(
            f"{api_base}/browser-profiles/available",
            json={"revision_id": revision_id, "is_draft": is_draft},
            headers=connection.headers(),
        )
    if response.status_code >= 400:
        log.warning("agent: browser profiles check HTTP %s", response.status_code)
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    ids = body.get("profile_ids") if isinstance(body, dict) else None
    if not isinstance(ids, list):
        return None
    ids = [
        profile_id for profile_id in ids if isinstance(profile_id, str) and profile_id
    ]
    if not ids and body.get("eligible") is not True:
        return None
    return ids
