from uuid import UUID
from typing import List

from fastapi.responses import JSONResponse
from fastapi import APIRouter, Request, status, HTTPException

from oss.src.utils.common import is_ee
from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.caching import get_cache, set_cache, invalidate_cache

from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    UpdateSecretDTO,
    SecretResponseDTO,
)

if is_ee():
    from ee.src.models.shared_models import Permission
    from ee.src.utils.permissions import check_action_access


log = get_module_logger(__name__)


class VaultRouter:
    def __init__(self, vault_service: VaultService):
        self.service = vault_service

        self.router = APIRouter()

        self.router.add_api_route(
            "/secrets/",
            self.create_secret,
            methods=["POST"],
            operation_id="create_secret",
            response_model_exclude_none=True,
            response_model=SecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/",
            self.list_secrets,
            methods=["GET"],
            operation_id="list_secrets",
            response_model_exclude_none=True,
            response_model=List[SecretResponseDTO],
        )
        self.router.add_api_route(
            "/secrets/{secret_id}",
            self.read_secret,
            methods=["GET"],
            operation_id="read_secret",
            response_model_exclude_none=True,
            response_model=SecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}",
            self.update_secret,
            methods=["PUT"],
            operation_id="update_secret",
            response_model_exclude_none=True,
            response_model=SecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}",
            self.delete_secret,
            status_code=status.HTTP_204_NO_CONTENT,
            methods=["DELETE"],
            operation_id="delete_secret",
        )

    @intercept_exceptions()
    async def create_secret(self, request: Request, body: CreateSecretDTO):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_SECRET,
            )

            if not has_permission:
                error_msg = "You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        vault_secret = await self.service.create_secret(
            project_id=UUID(request.state.project_id),
            create_secret_dto=body,
        )
        await invalidate_cache(
            project_id=request.state.project_id,
        )
        return vault_secret

    @intercept_exceptions()
    async def list_secrets(self, request: Request):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_SECRET,
            )

            if not has_permission:
                error_msg = "You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        cache_key = {}

        secrets_dtos = await get_cache(
            project_id=request.state.project_id,
            namespace="list_secrets",
            key=cache_key,
            model=SecretResponseDTO,
            is_list=True,
        )

        if secrets_dtos is not None:
            return secrets_dtos

        secrets_dtos = await self.service.list_secrets(
            project_id=UUID(request.state.project_id),
        )

        await set_cache(
            project_id=request.state.project_id,
            namespace="list_secrets",
            key=cache_key,
            value=secrets_dtos,
        )

        return secrets_dtos

    @intercept_exceptions()
    async def read_secret(self, request: Request, secret_id: str):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.VIEW_SECRET,
            )

            if not has_permission:
                error_msg = "You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        secrets_dto = await self.service.get_secret(
            project_id=UUID(request.state.project_id),
            secret_id=UUID(secret_id),
        )
        if secrets_dto is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
            )
        return secrets_dto

    @intercept_exceptions()
    async def update_secret(
        self, request: Request, secret_id: str, body: UpdateSecretDTO
    ):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_SECRET,
            )

            if not has_permission:
                error_msg = "You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        secrets_dto = await self.service.update_secret(
            project_id=UUID(request.state.project_id),
            secret_id=UUID(secret_id),
            update_secret_dto=body,
        )
        if secrets_dto is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
            )
        await invalidate_cache(
            project_id=request.state.project_id,
        )
        return secrets_dto

    @intercept_exceptions()
    async def delete_secret(self, request: Request, secret_id: str):
        if is_ee():
            has_permission = await check_action_access(
                user_uid=str(request.state.user_id),
                project_id=str(request.state.project_id),
                permission=Permission.EDIT_SECRET,
            )

            if not has_permission:
                error_msg = "You do not have access to perform this action. Please contact your organization admin."
                return JSONResponse(
                    {"detail": error_msg},
                    status_code=403,
                )

        await self.service.delete_secret(
            project_id=UUID(request.state.project_id),
            secret_id=UUID(secret_id),
        )
        await invalidate_cache(
            project_id=request.state.project_id,
        )
        return status.HTTP_204_NO_CONTENT
