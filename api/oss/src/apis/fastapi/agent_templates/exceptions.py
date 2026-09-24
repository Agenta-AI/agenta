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
from oss.src.core.sessions.inputs.types import SessionInputIdempotencyConflict
from oss.src.core.sessions.starts.types import SessionStartNotDurable


def _response(
    *,
    status_code: int,
    code: str,
    message: str,
    retryable: bool = False,
    next_step: str | None = None,
    details: dict | None = None,
) -> JSONResponse:
    content = {
        "code": code,
        "message": message,
        "retryable": retryable,
        "details": details or {},
    }
    if retryable or next_step:
        content["next_step"] = next_step or (
            "Retry with the same Idempotency-Key; do not submit a new request."
        )
    return JSONResponse(
        status_code=status_code,
        content=content,
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
    # The same exception the sessions router already maps, so it answers with the same code
    # rather than a second name for one condition.
    if isinstance(exc, SessionInputIdempotencyConflict):
        return _response(
            status_code=status.HTTP_409_CONFLICT,
            code="idempotency_key_reused",
            message=(
                "This Idempotency-Key was already used for a different first message. "
                "Resend the original request body, or start over with a new key."
            ),
        )
    if isinstance(exc, SessionStartNotDurable):
        return _response(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="template_handoff_not_durable",
            message="The initial session start was not durably recorded.",
            retryable=exc.retryable,
            next_step=exc.next_step,
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
            message="The template contains an invalid workspace path.",
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
