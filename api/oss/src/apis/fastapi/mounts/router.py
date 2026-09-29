from functools import wraps
from typing import Literal, Optional
from uuid import UUID

from fastapi import (
    APIRouter,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse

from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

from oss.src.core.apps.scope_token import (
    ScopeDenied,
    ScopeTokenInvalid,
    enforce as enforce_app_scope,
    mint as mint_app_scope,
)
from oss.src.core.apps.sharing import AppShareError, AppSharesService
from oss.src.core.mounts.dtos import AppShare, MountArchiveSource, MountCreate
from oss.src.core.mounts.service import MountsService
from oss.src.middlewares.auth import is_interactive_session
from oss.src.core.store.types import StoreDeleteFailed
from oss.src.core.mounts.types import (
    MountArchived,
    MountArtifactIdInvalid,
    MountArtifactNotFound,
    MountDataInvalid,
    MountFileNotFound,
    MountImmutableField,
    MountNameInvalid,
    MountNotFound,
    MountProtected,
    MountPathInvalid,
    MountPreconditionFailed,
    MountSlugConflict,
    MountSlugReserved,
    MountStorageUnavailable,
)

from oss.src.apis.fastapi.mounts.models import (
    AgentMountQueryRequest,
    AppShareEditRequest,
    AppShareIssue,
    AppSharePublishRequest,
    AppShareResponse,
    AppShareState,
    AppScopeRequest,
    AppScopeResponse,
    MountArchiveRequest,
    MountCreateRequest,
    MountCredentialsResponse,
    MountEditRequest,
    MountFileContentResponse,
    MountFileDeletedResponse,
    MountFileListResponse,
    MountFileWrittenResponse,
    MountFolderCreatedResponse,
    MountQueryRequest,
    MountResponse,
    MountsResponse,
)
from oss.src.apis.fastapi.mounts.utils import (
    BINARY_RESPONSE,
    ZIP_RESPONSE,
    download_mount_file,
    merge_mount_query,
    sign_mount_credentials,
    stream_mounts_archive,
    upload_mount_file,
)


def handle_mount_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except ScopeTokenInvalid as e:
                # The token is unusable, not the request: the page mints a new one and retries.
                # 403, not 401: a 401 makes the SuperTokens interceptor refresh the session.
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"code": "scope_token_invalid", "message": str(e)},
                ) from e
            except ScopeDenied as e:
                # A scope token only ever narrows, so a failure here is the caller asking for
                # more than the app was granted — forbidden, not malformed.
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"code": "scope", "message": str(e)},
                ) from e
            except MountArchived as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"code": "archived", "message": e.message},
                ) from e
            except MountDataInvalid as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except MountPathInvalid as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except MountNameInvalid as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except MountArtifactIdInvalid as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except MountArtifactNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except MountSlugConflict as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                ) from e
            except MountSlugReserved as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except MountImmutableField as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=e.message,
                ) from e
            except MountFileNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except MountProtected as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=MountNotFound().message,
                ) from e
            except MountNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except MountPreconditionFailed as e:
                raise HTTPException(
                    status_code=status.HTTP_412_PRECONDITION_FAILED,
                    detail={"code": "conflict", "etag": e.etag},
                ) from e
            except MountStorageUnavailable as e:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=e.message,
                ) from e
            except StoreDeleteFailed as e:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Some files could not be deleted. Try again.",
                ) from e

        return wrapper

    return decorator


_APP_SHARE_STATUS = {
    "not_found": status.HTTP_404_NOT_FOUND,
    "share_not_found": status.HTTP_404_NOT_FOUND,
    "share_unavailable": status.HTTP_404_NOT_FOUND,
    "not_shareable": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "not_an_app": status.HTTP_422_UNPROCESSABLE_ENTITY,
    "session_archived": status.HTTP_409_CONFLICT,
    "too_large": status.HTTP_413_CONTENT_TOO_LARGE,
    "sharing_disabled": status.HTTP_503_SERVICE_UNAVAILABLE,
    "storage_unavailable": status.HTTP_503_SERVICE_UNAVAILABLE,
}


def handle_app_share_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except AppShareError as e:
                raise HTTPException(
                    status_code=_APP_SHARE_STATUS.get(
                        e.code, status.HTTP_400_BAD_REQUEST
                    ),
                    detail={"code": e.code, "message": e.message, "details": e.details},
                ) from e

        return wrapper

    return decorator


def share_state(
    share: Optional[AppShare], *, token: Optional[str] = None
) -> Optional[AppShareState]:
    if share is None:
        return None
    return AppShareState(
        enabled=share.enabled,
        visibility=share.visibility,
        created_at=share.created_at,
        updated_at=share.updated_at,
        token=token if share.enabled else None,
    )


def _if_none_match_any(value: Optional[str]) -> bool:
    """Only `If-None-Match: *` (create-only) is supported; an etag list is rejected."""
    if value is None:
        return False
    if value.strip() == "*":
        return True
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="If-None-Match only supports '*' on this endpoint.",
    )


class MountsRouter:
    def __init__(
        self,
        *,
        mounts_service: MountsService,
        app_shares_service: Optional[AppSharesService] = None,
    ):
        self.mounts_service = mounts_service
        self.app_shares_service = app_shares_service

        # Main mounts surface: /mounts/...
        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_mount,
            methods=["POST"],
            operation_id="create_mount",
            response_model=MountResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/query",
            self.query_mounts,
            methods=["POST"],
            operation_id="query_mounts",
            response_model=MountsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        # Fixed agent sub-paths must be registered before "/{mount_id}" so they win.
        self.router.add_api_route(
            "/agents/sign",
            self.sign_agent_mount_credentials,
            methods=["POST"],
            operation_id="sign_agent_mount_credentials",
            response_model=MountCredentialsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/agents/query",
            self.query_agent_mount,
            methods=["POST"],
            operation_id="query_agent_mount",
            response_model=MountsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}",
            self.fetch_mount,
            methods=["GET"],
            operation_id="fetch_mount",
            response_model=MountResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}",
            self.edit_mount,
            methods=["PUT"],
            operation_id="edit_mount",
            response_model=MountResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/sign",
            self.sign_mount_credentials,
            methods=["POST"],
            operation_id="sign_mount_credentials",
            response_model=MountCredentialsResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        # Registered before the "/{mount_id}/..." routes so this literal path isn't captured as an
        # operation on a mount named "files".
        self.router.add_api_route(
            "/files/export",
            self.export_mount_files,
            methods=["POST"],
            operation_id="export_mount_files",
            response_model=None,
            response_class=StreamingResponse,
            responses=ZIP_RESPONSE,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/archive",
            self.archive_mount,
            methods=["POST"],
            operation_id="archive_mount",
            response_model=MountResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/unarchive",
            self.unarchive_mount,
            methods=["POST"],
            operation_id="unarchive_mount",
            response_model=MountResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

        # --- App sharing ---
        self.router.add_api_route(
            "/{mount_id}/apps/share",
            self.fetch_app_share,
            methods=["GET"],
            operation_id="fetch_app_share",
            response_model=AppShareResponse,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/apps/share/publish",
            self.publish_app_share,
            methods=["POST"],
            operation_id="publish_app_share",
            response_model=AppShareResponse,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/apps/share",
            self.edit_app_share,
            methods=["PATCH"],
            operation_id="edit_app_share",
            response_model=AppShareResponse,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/apps/share",
            self.stop_app_share,
            methods=["DELETE"],
            operation_id="stop_app_share",
            response_model=AppShareResponse,
            status_code=status.HTTP_200_OK,
        )

        # --- File ops (durable store contents) ---
        # Specific sub-paths registered before "/{mount_id}/files" so they win.
        self.router.add_api_route(
            "/{mount_id}/apps/scope",
            self.mint_app_scope_token,
            methods=["POST"],
            operation_id="mint_app_scope_token",
            response_model=AppScopeResponse,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/files/folder",
            self.create_folder,
            methods=["POST"],
            operation_id="create_mount_folder",
            response_model=MountFolderCreatedResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/files/upload",
            self.upload_mount_file,
            methods=["POST"],
            operation_id="upload_mount_file",
            response_model=MountFileWrittenResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/files/download",
            self.download_mount_file,
            methods=["GET"],
            operation_id="download_mount_file",
            response_model=None,
            response_class=Response,
            responses=BINARY_RESPONSE,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/files",
            self.get_mount_files,
            methods=["GET"],
            operation_id="get_mount_files",
            response_model=None,
            status_code=status.HTTP_200_OK,
        )
        self.router.add_api_route(
            "/{mount_id}/files",
            self.write_mount_file,
            methods=["PUT"],
            operation_id="write_mount_file",
            response_model=MountFileWrittenResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
            # The handler reads the raw body with `await request.body()`, which FastAPI cannot
            # see, so the generated spec described a PUT with NO body — and the generated client
            # duly sent none. Declaring it here is documentation only: the runtime read is
            # unchanged, and the generated client gains the parameter it was missing. Without
            # this, every caller has to hand-roll the write, which is how the bridge ended up
            # on axios against the repo's own Fern rule.
            openapi_extra={
                "requestBody": {
                    "required": True,
                    "content": {
                        "application/octet-stream": {
                            "schema": {"type": "string", "format": "binary"}
                        },
                    },
                }
            },
        )
        self.router.add_api_route(
            "/{mount_id}/files",
            self.delete_mount_file,
            methods=["DELETE"],
            operation_id="delete_mount_file",
            response_model=MountFileDeletedResponse,
            response_model_exclude_none=True,
            status_code=status.HTTP_200_OK,
        )

    async def _check(self, request: Request, permission: Permission) -> None:
        has_permission = await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=permission,
        )
        if not has_permission:
            raise FORBIDDEN_EXCEPTION

    # -----------------------------------------------------------------------
    # App sharing
    # -----------------------------------------------------------------------

    def _shares(self) -> AppSharesService:
        if self.app_shares_service is None:
            raise AppShareError("storage_unavailable", "App sharing is not configured.")
        return self.app_shares_service

    async def _check_share_editor(self, request: Request) -> None:
        """A person in the browser with EDIT_MOUNTS. The agent holds EDIT_MOUNTS too, but never
        an interactive session, so this is what keeps it from publishing."""
        await self._check(request, Permission.EDIT_MOUNTS)
        if not await is_interactive_session(request):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "interactive_session_required",
                    "message": "Only a person signed in to Agenta can share an app.",
                },
            )

    async def _may_edit_shares(self, request: Request) -> bool:
        return await check_action_access(
            user_uid=str(request.state.user_id),
            project_id=str(request.state.project_id),
            permission=Permission.EDIT_MOUNTS,
        ) and await is_interactive_session(request)

    @intercept_exceptions()
    @handle_app_share_exceptions()
    @handle_mount_exceptions()
    async def fetch_app_share(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
    ) -> AppShareResponse:
        await self._check(request, Permission.VIEW_MOUNTS)
        project_id = UUID(request.state.project_id)
        shares = self._shares()
        share = await shares.fetch_share(
            project_id=project_id, mount_id=mount_id, path=path
        )
        token = None
        if share is not None and share.enabled and await self._may_edit_shares(request):
            token = shares.link_token(
                project_id=project_id, mount_id=mount_id, path=path, share=share
            )
        return AppShareResponse(
            count=0 if share is None else 1, share=share_state(share, token=token)
        )

    @intercept_exceptions()
    @handle_app_share_exceptions()
    @handle_mount_exceptions()
    async def publish_app_share(
        self,
        request: Request,
        mount_id: UUID,
        *,
        body: AppSharePublishRequest,
    ) -> AppShareResponse:
        await self._check_share_editor(request)
        result = await self._shares().publish(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            mount_id=mount_id,
            path=body.path,
            visibility=body.visibility,
        )
        return AppShareResponse(
            count=1,
            share=share_state(result.share, token=result.token),
            external_failed=[
                AppShareIssue(**item.model_dump()) for item in result.external_failed
            ],
            warnings=[AppShareIssue(**item.model_dump()) for item in result.warnings],
        )

    @intercept_exceptions()
    @handle_app_share_exceptions()
    @handle_mount_exceptions()
    async def edit_app_share(
        self,
        request: Request,
        mount_id: UUID,
        *,
        body: AppShareEditRequest,
    ) -> AppShareResponse:
        await self._check_share_editor(request)
        project_id = UUID(request.state.project_id)
        shares = self._shares()
        share = await shares.edit(
            project_id=project_id,
            mount_id=mount_id,
            path=body.path,
            visibility=body.visibility,
        )
        token = shares.link_token(
            project_id=project_id, mount_id=mount_id, path=body.path, share=share
        )
        return AppShareResponse(count=1, share=share_state(share, token=token))

    @intercept_exceptions()
    @handle_app_share_exceptions()
    @handle_mount_exceptions()
    async def stop_app_share(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
    ) -> AppShareResponse:
        await self._check_share_editor(request)
        share = await self._shares().stop(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
        )
        return AppShareResponse(
            count=0 if share is None else 1, share=share_state(share)
        )

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def create_mount(
        self,
        request: Request,
        *,
        body: MountCreateRequest,
    ) -> MountResponse:
        await self._check(request, Permission.EDIT_MOUNTS)

        mount = await self.mounts_service.create_mount(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            mount_create=MountCreate(**body.mount.model_dump()),
        )

        return MountResponse(count=1, mount=mount)

    @intercept_exceptions()
    async def query_mounts(
        self,
        request: Request,
        *,
        body: MountQueryRequest,
        session_id: Optional[str] = Query(default=None),
        agent_id: Optional[str] = Query(default=None),
        include_archived: bool = Query(default=False),
    ) -> MountsResponse:
        await self._check(request, Permission.VIEW_MOUNTS)

        mount_query = merge_mount_query(
            session_id=session_id,
            agent_id=agent_id,
            include_archived=include_archived,
            body_query=body.mount,
        )

        mounts = await self.mounts_service.query_mounts(
            project_id=UUID(request.state.project_id),
            mount_query=mount_query,
            windowing=body.windowing,
        )

        return MountsResponse(count=len(mounts), mounts=mounts)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def sign_agent_mount_credentials(
        self,
        request: Request,
        *,
        artifact_id: str = Query(...),
        name: str = Query(default="default"),
    ) -> MountCredentialsResponse:
        await self._check(request, Permission.USE_MOUNTS)

        mount = await self.mounts_service.get_or_create_agent_mount(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            artifact_id=artifact_id,
            name=name,
        )
        credentials = await sign_mount_credentials(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount.id,
        )
        return MountCredentialsResponse(count=1, mount=mount, credentials=credentials)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def query_agent_mount(
        self,
        request: Request,
        *,
        body: AgentMountQueryRequest,
    ) -> MountsResponse:
        await self._check(request, Permission.VIEW_MOUNTS)

        mount = await self.mounts_service.fetch_agent_mount(
            project_id=UUID(request.state.project_id),
            artifact_id=body.artifact_id,
            name=body.name,
        )
        mounts = [mount] if mount else []
        return MountsResponse(count=len(mounts), mounts=mounts)

    @intercept_exceptions()
    async def fetch_mount(
        self,
        request: Request,
        mount_id: UUID,
    ) -> MountResponse:
        await self._check(request, Permission.VIEW_MOUNTS)

        mount = await self.mounts_service.fetch_mount(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
        )
        if not mount:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Mount not found.",
            )

        return MountResponse(count=1, mount=mount)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def edit_mount(
        self,
        request: Request,
        mount_id: UUID,
        *,
        body: MountEditRequest,
    ) -> MountResponse:
        await self._check(request, Permission.EDIT_MOUNTS)

        if str(mount_id) != str(body.mount.id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path mount_id does not match body id.",
            )

        mount = await self.mounts_service.edit_mount(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            mount_edit=body.mount,
        )

        return MountResponse(count=1, mount=mount)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def archive_mount(
        self,
        request: Request,
        mount_id: UUID,
    ) -> MountResponse:
        await self._check(request, Permission.EDIT_MOUNTS)

        mount = await self.mounts_service.archive_mount(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            mount_id=mount_id,
        )
        if not mount:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Mount not found.",
            )

        return MountResponse(count=1, mount=mount)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def unarchive_mount(
        self,
        request: Request,
        mount_id: UUID,
    ) -> MountResponse:
        await self._check(request, Permission.EDIT_MOUNTS)

        mount = await self.mounts_service.unarchive_mount(
            project_id=UUID(request.state.project_id),
            user_id=UUID(str(request.state.user_id)),
            #
            mount_id=mount_id,
        )
        if not mount:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Mount not found.",
            )

        return MountResponse(count=1, mount=mount)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def sign_mount_credentials(
        self,
        request: Request,
        mount_id: UUID,
    ) -> MountCredentialsResponse:
        await self._check(request, Permission.USE_MOUNTS)

        mount = await self.mounts_service.fetch_mount(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
        )
        if not mount:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Mount not found.",
            )

        credentials = await sign_mount_credentials(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
        )
        return MountCredentialsResponse(count=1, mount=mount, credentials=credentials)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def mint_app_scope_token(
        self,
        request: Request,
        mount_id: UUID,
        *,
        scope: AppScopeRequest,
    ) -> AppScopeResponse:
        """Issue a folder-scoped token for a running HTML app.

        The browser asks for one when the person grants an app access, then attaches it to every
        bridge call so the server can refuse a path outside the folder. It only ever narrows what
        the caller already has, so minting is gated on the level being asked for: read-write needs
        EDIT_MOUNTS, exactly as the write itself does.
        """
        await self._check(request, Permission.VIEW_MOUNTS)
        if scope.level == "read-write":
            await self._check(request, Permission.EDIT_MOUNTS)

        # Confirms the mount is in this project before signing anything about it.
        await self._resolve_mount_for_scope(
            request=request, mount_id=mount_id, level=scope.level
        )

        token, expires_at = mint_app_scope(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            prefix=scope.dir,
            level=scope.level,
        )
        return AppScopeResponse(
            token=token,
            expires_at=expires_at,
            dir=scope.dir.strip("/"),
            level=scope.level,
        )

    async def _resolve_mount_for_scope(
        self, *, request: Request, mount_id: UUID, level: str
    ) -> None:
        mount = await self.mounts_service.fetch_mount(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
        )
        if not mount:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Mount not found.",
            )
        if level == "read-write" and mount.deleted_at is not None:
            raise MountArchived()

    # -----------------------------------------------------------------------
    # File ops (durable store contents)
    # -----------------------------------------------------------------------

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def get_mount_files(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: Optional[str] = Query(default=None),
        read: Optional[str] = Query(default=None),
        order: Optional[Literal["recent", "name", "path"]] = Query(default=None),
        limit: Optional[int] = Query(default=None, ge=0),
        # Only depth==1 is implemented (the shallow one-level summary); reject other values loudly
        # instead of silently falling through to the most expensive full-tree branch.
        depth: Optional[int] = Query(default=None, ge=1, le=1),
        with_counts: bool = Query(default=False),
        git_aware: bool = Query(default=False),
        include_gitignored: bool = Query(default=False),
        x_agenta_app_scope: Optional[str] = Header(default=None),
    ):
        await self._check(request, Permission.VIEW_MOUNTS)
        # The scope decides the path, not the query: a scoped caller that named none gets its own
        # folder, so a pathless listing cannot walk out of the app's scope.
        scoped_path = enforce_app_scope(
            token=x_agenta_app_scope,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=read if read is not None else path,
            writing=False,
        )

        if read is not None:
            content = await self.mounts_service.read_file(
                project_id=UUID(request.state.project_id),
                mount_id=mount_id,
                path=read,
            )
            return MountFileContentResponse(
                path=content.path,
                content=content.content,
                etag=content.etag,
            )

        listing = await self.mounts_service.list_files(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=scoped_path,
            order=order,
            limit=limit,
            depth=depth,
            with_counts=with_counts,
            git_aware=git_aware,
            include_gitignored=include_gitignored,
        )
        return MountFileListResponse(
            count=len(listing.files),
            total=listing.total,
            total_capped=listing.total_capped,
            files=listing.files,
        )

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def write_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
        if_match: Optional[str] = Header(default=None),
        if_none_match: Optional[str] = Header(default=None),
        x_agenta_app_scope: Optional[str] = Header(default=None),
    ) -> MountFileWrittenResponse:
        await self._check(request, Permission.EDIT_MOUNTS)
        enforce_app_scope(
            token=x_agenta_app_scope,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
            writing=True,
        )

        if_none_match_any = _if_none_match_any(if_none_match)
        content = await request.body()

        written = await self.mounts_service.write_file(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
            content=content,
            if_match=if_match,
            if_none_match_any=if_none_match_any,
        )
        return MountFileWrittenResponse(
            path=written.path, size=written.size, etag=written.etag
        )

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def create_folder(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
    ) -> MountFolderCreatedResponse:
        await self._check(request, Permission.EDIT_MOUNTS)

        created = await self.mounts_service.create_folder(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
        )
        return MountFolderCreatedResponse(path=created.path)

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def upload_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        file: UploadFile,
        path: Optional[str] = Query(default=None),
    ) -> MountFileWrittenResponse:
        await self._check(request, Permission.EDIT_MOUNTS)

        written = await upload_mount_file(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            file=file,
            path=path,
        )
        return MountFileWrittenResponse(
            path=written.path, size=written.size, etag=written.etag
        )

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def download_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
    ):
        await self._check(request, Permission.VIEW_MOUNTS)

        return await download_mount_file(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
        )

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def export_mount_files(
        self,
        request: Request,
        *,
        archive_request: MountArchiveRequest,
    ):
        await self._check(request, Permission.VIEW_MOUNTS)

        return await stream_mounts_archive(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mounts=[
                MountArchiveSource(
                    mount_id=m.mount_id,
                    archive_prefix=m.prefix,
                    source_path=m.path,
                )
                for m in archive_request.mounts
            ],
            filename=archive_request.filename,
        )

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def delete_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
        if_match: Optional[str] = Header(default=None),
        x_agenta_app_scope: Optional[str] = Header(default=None),
    ) -> MountFileDeletedResponse:
        await self._check(request, Permission.EDIT_MOUNTS)
        enforce_app_scope(
            token=x_agenta_app_scope,
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
            writing=True,
        )

        deleted = await self.mounts_service.delete_path(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
            if_match=if_match,
        )
        return MountFileDeletedResponse(deleted=deleted.deleted, count=deleted.count)
