"""The trace read scope of a request: the request's run authority and principal."""

from uuid import UUID

from fastapi import HTTPException, Request, status

from oss.src.core.tracing.access import (
    SpanReadScope,
    TraceScopeError,
    get_trace_access_service,
)


async def request_span_read_scope(request: Request) -> SpanReadScope:
    """The caller's trace read scope. A scope that cannot be computed answers 503: the
    read fails, it is never served unfiltered or empty."""

    try:
        return await get_trace_access_service().read_scope(
            authority=getattr(request.state, "authority", None),
            principal=getattr(request.state, "principal", None),
            project_id=UUID(str(request.state.project_id)),
        )
    except TraceScopeError as error:
        raise trace_scope_unavailable() from error


def trace_scope_unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Traces are unavailable right now. Try again.",
    )
