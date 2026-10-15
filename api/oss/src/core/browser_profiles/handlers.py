"""The ``tools.agenta.browser_*`` handlers; the run binds the logins, never the model."""

from __future__ import annotations

import json
from functools import partial
from typing import Any, Dict, Optional
from uuid import UUID

from oss.src.core.browser_profiles.service import BrowserProfilesService
from oss.src.core.browser_profiles.types import (
    BrowserDisabled,
    BrowserProfileNotFound,
    BrowserToolError,
    profile_not_available,
)
from oss.src.core.tools.dtos import AgentError, PlatformHandlerResult
from oss.src.utils.env import env

BROWSER_DEFAULT_TIMEOUT_MS = 120_000

# Tool name -> controller op. Pay and delete are clicks the user approves first.
BROWSER_TOOL_OPS: Dict[str, str] = {
    "browser_navigate": "navigate",
    "browser_read_page": "read_page",
    "browser_find": "find",
    "browser_click": "click",
    "browser_type": "type",
    "browser_form_input": "form_input",
    "browser_pay": "click",
    "browser_delete": "click",
}

# Set here, never by the model: the controller clicks a pay or delete control only with its intent.
_BROWSER_TOOL_INTENTS: Dict[str, str] = {
    "browser_pay": "pay",
    "browser_delete": "delete",
}

_BINDING_KEYS = ("session_id", "profile_ids", "all_logins", "revision_id", "is_draft")
_SERVER_KEYS = (*_BINDING_KEYS, "intent")


def _failure(error: BrowserToolError) -> PlatformHandlerResult:
    return PlatformHandlerResult.failure(AgentError(**error.to_detail()))


def _parse(arguments: Any) -> Dict[str, Any]:
    if arguments in (None, ""):
        return {}
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError as e:
            raise BrowserToolError(
                code="invalid_arguments",
                message=f"arguments are not valid JSON: {e.msg}",
                next_step="Send the arguments as a JSON object.",
            ) from e
    if not isinstance(arguments, dict):
        raise BrowserToolError(
            code="invalid_arguments",
            message=f"arguments must be a JSON object, not {type(arguments).__name__}.",
            next_step="Send the arguments as a JSON object.",
        )
    return arguments


def _uuid(value: Any) -> Optional[UUID]:
    try:
        return UUID(str(value)) if value else None
    except ValueError:
        return None


async def handle_browser_tool(
    *,
    op: str,
    intent: Optional[str] = None,
    arguments: Any,
    project_id: UUID,
    user_id: UUID,
    browser_profiles_service: Optional[BrowserProfilesService] = None,
    **_: Any,
) -> PlatformHandlerResult:
    try:
        if not env.browser.enabled or browser_profiles_service is None:
            raise BrowserDisabled()

        parsed = _parse(arguments)
        session_id = parsed.get("session_id")
        raw_ids = parsed.get("profile_ids")
        profile_ids = [_uuid(v) for v in raw_ids] if isinstance(raw_ids, list) else []
        all_logins = parsed.get("all_logins") is True
        if not isinstance(session_id, str) or not session_id:
            raise profile_not_available()
        if not all_logins and (not profile_ids or None in profile_ids):
            raise profile_not_available()

        text = await browser_profiles_service.run_tool(
            project_id=project_id,
            user_id=user_id,
            session_id=session_id,
            profile_ids=[p for p in profile_ids if p is not None],
            all_logins=all_logins,
            revision_id=_uuid(parsed.get("revision_id")),
            is_draft=parsed.get("is_draft") is True,
            op=op,
            args={
                **{k: v for k, v in parsed.items() if k not in _SERVER_KEYS},
                **({"intent": intent} if intent else {}),
            },
        )
    except BrowserProfileNotFound:
        return _failure(profile_not_available())
    except BrowserToolError as e:
        return _failure(e)

    return PlatformHandlerResult(content=text)


BROWSER_TOOL_HANDLERS = {
    f"tools.agenta.{name}": partial(
        handle_browser_tool, op=op, intent=_BROWSER_TOOL_INTENTS.get(name)
    )
    for name, op in BROWSER_TOOL_OPS.items()
}
