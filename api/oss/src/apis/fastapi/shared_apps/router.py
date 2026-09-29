"""The public viewer route for shared agent HTML apps: `/shared/apps/{token}`.

Exempt from the auth middleware (see `_PUBLIC_ENDPOINTS`), so this route names its own caller
from the session cookie and runs the organization policy check itself. Access is decided once
per view; the whole snapshot comes back in one streamed JSON body, one blob at a time,
so no snapshot file ever has its own URL on the Agenta origin.
"""

import base64
import hashlib
import json
import math
from typing import AsyncIterator, Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from supertokens_python.recipe.session.asyncio import get_session

from oss.src.apis.fastapi.shared_apps.models import SharedAppResponse, SharedAppViewer
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.apps.sharing import AppShareError, AppSharesService, SharedAppSnapshot
from oss.src.core.auth.service import AuthService
from oss.src.middlewares.auth import resolve_session_user_id
from oss.src.services import db_manager
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger
from oss.src.utils.throttling import check_throttle

log = get_module_logger(__name__)

# Opens of one link: a burst, then a steady rate. A view is one heavy request, so a leaked link
# cannot be turned into unbounded egress and store reads.
_VIEWS_BURST = 20
_VIEWS_PER_MINUTE = 30

_VIEWER_STATUS = {
    "sharing_disabled": status.HTTP_503_SERVICE_UNAVAILABLE,
    "share_not_found": status.HTTP_404_NOT_FOUND,
    "share_unavailable": status.HTTP_404_NOT_FOUND,
    "storage_unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
}

# Snapshot content is data for the share page, never a page of its own.
_RESPONSE_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "no-store",
}


def _refuse(code: str, message: str, http_status: int, **extra) -> HTTPException:
    return HTTPException(
        status_code=http_status, detail={"code": code, "message": message, **extra}
    )


class SharedAppsRouter:
    def __init__(self, *, app_shares_service: AppSharesService):
        self.app_shares_service = app_shares_service
        self.router = APIRouter()
        self.router.add_api_route(
            "/{token}",
            self.fetch_shared_app,
            methods=["GET"],
            operation_id="fetch_shared_app",
            response_model=SharedAppResponse,
            status_code=status.HTTP_200_OK,
        )

    async def _viewer(
        self, request: Request, snapshot: SharedAppSnapshot
    ) -> SharedAppViewer:
        """Resolve the viewer and, for a `workspace` share, refuse anyone who may not see it.

        Every refusal is a 403, not a 401: a 401 makes the SuperTokens fetch interceptor try a
        session refresh the viewer may not have.
        """
        user_id = await resolve_session_user_id(request)
        visibility = snapshot.share.visibility
        project = await db_manager.fetch_project_by_id(str(snapshot.project_id))
        if project is None:
            raise _refuse(
                "share_not_found", "This link does not work.", status.HTTP_404_NOT_FOUND
            )
        workspace_id = str(project.workspace_id)

        if user_id is None:
            if visibility == "workspace":
                raise _refuse(
                    "sign_in_required",
                    "Sign in to open this app.",
                    status.HTTP_403_FORBIDDEN,
                )
            return SharedAppViewer(role="anonymous")

        if visibility == "workspace":
            policy_error = await self._policy_error(
                request, user_id=user_id, organization_id=project.organization_id
            )
            if policy_error:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN, detail=policy_error
                )

        is_member = await db_manager.workspace_member_exists(
            workspace_id=workspace_id, user_id=str(user_id)
        )
        if visibility == "workspace" and not is_member:
            raise _refuse(
                "not_a_member",
                "You do not have access to this app.",
                status.HTTP_403_FORBIDDEN,
            )
        if not is_member:
            return SharedAppViewer(role="anonymous")

        project_id = str(snapshot.project_id)
        in_project = await check_action_access(
            user_uid=str(user_id),
            project_id=project_id,
            permission=Permission.VIEW_MOUNTS,
        )
        can_edit = in_project and await check_action_access(
            user_uid=str(user_id),
            project_id=project_id,
            permission=Permission.EDIT_MOUNTS,
        )
        return SharedAppViewer(
            role="editor" if can_edit else "project_member" if in_project else "member",
            is_owner=snapshot.share.created_by_id == user_id,
            can_open_session=in_project,
            session_id=snapshot.mount.session_id if in_project else None,
            workspace_id=workspace_id if in_project else None,
            project_id=project_id if in_project else None,
            mount_id=str(snapshot.mount.id) if can_edit else None,
            app_path=snapshot.app_path if can_edit else None,
        )

    async def _policy_error(
        self, request: Request, *, user_id: UUID, organization_id
    ) -> Optional[dict]:
        if organization_id is None:
            return None
        try:
            session = await get_session(request, session_required=False)  # type: ignore
            payload = session.get_access_token_payload() if session else {}
            identities = payload.get("session_identities") or []
        except Exception:  # noqa: BLE001 - no readable session means no identities
            identities = []
        return await AuthService().check_organization_access(
            user_id, UUID(str(organization_id)), identities
        )

    async def _author_name(self, snapshot: SharedAppSnapshot) -> Optional[str]:
        try:
            user = await db_manager.get_user_with_id(str(snapshot.share.created_by_id))
        except Exception:  # noqa: BLE001 - a deleted author still leaves a working share
            return None
        return user.username or (user.email or "").split("@", 1)[0] or None

    @intercept_exceptions()
    async def fetch_shared_app(
        self,
        request: Request,
        token: str,
    ):
        throttle = await check_throttle(
            {"ep": "shared_app", "t": hashlib.sha256(token.encode()).hexdigest()[:32]},
            max_capacity=_VIEWS_BURST,
            refill_rate=_VIEWS_PER_MINUTE,
        )
        if not throttle.allow:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "rate_limited",
                    "message": "This link was opened too many times. Try again in a minute.",
                },
                headers={
                    "Retry-After": str(max(1, math.ceil(throttle.retry_after_seconds)))
                },
            )
        try:
            snapshot = await self.app_shares_service.open_shared_app(token=token)
        except AppShareError as e:
            raise _refuse(
                e.code, e.message, _VIEWER_STATUS.get(e.code, status.HTTP_404_NOT_FOUND)
            ) from e

        viewer = await self._viewer(request, snapshot)
        head = SharedAppResponse(
            name=snapshot.manifest.name,
            entry=snapshot.manifest.entry,
            kit=snapshot.manifest.kit,
            visibility=snapshot.share.visibility,
            author_name=await self._author_name(snapshot),
            viewer=viewer,
            refs=snapshot.manifest.refs,
        ).model_dump(mode="json", exclude={"files", "external", "error"})

        return StreamingResponse(
            self._stream(head, snapshot),
            media_type="application/json",
            headers=_RESPONSE_HEADERS,
        )

    async def _stream(
        self, head: dict, snapshot: SharedAppSnapshot
    ) -> AsyncIterator[bytes]:
        # The metadata object without its closing brace, then each section blob by blob. The 200
        # is already sent, so a failed read ends the body with `error` instead of cutting it off.
        yield json.dumps(head, separators=(",", ":"))[:-1].encode()
        failed = False
        for section in ("files", "external"):
            yield f',"{section}":{{'.encode()
            first = True
            try:
                if not failed:
                    async for key, entry, content in self.app_shares_service.iter_blobs(
                        snapshot, section
                    ):
                        item = {
                            "content_type": entry.content_type,
                            "size": len(content),
                            "data": base64.b64encode(content).decode(),
                        }
                        yield (
                            ("" if first else ",")
                            + json.dumps(key)
                            + ":"
                            + json.dumps(item, separators=(",", ":"))
                        ).encode()
                        first = False
            except Exception:  # noqa: BLE001 - reported to the viewer in the body
                log.error(
                    "shared app: a snapshot file could not be read", exc_info=True
                )
                failed = True
            yield b"}"
        if failed:
            error = {
                "code": "storage_unavailable",
                "message": "This app could not be loaded.",
            }
            yield f',"error":{json.dumps(error)}'.encode()
        yield b"}"
