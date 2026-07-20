from functools import wraps
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request, UploadFile, status

from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION

from oss.src.core.mounts.service import MountsService
from oss.src.core.mounts.types import (
    MountArtifactIdInvalid,
    MountArtifactNotFound,
    MountDataInvalid,
    MountFileNotFound,
    MountImmutableField,
    MountNameInvalid,
    MountNotFound,
    MountPathInvalid,
    MountSlugConflict,
    MountSlugReserved,
    MountStorageUnavailable,
)

from oss.src.apis.fastapi.mounts.models import (
    AgentMountQueryRequest,
    MountArchiveRequest,
    MountCreateRequest,
    MountCredentialsResponse,
    MountEditRequest,
    MountFileContentResponse,
    MountFileDeletedResponse,
    MountFileListResponse,
    MountFilePageResponse,
    MountFileWrittenResponse,
    MountFolderCreatedResponse,
    MountQueryRequest,
    MountResponse,
    MountsResponse,
)
from oss.src.apis.fastapi.mounts.utils import (
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
            except MountNotFound as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except MountStorageUnavailable as e:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail=e.message,
                ) from e

        return wrapper

    return decorator


class MountsRouter:
    def __init__(
        self,
        *,
        mounts_service: MountsService,
    ):
        self.mounts_service = mounts_service

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
        # Registered BEFORE "/{mount_id}/archive" so `POST /files/archive` (download-all zip) isn't
        # captured as archiving a mount literally named "files".
        self.router.add_api_route(
            "/files/archive",
            self.archive_mount_files,
            methods=["POST"],
            operation_id="archive_mount_files",
            response_model=None,
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

        # --- File ops (durable store contents) ---
        # Specific sub-paths registered before "/{mount_id}/files" so they win.
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
            status_code=status.HTTP_200_OK,
        )
        # Registered before "/{mount_id}/files" so `/files/page` isn't swallowed by the browse route.
        self.router.add_api_route(
            "/{mount_id}/files/page",
            self.get_mount_files_page,
            methods=["GET"],
            operation_id="get_mount_files_page",
            response_model=MountFilePageResponse,
            response_model_exclude_none=True,
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
            mount_create=body.mount,
        )

        return MountResponse(count=1, mount=mount)

    @intercept_exceptions()
    async def query_mounts(
        self,
        request: Request,
        *,
        body: MountQueryRequest,
        session_id: Optional[str] = Query(default=None),
        include_archived: bool = Query(default=False),
    ) -> MountsResponse:
        await self._check(request, Permission.VIEW_MOUNTS)

        mount_query = merge_mount_query(
            session_id=session_id,
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
        order: Optional[str] = Query(default=None),
        limit: Optional[int] = Query(default=None, ge=0),
        depth: Optional[int] = Query(default=None, ge=1),
        with_counts: bool = Query(default=False),
        git_aware: bool = Query(default=False),
        include_gitignored: bool = Query(default=False),
    ):
        await self._check(request, Permission.VIEW_MOUNTS)

        if read is not None:
            content = await self.mounts_service.read_file(
                project_id=UUID(request.state.project_id),
                mount_id=mount_id,
                path=read,
            )
            return MountFileContentResponse(
                path=content.path,
                content=content.content,
            )

        listing = await self.mounts_service.list_files(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
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
    async def get_mount_files_page(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: Optional[str] = Query(default=None),
        cursor: Optional[str] = Query(default=None),
        limit: int = Query(default=100, ge=1, le=1000),
        git_aware: bool = Query(default=False),
        include_gitignored: bool = Query(default=False),
    ) -> MountFilePageResponse:
        """One cursor page of the flat (recursive, path-sorted) file listing under `path` — the Files
        drawer's infinite-scroll flat view. Never enumerates the whole subtree, so it's fast on any
        mount size; carry `next_cursor` back to fetch the next page."""
        await self._check(request, Permission.VIEW_MOUNTS)

        files, next_cursor = await self.mounts_service.list_files_page(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
            cursor=cursor,
            limit=limit,
            git_aware=git_aware,
            include_gitignored=include_gitignored,
        )
        return MountFilePageResponse(
            count=len(files),
            files=files,
            next_cursor=next_cursor,
        )

    @intercept_exceptions()
    @handle_mount_exceptions()
    async def write_mount_file(
        self,
        request: Request,
        mount_id: UUID,
        *,
        path: str = Query(...),
    ) -> MountFileWrittenResponse:
        await self._check(request, Permission.EDIT_MOUNTS)

        content = await request.body()

        written = await self.mounts_service.write_file(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
            content=content,
        )
        return MountFileWrittenResponse(path=written.path, size=written.size)

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
        return MountFileWrittenResponse(path=written.path, size=written.size)

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
    async def archive_mount_files(
        self,
        request: Request,
        *,
        archive_request: MountArchiveRequest,
    ):
        await self._check(request, Permission.VIEW_MOUNTS)

        return await stream_mounts_archive(
            mounts_service=self.mounts_service,
            project_id=UUID(request.state.project_id),
            mounts=[(m.mount_id, m.prefix, m.path) for m in archive_request.mounts],
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
    ) -> MountFileDeletedResponse:
        await self._check(request, Permission.EDIT_MOUNTS)

        deleted = await self.mounts_service.delete_path(
            project_id=UUID(request.state.project_id),
            mount_id=mount_id,
            path=path,
        )
        return MountFileDeletedResponse(deleted=deleted.deleted, count=deleted.count)
