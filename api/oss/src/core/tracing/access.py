"""The read scope of every trace read (trace privacy, M9).

A span of project P is readable by principal X only if X passes `VIEW_SPANS` in P and
no span of the same trace carries a session id that names a session of P which X may
not read: a private session X does not own and is not granted, or a deleted private
session (a tombstone) X did not own. Callers check `VIEW_SPANS`; the scope carries the
rest as the list of session ids X may not read, and the tracing DAO hides every trace
that has a span with one of them.

Only `TraceAccessService` builds a scope. A user read passes the caller's scope; an
unrestricted scope exists only for a named maintenance operation. When the scope cannot
be computed, the read fails: it never falls back to an unfiltered read.
"""

from enum import Enum
from typing import Optional, Tuple
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from oss.src.core.access.dtos import PrincipalRef, RunAuthority
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# A deny list this long still costs a span page about 25 ms on the largest projects
# (measured). Past it, the filter strategy needs another look.
DENIED_SESSIONS_WARNING_SIZE = 10_000


class MaintenanceOperation(str, Enum):
    # The metric roll-up of ingest, which also reports the usage written back to turns.
    INGEST = "ingest"


class SpanReadScope(BaseModel):
    """Built only by `TraceAccessService`."""

    model_config = ConfigDict(frozen=True)

    project_id: UUID
    principal: Optional[PrincipalRef] = None  # None only for maintenance
    maintenance: Optional[MaintenanceOperation] = None
    # The session ids of the project whose traces this reader may not read.
    denied_session_ids: Tuple[str, ...] = ()

    @property
    def restricted(self) -> bool:
        """True when the scope removes data for this reader in this project."""
        return bool(self.denied_session_ids)


class TraceScopeError(Exception):
    """The read scope is missing, belongs to another project, or cannot be computed.
    The read fails with it; it is never answered as an empty result."""


def require_scope(scope: Optional[SpanReadScope], *, project_id: UUID) -> SpanReadScope:
    """The check every tracing DAO read runs first."""

    if not isinstance(scope, SpanReadScope):
        raise TraceScopeError("A trace read needs a read scope.")
    if scope.project_id != project_id:
        raise TraceScopeError("The read scope belongs to another project.")
    if scope.principal is None and scope.maintenance is None:
        raise TraceScopeError(
            "A read scope names a principal or a maintenance operation."
        )
    return scope


class TraceAccessService:
    def __init__(self, *, sharing_service) -> None:
        # `SharingService`; untyped because the tracing DAO imports this module.
        self._sharing = sharing_service

    async def read_scope(
        self,
        *,
        authority: Optional[RunAuthority],
        principal: Optional[PrincipalRef],
        project_id: UUID,
    ) -> SpanReadScope:
        """The caller's scope: the request principal for a route, the run authority for
        a run (its principal wins). Raises `TraceScopeError` when it cannot be computed."""

        if authority is not None:
            if authority.project_id != project_id:
                raise TraceScopeError("The run authority belongs to another project.")
            principal = authority.principal
        if principal is None:
            raise TraceScopeError("A trace read needs a principal.")

        if not env.agenta.api.tracing.session_filter_enabled:
            return SpanReadScope(project_id=project_id, principal=principal)

        try:
            denied = await self._sharing.unreadable_session_ids(
                project_id=project_id, principal=principal
            )
        except Exception as error:
            log.error(
                "[TRACING] Read scope failed",
                project_id=str(project_id),
                exc_info=True,
            )
            raise TraceScopeError("The trace read scope is unavailable.") from error

        if len(denied) >= DENIED_SESSIONS_WARNING_SIZE:
            log.warning(
                "[TRACING] Large trace read scope",
                project_id=str(project_id),
                denied=len(denied),
            )
        return SpanReadScope(
            project_id=project_id,
            principal=principal,
            denied_session_ids=tuple(sorted(denied)),
        )

    @staticmethod
    def maintenance(
        *, project_id: UUID, operation: MaintenanceOperation
    ) -> SpanReadScope:
        """The unrestricted scope of a named maintenance operation. No I/O and no
        registered service, so a worker without the access bootstrap can use it."""

        return SpanReadScope(project_id=project_id, maintenance=operation)


_trace_access_service: Optional[TraceAccessService] = None


def register_trace_access_service(*, service: TraceAccessService) -> None:
    global _trace_access_service
    _trace_access_service = service


def get_trace_access_service() -> TraceAccessService:
    if _trace_access_service is None:
        raise TraceScopeError(
            "TraceAccessService is not registered. Call "
            "entrypoints.access.bootstrap_access() at process startup."
        )
    return _trace_access_service
