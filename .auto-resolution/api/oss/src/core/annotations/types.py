from typing import Optional

from oss.src.core.shared.dtos import Reference
from oss.src.core.workflows.dtos import (
    WorkflowFlags,
    WorkflowQueryFlags,
)
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


AnnotationOrigin = SimpleTraceOrigin
AnnotationKind = SimpleTraceKind
AnnotationChannel = SimpleTraceChannel
AnnotationLinks = SimpleTraceLinks


class AnnotationFlags(WorkflowFlags):
    is_sdk: bool = False
    is_web: bool = False
    is_evaluation: bool = False


class AnnotationQueryFlags(WorkflowQueryFlags):
    is_sdk: Optional[bool] = None
    is_web: Optional[bool] = None
    is_evaluation: Optional[bool] = None


class AnnotationReferences(SimpleTraceReferences):
    evaluator: Reference  # type: ignore


class Annotation(SimpleTrace):
    pass


class AnnotationCreate(SimpleTraceCreate):
    pass


class AnnotationEdit(SimpleTraceEdit):
    pass


class AnnotationQuery(SimpleTraceQuery):
    pass
