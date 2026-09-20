from fastapi import status
from fastapi.responses import JSONResponse

from oss.src.core.agent_templates.exceptions import (
    AgentTemplateError,
    TemplateCreateConflict,
    TemplatePackageInvalid,
    TemplateProvenanceInvalid,
    TemplateSkillCreationFailed,
    TemplateSourceDigestMismatch,
    TemplateSourceInvalid,
    TemplateSourceNotFound,
    TemplateWorkflowCreationFailed,
)
from oss.src.core.mounts.types import MountPathInvalid, MountStorageUnavailable
from oss.src.core.sessions.starts.types import SessionStartNotDurable


def _response(
    *,
    status_code: int,
    code: str,
    message: str,
    retryable: bool = False,
    details: dict | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "code": code,
            "message": message,
            "retryable": retryable,
            "details": details or {},
        },
    )


def template_load_error_response(exc: Exception) -> JSONResponse | None:
    if isinstance(exc, TemplateSourceNotFound):
        return _response(
            status_code=status.HTTP_404_NOT_FOUND,
            code="template_source_not_found",
            message=exc.message,
            details=exc.details,
        )
    if isinstance(exc, TemplateCreateConflict):
        return _response(
            status_code=status.HTTP_409_CONFLICT,
            code="template_load_conflict",
            message=exc.message,
        )
    if isinstance(exc, SessionStartNotDurable):
        return _response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="template_handoff_not_durable",
            message=str(exc),
            retryable=True,
        )
    if isinstance(
        exc,
        (TemplateSkillCreationFailed, TemplateWorkflowCreationFailed),
    ):
        return _response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="template_load_incomplete",
            message=exc.message,
            retryable=True,
            details=exc.details,
        )
    if isinstance(exc, MountStorageUnavailable):
        return _response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="template_load_incomplete",
            message="The template workspace could not be stored.",
            retryable=True,
        )
    if isinstance(exc, MountPathInvalid):
        return _response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="template_package_invalid",
            message=str(exc),
        )
    if isinstance(
        exc,
        (
            TemplatePackageInvalid,
            TemplateSourceInvalid,
            TemplateSourceDigestMismatch,
            TemplateProvenanceInvalid,
        ),
    ):
        return _response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="template_package_invalid",
            message=exc.message,
            details={"reason": exc.code, **exc.details},
        )
    if isinstance(exc, AgentTemplateError):
        return _response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code=exc.code,
            message=exc.message,
            retryable=exc.retryable,
            details=exc.details,
        )
    return None
