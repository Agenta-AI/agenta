from typing import Optional, List

from pydantic import BaseModel

from oss.src.utils.exceptions import Support

from oss.src.core.shared.dtos import Link, Windowing
from oss.src.core.tracing.dtos import (
    SimpleTrace,
    SimpleTraceCreate,
    SimpleTraceEdit,
    SimpleTraceQuery,
)


class SimpleTraceCreateRequest(BaseModel):
    trace: SimpleTraceCreate


class SimpleTraceEditRequest(BaseModel):
    trace: SimpleTraceEdit


class SimpleTraceQueryRequest(BaseModel):
    trace: Optional[SimpleTraceQuery] = None
    #
    links: Optional[List[Link]] = None
    #
    windowing: Optional[Windowing] = None


class SimpleTraceResponse(Support):
    count: int = 0
    trace: Optional[SimpleTrace] = None


class SimpleTracesResponse(Support):
    count: int = 0
    traces: List[SimpleTrace] = []


class SimpleTraceLinkResponse(Support):
    count: int = 0
    link: Optional[Link] = None
