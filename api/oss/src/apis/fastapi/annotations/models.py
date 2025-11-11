from typing import Optional, List, Dict
from enum import Enum

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Lifecycle,
    Data,
    Tags,
    Meta,
    Reference,
    Link,
    Windowing,
)


class AnnotationOrigin(str, Enum):
    CUSTOM = "custom"
    HUMAN = "human"
    AUTO = "auto"


class AnnotationKind(str, Enum):
    ADHOC = "adhoc"  # adhoc annotation
    EVAL = "eval"  # evaluation annotation


class AnnotationChannel(str, Enum):
    WEB = "web"
    SDK = "sdk"  # python vs typescript ?
    API = "api"  # http vs otlp ?


class AnnotationReferences(BaseModel):
    evaluator: Reference
    evaluator_variant: Optional[Reference] = None
    evaluator_revision: Optional[Reference] = None
    testset: Optional[Reference] = None
    testcase: Optional[Reference] = None


AnnotationLinks = Dict[str, Link]


class Annotation(Link, Lifecycle):
    origin: AnnotationOrigin = AnnotationOrigin.CUSTOM
    kind: AnnotationKind = AnnotationKind.ADHOC
    channel: AnnotationChannel = AnnotationChannel.API

    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Data

    references: AnnotationReferences
    links: AnnotationLinks


class AnnotationCreate(BaseModel):
    origin: AnnotationOrigin = AnnotationOrigin.CUSTOM
    kind: AnnotationKind = AnnotationKind.ADHOC
    channel: AnnotationChannel = AnnotationChannel.API

    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Data

    references: AnnotationReferences
    links: AnnotationLinks


class AnnotationEdit(BaseModel):
    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    data: Data


class AnnotationQuery(BaseModel):
    origin: Optional[AnnotationOrigin] = None
    kind: Optional[AnnotationKind] = None
    channel: Optional[AnnotationChannel] = None

    tags: Optional[Tags] = None
    meta: Optional[Meta] = None

    references: Optional[AnnotationReferences] = None
    links: Optional[AnnotationLinks | List[Link]] = None


class AnnotationCreateRequest(BaseModel):
    annotation: AnnotationCreate


class AnnotationEditRequest(BaseModel):
    annotation: AnnotationEdit


class AnnotationQueryRequest(BaseModel):
    annotation: Optional[AnnotationQuery] = None
    annotation_links: Optional[List[Link]] = None
    windowing: Optional[Windowing] = None


class AnnotationResponse(BaseModel):
    count: int = 0
    annotation: Optional[Annotation] = None


class AnnotationsResponse(BaseModel):
    count: int = 0
    annotations: List[Annotation] = []


class AnnotationLinkResponse(BaseModel):
    count: int = 0
    annotation_link: Optional[Link] = None
