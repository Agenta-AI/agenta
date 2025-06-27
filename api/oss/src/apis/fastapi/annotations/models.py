from typing import Optional, List, Dict
from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field

from oss.src.core.shared.dtos import Reference, Lifecycle, Data, Meta
from oss.src.core.tracing.dtos import Link


class AnnotationReference(Reference):
    attributes: dict = Field(default=None, exclude=True)


class AnnotationLink(Link):
    attributes: dict = Field(default=None, exclude=True)


AnnotationLinks = Dict[str, AnnotationLink]
AnnotationLifecycle = Lifecycle
AnnotationData = Data
AnnotationMeta = Meta


class AnnotationKind(str, Enum):
    CUSTOM = "custom"  # EXTERNAL
    HUMAN = "human"
    AUTO = "auto"


class AnnotationSource(str, Enum):
    WEB = "web"
    SDK = "sdk"  # python vs typescript ?
    API = "api"  # http vs otlp ?


class AnnotationReferences(BaseModel):
    # environment: Optional[AnnotationReference] = None
    evaluator: AnnotationReference
    testset: Optional[AnnotationReference] = None
    testcase: Optional[AnnotationReference] = None


class Annotation(AnnotationLink, AnnotationLifecycle):
    kind: AnnotationKind = AnnotationKind.CUSTOM
    source: AnnotationSource = AnnotationSource.API
    data: AnnotationData
    meta: Optional[AnnotationMeta] = None
    references: AnnotationReferences
    links: AnnotationLinks


class AnnotationCreate(BaseModel):
    kind: AnnotationKind = AnnotationKind.CUSTOM
    source: AnnotationSource = AnnotationSource.API
    data: AnnotationData
    meta: Optional[AnnotationMeta] = None
    references: AnnotationReferences
    links: AnnotationLinks


class AnnotationEdit(BaseModel):
    data: AnnotationData
    meta: Optional[AnnotationMeta] = None


class AnnotationQuery(BaseModel):
    trace_id: Optional[str] = None
    span_id: Optional[str] = None
    kind: Optional[AnnotationKind] = AnnotationKind.CUSTOM
    source: Optional[AnnotationSource] = AnnotationSource.API
    meta: Optional[AnnotationMeta] = None
    references: Optional[AnnotationReferences] = None
    links: Optional[AnnotationLinks] = None


class AnnotationCreateRequest(BaseModel):
    annotation: AnnotationCreate


class AnnotationEditRequest(BaseModel):
    annotation: AnnotationEdit


class AnnotationQueryRequest(BaseModel):
    annotation: Optional[AnnotationQuery] = None


class AnnotationResponse(BaseModel):
    annotation: Optional[Annotation] = None


class AnnotationsResponse(BaseModel):
    count: int = 0
    annotations: List[Annotation] = []


class AnnotationLinkResponse(BaseModel):
    annotation: AnnotationLink
