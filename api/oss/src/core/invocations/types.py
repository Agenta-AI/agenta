from typing import Optional

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import WorkflowFlags
from oss.src.core.tracing.dtos import (
    SimpleTraceOrigin,
    SimpleTraceKind,
    SimpleTraceChannel,
    SimpleTraceReferences,
    SimpleTraceLinks,
    #
    SimpleTrace,
    SimpleTraceCreate,
    SimpleTraceEdit,
    SimpleTraceQuery,
)


InvocationOrigin = SimpleTraceOrigin
InvocationKind = SimpleTraceKind
InvocationChannel = SimpleTraceChannel
InvocationLinks = SimpleTraceLinks


class InvocationFlags(WorkflowFlags):
    is_sdk: Optional[bool] = None
    is_web: Optional[bool] = None
    is_evaluation: Optional[bool] = None


class InvocationReferences(SimpleTraceReferences):
    application: Reference  # type: ignore


class Invocation(SimpleTrace):
    links: Optional[InvocationLinks]


class InvocationCreate(SimpleTraceCreate):
    links: Optional[InvocationLinks]


class InvocationEdit(SimpleTraceEdit):
    pass


class InvocationQuery(SimpleTraceQuery):
    pass
