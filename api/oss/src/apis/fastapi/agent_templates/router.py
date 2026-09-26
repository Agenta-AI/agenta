from uuid import UUID

from fastapi import APIRouter, Request, status
from fastapi.responses import JSONResponse

from oss.src.apis.fastapi.agent_templates.exceptions import (
    template_load_error_response,
)
from oss.src.apis.fastapi.agent_templates.models import (
    TemplateLoadRequest,
    TemplateValidateRequest,
)
from oss.src.apis.fastapi.shared.exceptions import FORBIDDEN_EXCEPTION
from oss.src.core.access.permissions.service import check_action_access
from oss.src.core.access.permissions.types import Permission
from oss.src.core.agent_templates.dtos import (
    SessionFileTemplateSource,
    TemplateLoadResult,
    TemplateSource,
    TemplateValidationResult,
    UploadTemplateSource,
)
from oss.src.core.agent_templates.loader import AgentTemplateLoader
from oss.src.core.agent_templates.validation import AgentTemplateValidator
from oss.src.core.shared.idempotency import request_key_hash
from oss.src.utils.exceptions import intercept_exceptions
from oss.src.utils.logging import get_module_logger


log = get_module_logger(__name__)
_MAX_IDEMPOTENCY_KEY_CHARACTERS = 255


def _source_permissions(source: TemplateSource) -> list[Permission]:
    """Reading a staged upload or a session file needs access to that session's files."""
    if isinstance(source, UploadTemplateSource):
        return [Permission.VIEW_SESSIONS]
    if isinstance(source, SessionFileTemplateSource):
        return [Permission.VIEW_SESSIONS, Permission.VIEW_MOUNTS]
    return []


def _source_log(source: TemplateSource) -> dict[str, str]:
    # Session paths and attachment ids stay out of logs; the key is a catalog slug.
    return {
        "source_kind": source.kind,
        **({"source_key": source.key} if source.kind == "internal" else {}),
    }


class AgentTemplatesRouter:
    def __init__(
        self,
        *,
        loader: AgentTemplateLoader,
        validator: AgentTemplateValidator | None = None,
    ) -> None:
        self._loader = loader
        self._validator = validator
        self.router = APIRouter()
        if validator is not None:
            self.router.add_api_route(
                "/validate",
                self.validate_template,
                methods=["POST"],
                operation_id="validate_agent_template",
                status_code=status.HTTP_200_OK,
                response_model=TemplateValidationResult,
                responses={
                    403: {"description": "Forbidden"},
                    404: {"description": "Template source not found"},
                    422: {"description": "Invalid request"},
                },
            )
        self.router.add_api_route(
            "/load",
            self.load_template,
            methods=["POST"],
            operation_id="load_agent_template",
            status_code=status.HTTP_201_CREATED,
            response_model=TemplateLoadResult,
            responses={
                200: {"description": "Idempotent replay"},
                400: {"description": "Idempotency key required"},
                403: {"description": "Forbidden"},
                404: {"description": "Template source not found"},
                409: {"description": "Idempotency conflict"},
                422: {"description": "Invalid package or request"},
                503: {"description": "Load handoff not durable"},
            },
        )

    @staticmethod
    def _idempotency_error(*, code: str, message: str) -> JSONResponse:
        return JSONResponse(
            status_code=(
                status.HTTP_400_BAD_REQUEST
                if code == "idempotency_key_required"
                else status.HTTP_422_UNPROCESSABLE_ENTITY
            ),
            content={
                "code": code,
                "message": message,
                "retryable": False,
                "details": {"field": "Idempotency-Key"},
            },
        )

    async def _authorize(self, request: Request, permissions: list[Permission]) -> None:
        for permission in permissions:
            if not await check_action_access(  # type: ignore
                user_uid=request.state.user_id,
                project_id=request.state.project_id,
                permission=permission,
            ):
                raise FORBIDDEN_EXCEPTION  # type: ignore

    @intercept_exceptions()
    async def validate_template(
        self,
        request: Request,
        project_id: UUID,
        *,
        payload: TemplateValidateRequest,
    ) -> JSONResponse:
        await self._authorize(
            request,
            [Permission.VIEW_WORKFLOWS, *_source_permissions(payload.source)],
        )
        authorized_project_id = UUID(str(request.state.project_id))
        if project_id != authorized_project_id:
            raise FORBIDDEN_EXCEPTION  # type: ignore
        if self._validator is None:
            raise RuntimeError("Template validation is not configured.")
        try:
            result = await self._validator.validate(
                project_id=project_id,
                source=payload.source,
                pin=payload.pin,
            )
        except Exception as exc:
            response = template_load_error_response(exc)
            if response is None:
                raise
            return response

        log.info(
            "agent template validated",
            project_id=str(project_id),
            valid=result.valid,
            issue_codes=[issue.code for issue in result.issues],
            **_source_log(payload.source),
        )
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content=result.model_dump(mode="json"),
        )

    @intercept_exceptions()
    async def load_template(
        self,
        request: Request,
        project_id: UUID,
        *,
        payload: TemplateLoadRequest,
    ) -> JSONResponse:
        permissions = [Permission.EDIT_WORKFLOWS, Permission.RUN_SESSIONS]
        if payload.attachment_ids:
            permissions.extend([Permission.VIEW_SESSIONS, Permission.EDIT_SESSIONS])
        permissions.extend(
            permission
            for permission in _source_permissions(payload.source)
            if permission not in permissions
        )
        await self._authorize(request, permissions)

        request_key = (request.headers.get("Idempotency-Key") or "").strip()
        if not request_key:
            return self._idempotency_error(
                code="idempotency_key_required",
                message="Idempotency-Key is required.",
            )
        if len(request_key) > _MAX_IDEMPOTENCY_KEY_CHARACTERS:
            return self._idempotency_error(
                code="idempotency_key_invalid",
                message="Idempotency-Key is too long.",
            )

        authorized_project_id = UUID(str(request.state.project_id))
        if project_id != authorized_project_id:
            raise FORBIDDEN_EXCEPTION  # type: ignore
        user_id = UUID(str(request.state.user_id))
        try:
            result = await self._loader.load(
                project_id=project_id,
                user_id=user_id,
                command=payload.to_domain(request_key=request_key),
            )
        except Exception as exc:
            response = template_load_error_response(exc)
            if response is None:
                raise
            log.info(
                "agent template load failed",
                project_id=str(project_id),
                request_key_hash=request_key_hash(request_key),
                status_code=response.status_code,
                **_source_log(payload.source),
            )
            return response

        log.info(
            "agent template load complete",
            project_id=str(project_id),
            request_key_hash=request_key_hash(request_key),
            workflow_id=str(result.workflow_id),
            revision_id=str(result.revision_id),
            session_id=result.session_id,
            replayed=result.replayed,
            **_source_log(payload.source),
        )
        return JSONResponse(
            status_code=(
                status.HTTP_200_OK if result.replayed else status.HTTP_201_CREATED
            ),
            content=result.model_dump(mode="json"),
        )
