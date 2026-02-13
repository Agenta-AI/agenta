from functools import wraps
from uuid import UUID

from fastapi import APIRouter, Request, HTTPException, status

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions, suppress_exceptions

from oss.src.apis.fastapi.folders.models import (
    FolderCreateRequest,
    FolderEditRequest,
    FolderQueryRequest,
    FolderResponse,
    FoldersResponse,
    FolderIdResponse,
    FolderNameInvalidException,
    FolderPathConflictException,
    FolderParentMissingException,
    FolderPathDepthExceededException,
    FolderPathLengthExceededException,
)

from oss.src.core.folders.service import FoldersService
from oss.src.core.folders.types import (
    FolderNameInvalid,
    FolderPathConflict,
    FolderParentMissing,
    FolderPathDepthExceeded,
    FolderPathLengthExceeded,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access, FORBIDDEN_EXCEPTION


log = get_module_logger(__name__)


def handle_folder_exceptions():
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except FolderNameInvalid as e:
                raise FolderNameInvalidException(
                    message=e.message,
                ) from e
            except FolderPathConflict as e:
                raise FolderPathConflictException(
                    message=e.message,
                ) from e
            except FolderParentMissing as e:
                raise FolderParentMissingException(
                    message=e.message,
                ) from e
            except FolderPathDepthExceeded as e:
                raise FolderPathDepthExceededException(
                    message=e.message,
                ) from e
            except FolderPathLengthExceeded as e:
                raise FolderPathLengthExceededException(
                    message=e.message,
                ) from e
            except Exception as e:
                raise e

        return wrapper

    return decorator


class FoldersRouter:
    def __init__(
        self,
        folders_service: FoldersService,
    ):
        self.folders_service = folders_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/",
            self.create_folder,
            methods=["POST"],
            operation_id="create_folder",
            status_code=status.HTTP_200_OK,
            response_model=FolderResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{folder_id}",
            self.fetch_folder,
            methods=["GET"],
            operation_id="fetch_folder",
            status_code=status.HTTP_200_OK,
            response_model=FolderResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{folder_id}",
            self.edit_folder,
            methods=["PUT"],
            operation_id="edit_folder",
            status_code=status.HTTP_200_OK,
            response_model=FolderResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/{folder_id}",
            self.delete_folder,
            methods=["DELETE"],
            operation_id="delete_folder",
            status_code=status.HTTP_200_OK,
            response_model=FolderIdResponse,
            response_model_exclude_none=True,
        )

        self.router.add_api_route(
            "/query",
            self.query_folders,
            methods=["POST"],
            operation_id="query_folders",
            status_code=status.HTTP_200_OK,
            response_model=FoldersResponse,
            response_model_exclude_none=True,
        )

    # POST /folders/
    @intercept_exceptions()
    @handle_folder_exceptions()
    async def create_folder(
        self,
        *,
        request: Request,
        #
        folder_create_request: FolderCreateRequest,
    ) -> FolderResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_FOLDERS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        folder = await self.folders_service.create(
            project_id=UUID(str(request.state.project_id)),
            user_id=UUID(str(request.state.user_id)),
            #
            folder_create=folder_create_request.folder,
        )

        return FolderResponse(
            count=folder is not None and 1 or 0,
            folder=folder,
        )

    # GET /folders/{folder_id}
    @intercept_exceptions()
    @suppress_exceptions(default=FolderResponse(), exclude=[HTTPException])
    async def fetch_folder(
        self,
        *,
        request: Request,
        #
        folder_id: UUID,
    ) -> FolderResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_FOLDERS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        folder = await self.folders_service.fetch(
            project_id=UUID(str(request.state.project_id)),
            #
            folder_id=folder_id,
        )

        return FolderResponse(
            count=folder is not None and 1 or 0,
            folder=folder,
        )

    # PUT /folders/{folder_id}
    @intercept_exceptions()
    @handle_folder_exceptions()
    async def edit_folder(
        self,
        *,
        request: Request,
        #
        folder_id: UUID,
        folder_edit_request: FolderEditRequest,
    ) -> FolderResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_FOLDERS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        if folder_id != folder_edit_request.folder.id:
            raise HTTPException(
                status_code=400,
                detail="folder ID in path does not match folder ID in payload",
            )

        folder = await self.folders_service.edit(
            project_id=UUID(str(request.state.project_id)),
            user_id=UUID(str(request.state.user_id)),
            #
            folder_edit=folder_edit_request.folder,
        )

        return FolderResponse(
            count=folder is not None and 1 or 0,
            folder=folder,
        )

    # DELETE /folders/{folder_id}
    @intercept_exceptions()
    async def delete_folder(
        self,
        *,
        request: Request,
        #
        folder_id: UUID,
    ) -> FolderIdResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.EDIT_FOLDERS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        _folder_id = await self.folders_service.delete(
            project_id=UUID(str(request.state.project_id)),
            user_id=UUID(str(request.state.user_id)),
            #
            folder_id=folder_id,
        )

        return FolderIdResponse(
            count=_folder_id is not None and 1 or 0,
            id=_folder_id if _folder_id is not None else None,
        )

    # POST /folders/query
    @intercept_exceptions()
    @suppress_exceptions(default=FoldersResponse(), exclude=[HTTPException])
    async def query_folders(
        self,
        *,
        request: Request,
        #
        folder_query_request: FolderQueryRequest,
    ) -> FoldersResponse:
        if is_ee():
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=Permission.VIEW_FOLDERS,  # type: ignore
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

        folders = await self.folders_service.query(
            project_id=UUID(str(request.state.project_id)),
            #
            folder_query=folder_query_request.folder,
        )

        return FoldersResponse(count=len(folders), folders=folders)
