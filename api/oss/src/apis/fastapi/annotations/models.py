from typing import Optional, List

from pydantic import BaseModel

from oss.src.utils.exceptions import Support

from oss.src.core.shared.dtos import (
    Link,
    Windowing,
)
from oss.src.core.annotations.types import (
    Annotation,
    AnnotationCreate,
    AnnotationEdit,
    AnnotationQuery,
)


# ANNOTATIONS ------------------------------------------------------------------


class AnnotationCreateRequest(BaseModel):
    annotation: AnnotationCreate


class AnnotationEditRequest(BaseModel):
    annotation: AnnotationEdit


class AnnotationQueryRequest(BaseModel):
    annotation: Optional[AnnotationQuery] = None
    #
    annotation_links: Optional[List[Link]] = None
    #
    windowing: Optional[Windowing] = None


class AnnotationResponse(Support):
    count: int = 0
    annotation: Optional[Annotation] = None


class AnnotationsResponse(Support):
    count: int = 0
    annotations: List[Annotation] = []


class AnnotationLinkResponse(Support):
    count: int = 0
    annotation_link: Optional[Link] = None


class AnnotationLinksResponse(Support):
    count: int = 0
    annotation_links: List[Link] = []
