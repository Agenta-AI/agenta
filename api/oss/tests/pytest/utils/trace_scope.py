"""Trace read scopes for unit tests that call tracing reads directly."""

from typing import Optional
from uuid import UUID, uuid4

from oss.src.core.access.dtos import PrincipalKind, PrincipalRef
from oss.src.core.tracing.access import SpanReadScope


def reader_scope(project_id: UUID) -> SpanReadScope:
    """The scope of a human reader who may read every trace of the project."""

    return SpanReadScope(
        project_id=project_id,
        principal=PrincipalRef(kind=PrincipalKind.HUMAN, id=uuid4()),
    )


def scoped(project_id: Optional[UUID] = None) -> dict:
    """`project_id` and its `scope`, as keyword arguments of a tracing read."""

    project_id = project_id or uuid4()
    return {"project_id": project_id, "scope": reader_scope(project_id)}
