from uuid import UUID
from typing import List

from fastapi.responses import JSONResponse
from fastapi import APIRouter, Request, status, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from oss.src.utils.logging import get_module_logger
from oss.src.utils.exceptions import intercept_exceptions

from oss.src.core.secrets.services import VaultService
from oss.src.core.secrets.dtos import (
    CreateSecretDTO,
    SecretValueRequiredError,
    UpdateSecretDTO,
    SecretResponseDTO,
    PublicSecretResponseDTO,
)
from oss.src.core.secrets.managed import ManagedSecretReadOnlyError
from oss.src.core.secrets.redaction import project_secret_response

from oss.src.core.access.permissions.types import Permission
from oss.src.core.access.permissions.service import check_action_access

from oss.src.middlewares.auth import SECRET_RESOLVE_GRANT, request_has_grant


log = get_module_logger(__name__)


class SecretSafeRoute(APIRoute):
    """A route whose validation errors never echo what the caller sent.

    FastAPI's validation error carries an ``input`` field holding the offending value, so a
    malformed create put the submitted provider key straight back into the response body,
    into the caller's terminal, and into anything logging response bodies on this route. A
    builder hit it live with a real OpenAI key.

    Scoped by construction rather than by matching the request path: every route on this
    router gets it, and a later path change cannot silently switch it off. Validation
    behavior is unchanged, only the echo: the caller still learns which field was wrong and
    why, which is everything it needs, since it already knows what it sent.
    """

    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                return await original(request)
            except RequestValidationError as e:
                raise RequestValidationError(
                    [
                        {key: value for key, value in error.items() if key != "input"}
                        for error in e.errors()
                    ]
                ) from None

        return handler


class VaultRouter:
    def __init__(
        self,
        vault_service: VaultService,
    ):
        self.service = vault_service

        self.router = APIRouter(route_class=SecretSafeRoute)

        self.router.add_api_route(
            "/secrets/",
            self.create_secret,
            methods=["POST"],
            operation_id="create_secret",
            response_model_exclude_none=True,
            response_model=PublicSecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/",
            self.list_secrets,
            methods=["GET"],
            operation_id="list_secrets",
            response_model_exclude_none=True,
            response_model=List[PublicSecretResponseDTO],
        )
        self.router.add_api_route(
            "/secrets/{secret_id_or_slug}",
            self.read_secret,
            methods=["GET"],
            operation_id="read_secret",
            response_model_exclude_none=True,
            response_model=PublicSecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}",
            self.update_secret,
            methods=["PUT"],
            operation_id="update_secret",
            response_model_exclude_none=True,
            response_model=PublicSecretResponseDTO,
        )
        self.router.add_api_route(
            "/secrets/{secret_id}",
            self.delete_secret,
            status_code=status.HTTP_204_NO_CONTENT,
            methods=["DELETE"],
            operation_id="delete_secret",
        )

    @staticmethod
    def _for_caller(
        request: Request, secret_dto: SecretResponseDTO
    ) -> PublicSecretResponseDTO:
        """The response shape ``request``'s principal may see.

        Only the platform runtime (a Secret token carrying the ``secret-resolve`` grant)
        receives write-only values in plaintext. Every caller still receives the same
        public response type rather than the internal service DTO.
        """
        return project_secret_response(
            secret_dto,
            reveal_write_only=request_has_grant(request, SECRET_RESOLVE_GRANT),
        )

    @intercept_exceptions()
    async def create_secret(self, request: Request, body: CreateSecretDTO):
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
        return self._for_caller(request, vault_secret)

    @intercept_exceptions()
    async def list_secrets(self, request: Request):
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

        secrets_dtos = await self.service.list_secrets(
            project_id=UUID(request.state.project_id),
        )

        return [self._for_caller(request, secret_dto) for secret_dto in secrets_dtos]

    @intercept_exceptions()
    async def read_secret(self, request: Request, secret_id_or_slug: str):
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

        # A valid UUID means it's an id; anything else is a slug.
        secret_id = None
        secret_slug = None
        try:
            secret_id = UUID(secret_id_or_slug).hex
        except ValueError:
            secret_slug = secret_id_or_slug

        if secret_id is not None:
            secrets_dto = await self.service.get_secret_by_id(
                project_id=UUID(request.state.project_id),
                secret_id=UUID(secret_id),
            )
        else:
            secrets_dto = await self.service.get_secret_by_slug(
                project_id=UUID(request.state.project_id),
                secret_slug=str(secret_slug),
            )

        if secrets_dto is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
            )
        return self._for_caller(request, secrets_dto)

    @intercept_exceptions()
    async def update_secret(
        self, request: Request, secret_id: str, body: UpdateSecretDTO
    ):
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

        try:
            secrets_dto = await self.service.update_secret(
                project_id=UUID(request.state.project_id),
                secret_id=UUID(secret_id),
                update_secret_dto=body,
                user_id=UUID(request.state.user_id),
            )
        except SecretValueRequiredError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=e.message
            ) from e
        except ManagedSecretReadOnlyError as e:
            # 409, not 400: the payload is well-formed; the stored row's managed state is
            # what forbids the change.
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=e.message
            ) from e
        if secrets_dto is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found"
            )
        return self._for_caller(request, secrets_dto)

    @intercept_exceptions()
    async def delete_secret(self, request: Request, secret_id: str):
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

        try:
            await self.service.delete_secret(
                project_id=UUID(request.state.project_id),
                secret_id=UUID(secret_id),
            )
        except ManagedSecretReadOnlyError as e:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=e.message
            ) from e
        return status.HTTP_204_NO_CONTENT
