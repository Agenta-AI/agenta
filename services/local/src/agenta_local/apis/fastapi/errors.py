"""Domain-failure -> stable HTTP error shape mapping ({code, message, ...})."""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from agenta_local.core.agents.types import (
    AgentInUse,
    AgentNotFound,
    ImmutableRevision,
    RevisionNotFound,
)
from agenta_local.core.exceptions import DomainError
from agenta_local.core.execution.types import (
    CancelledTurn,
    RunnerUnavailable,
    TurnTimeout,
)
from agenta_local.core.providers.types import (
    CredentialsFileCorrupt,
    CredentialsFileInsecure,
    ProviderNameInvalid,
    ProviderNotConfigured,
)
from agenta_local.core.sessions.types import (
    IdempotencyConflict,
    SessionBusy,
    SessionNotFound,
    TurnAlreadyExists,
    TurnNotActive,
    TurnNotFound,
)

_STATUS_BY_ERROR: dict[type[DomainError], int] = {
    AgentNotFound: 404,
    RevisionNotFound: 404,
    SessionNotFound: 404,
    TurnNotFound: 404,
    SessionBusy: 409,
    TurnAlreadyExists: 409,
    IdempotencyConflict: 409,
    TurnNotActive: 409,
    ImmutableRevision: 409,
    AgentInUse: 409,
    ProviderNotConfigured: 409,
    ProviderNameInvalid: 400,
    CredentialsFileCorrupt: 500,
    CredentialsFileInsecure: 500,
    RunnerUnavailable: 502,
    TurnTimeout: 504,
    CancelledTurn: 499,
}


def error_payload(exc: DomainError) -> dict:
    body: dict = {
        "code": exc.code,
        "message": str(exc),
        "retryable": exc.retryable,
    }
    if getattr(exc, "next_step", None):
        body["next_step"] = exc.next_step
    if exc.details:
        body["details"] = exc.details
    return body


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(DomainError)
    async def _domain_error(_: Request, exc: DomainError) -> JSONResponse:
        status = _STATUS_BY_ERROR.get(type(exc), 400)
        if status == 400 and type(exc) not in _STATUS_BY_ERROR:
            status = 500
        return JSONResponse(status_code=status, content=error_payload(exc))

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        _: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={
                "code": "invalid_request",
                "message": "request payload failed validation",
                "retryable": False,
                "details": {"errors": exc.errors()},
            },
        )

    @app.exception_handler(ValueError)
    async def _value_error(_: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(
            status_code=400,
            content={
                "code": "invalid_request",
                "message": str(exc),
                "retryable": False,
            },
        )
