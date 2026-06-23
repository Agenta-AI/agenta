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
from oss.src.core.secrets.connections import (
    AmbiguousConnection,
    ConnectionNotFound,
    ConnectionResolutionError,
    ProviderMismatch,
    UnsupportedConnectionMode,
    UnsupportedDeployment,
    UnsupportedProvider,
)
from oss.src.apis.fastapi.vault.models import (
    ConnectionsListResponse,
    ResolveConnectionRequest,
    ResolvedConnectionResponse,
)

if is_ee():
    from ee.src.core.access.permissions.types import Permission
    from ee.src.core.access.permissions.service import check_action_access


log = get_module_logger(__name__)


class VaultRouter:
    def __init__(
        self,
        vault_service: VaultService,
    ):
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
        # The router is mounted at root (so `/secrets/` serves at `/api/secrets/`), so these
        # carry their own `/vault/connections` prefix to serve at `/api/vault/connections...`
        # (the path the SDK `VaultConnectionResolver` and the design name).
        self.router.add_api_route(
            "/vault/connections",
            self.list_connections,
            methods=["GET"],
            operation_id="list_connections",
            response_model_exclude_none=True,
            response_model=ConnectionsListResponse,
        )
        # INTERNAL-ONLY. Unlike the routes above, this returns PLAINTEXT credentials in `env`
        # (the whole point of an internal resolve). It must stay server-side / internal-service
        # plumbing and must NOT be added to any browser-callable Fern client (design Security
        # rule 3). The auth middleware (request.state) plus the least-privilege single-connection
        # return and the not-mounted-in-the-browser-client contract are the v1 guard.
        self.router.add_api_route(
            "/vault/connections/resolve",
            self.resolve_connection,
            methods=["POST"],
            operation_id="resolve_connection",
            response_model_exclude_none=True,
            response_model=ResolvedConnectionResponse,
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
            user_id=UUID(request.state.user_id),
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

    @intercept_exceptions()
    async def list_connections(self, request: Request):
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

        connections = await self.service.list_connections(
            project_id=UUID(request.state.project_id),
        )
        return ConnectionsListResponse(
            count=len(connections),
            connections=connections,
        )

    @intercept_exceptions()
    async def resolve_connection(
        self, request: Request, body: ResolveConnectionRequest
    ):
        # INTERNAL-ONLY: returns plaintext credentials in `env`. Keep server-side; never expose
        # via a browser client (design Security rule 3).
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

        # Project comes from request context, never the body (design Security rule 1).
        project_id = UUID(request.state.project_id)
        model = body.model

        try:
            resolved = await self.service.resolve_connection(
                project_id=project_id,
                model_provider=model.provider,
                model_id=model.model,
                connection_mode=model.connection.mode,
                connection_slug=model.connection.slug,
                harness=body.harness,
                backend=body.backend,
            )
        except ConnectionNotFound as e:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(e)
            ) from e
        except (
            UnsupportedProvider,
            UnsupportedConnectionMode,
            UnsupportedDeployment,
        ) as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e)
            ) from e
        except (AmbiguousConnection, ProviderMismatch, ConnectionResolutionError) as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)
            ) from e

        # Audit (design Security rule 7): provider, model, slug, credential mode, user, project.
        # NEVER the key material.
        log.info(
            "agent connection resolved",
            provider=resolved.provider,
            model=resolved.model,
            deployment=resolved.deployment,
            connection_slug=model.connection.slug,
            connection_mode=model.connection.mode,
            credential_mode=resolved.credential_mode,
            user_id=str(getattr(request.state, "user_id", None)),
            project_id=str(project_id),
        )

        return ResolvedConnectionResponse(
            provider=resolved.provider,
            model=resolved.model,
            deployment=resolved.deployment,
            credential_mode=resolved.credential_mode,
            env=resolved.env,
            endpoint=resolved.endpoint,
        )
