"""``create_app`` and ``list_starters`` as reserved ``tools.agenta.*`` handlers.

Both are registered in ``core/tools/platform_handlers.py`` and reached through
``POST /tools/call``. The model-facing tool definitions (``*_TOOL_DEFINITION``) mirror the SDK's
``PlatformOp`` fields so the SDK op catalog entry is a copy, not a rewrite.

Mount resolution: dispatch hands the handler the router's ``MountsService``; no mount id
travels in the call. It receives ``session_id`` (bound from
``$ctx.session.id``, stripped from the model-visible schema) and resolves the session's cwd
mount through ``MountsService.get_or_create_session_mount``; ``list_starters`` also takes
``artifact_id`` (``$ctx.workflow.artifact.id``) to reach the agent mount. Both fail closed the
way ``read_config`` does for its bound variant id.
"""

from __future__ import annotations

import json
from typing import Any, Dict, Optional
from uuid import UUID

from oss.src.core.apps.service import AGENT_STARTERS_DIR, AppsError, AppsService
from oss.src.core.mounts.types import MountError
from oss.src.core.tools.dtos import AgentError, PlatformHandlerResult
from oss.src.core.tools.exceptions import (
    PlatformToolHandlerRefused,
    PlatformToolHandlerUnavailable,
)

CREATE_APP_CALL_REF = "tools.agenta.create_app"
LIST_STARTERS_CALL_REF = "tools.agenta.list_starters"
CREATE_APP_DEFAULT_TIMEOUT_MS = 30_000
LIST_STARTERS_DEFAULT_TIMEOUT_MS = 15_000

_SESSION_ID_SCHEMA: Dict[str, Any] = {
    "type": "string",
    "description": "Bound from the run; the model never sets it.",
}

CREATE_APP_TOOL_DEFINITION: Dict[str, Any] = {
    "op": "create_app",
    "handler": CREATE_APP_CALL_REF,
    "description": (
        "Copy an app starter into a folder of this session's drive so the person gets a "
        "small interactive page (a board, a checklist, a form). Call list_starters first, "
        "then create_app(starter, dir); then write the app's config and data files. "
        "Refuses when dir/app.json already exists unless update is true, and an update "
        "leaves the app's data and config files alone."
    ),
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["starter", "dir"],
        "properties": {
            "starter": {
                "type": "string",
                "description": "Starter name, optionally pinned: `board` or `board@1`.",
            },
            "dir": {
                "type": "string",
                "description": "Target folder relative to the drive root, e.g. `apps/sprint-board`.",
            },
            "update": {
                "type": "boolean",
                "default": False,
                "description": "Refresh the template files of an existing app in `dir`.",
            },
            "session_id": _SESSION_ID_SCHEMA,
        },
    },
    "context_bindings": {"session_id": "$ctx.session.id"},
    "read_only": False,
    "timeout_ms": CREATE_APP_DEFAULT_TIMEOUT_MS,
}

LIST_STARTERS_TOOL_DEFINITION: Dict[str, Any] = {
    "op": "list_starters",
    "handler": LIST_STARTERS_CALL_REF,
    "description": (
        "List the app starters create_app can copy: name, version, when to use it, its "
        "config keys, data files and the drive access it needs. Includes starters this "
        f"agent authored under agent-files/{AGENT_STARTERS_DIR}/ (listed, not copyable yet)."
    ),
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "session_id": _SESSION_ID_SCHEMA,
            "artifact_id": {
                "type": "string",
                "description": "Bound from the run; the model never sets it.",
            },
        },
    },
    "context_bindings": {
        "session_id": "$ctx.session.id",
        "artifact_id": "$ctx.workflow.artifact.id",
    },
    "read_only": True,
    "timeout_ms": LIST_STARTERS_DEFAULT_TIMEOUT_MS,
}


# ---------------------------------------------------------------------------
# Context
# ---------------------------------------------------------------------------


def _require_mounts(mounts_service: Any, *, op: str) -> Any:
    if mounts_service is None:
        raise PlatformToolHandlerUnavailable(
            f"{op} is not enabled on this deployment: mounts service is missing."
        )
    return mounts_service


def _parse(arguments: Any) -> Dict[str, Any]:
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError as e:
            raise AppsError(
                "invalid_arguments",
                f"arguments are not valid JSON: {e.msg}",
                next_step="Send the arguments as a JSON object.",
            ) from e
    if not isinstance(arguments, dict):
        raise AppsError(
            "invalid_arguments",
            f"arguments must be a JSON object, not {type(arguments).__name__}.",
            next_step="Send the arguments as a JSON object.",
        )
    return arguments


def _bound_session_id(arguments: Dict[str, Any]) -> str:
    session_id = arguments.get("session_id")
    if not isinstance(session_id, str) or not session_id.strip():
        raise PlatformToolHandlerRefused(
            "session_id is bound from the run and was missing."
        )
    return session_id.strip()


def _failure(error: AppsError) -> PlatformHandlerResult:
    return PlatformHandlerResult.failure(AgentError(**error.to_detail()))


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


async def handle_create_app(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Any = None,
    tracing_service: Any = None,
    timeout_ms: int = CREATE_APP_DEFAULT_TIMEOUT_MS,
    mounts_service: Any = None,
) -> PlatformHandlerResult:
    try:
        parsed = _parse(arguments)
    except AppsError as e:
        return _failure(e)
    session_id = _bound_session_id(parsed)
    mounts = _require_mounts(mounts_service, op="create_app")
    apps = AppsService(mounts_service=mounts)

    try:
        mount = await mounts.get_or_create_session_mount(
            project_id=project_id, user_id=user_id, session_id=session_id
        )
        result = await apps.create_app(
            project_id=project_id,
            mount_id=mount.id,
            starter=str(parsed.get("starter") or ""),
            dir=str(parsed.get("dir") or ""),
            update=bool(parsed.get("update") or False),
        )
    except AppsError as e:
        return _failure(e)
    except MountError as e:
        return _failure(
            AppsError(
                "drive_error",
                getattr(e, "message", None) or str(e) or "The drive refused the write.",
                next_step="Check the dir and try again.",
            )
        )
    return PlatformHandlerResult(content=result.to_dict())


async def handle_list_starters(
    *,
    arguments: Any,
    headers: Any = None,
    project_id: UUID,
    user_id: UUID,
    workflows_service: Any = None,
    tracing_service: Any = None,
    timeout_ms: int = LIST_STARTERS_DEFAULT_TIMEOUT_MS,
    mounts_service: Any = None,
) -> PlatformHandlerResult:
    try:
        parsed = _parse(arguments) if arguments not in (None, "") else {}
    except AppsError as e:
        return _failure(e)
    mounts = _require_mounts(mounts_service, op="list_starters")
    apps = AppsService(mounts_service=mounts)

    agent_mount_id: Optional[UUID] = None
    artifact_id = parsed.get("artifact_id")
    if isinstance(artifact_id, str) and artifact_id.strip():
        try:
            agent_mount = await mounts.get_or_create_agent_mount(
                project_id=project_id, user_id=user_id, artifact_id=artifact_id
            )
            agent_mount_id = agent_mount.id
        except MountError:
            agent_mount_id = None  # a draft agent has no mount yet; bundle only

    starters = await apps.list_starters(
        project_id=project_id, agent_mount_id=agent_mount_id
    )
    return PlatformHandlerResult(content=[s.to_dict() for s in starters])
