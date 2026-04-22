from typing import Optional, List

from pydantic import BaseModel

from oss.src.utils.exceptions import Support

from oss.src.core.shared.dtos import (
    Link,
    Windowing,
)
from oss.src.core.invocations.types import (
    Invocation,
    InvocationCreate,
    InvocationEdit,
    InvocationQuery,
)

# INVOCATIONS ------------------------------------------------------------------


class InvocationCreateRequest(BaseModel):
    invocation: InvocationCreate


class InvocationEditRequest(BaseModel):
    invocation: InvocationEdit


class InvocationQueryRequest(BaseModel):
    invocation: Optional[InvocationQuery] = None
    #
    invocation_links: Optional[List[Link]] = None
    #
    windowing: Optional[Windowing] = None


class InvocationResponse(Support):
    count: int = 0
    invocation: Optional[Invocation] = None


class InvocationsResponse(Support):
    count: int = 0
    invocations: List[Invocation] = []


class InvocationLinkResponse(Support):
    count: int = 0
    invocation_link: Optional[Link] = None


class InvocationLinksResponse(Support):
    count: int = 0
    invocation_links: List[Link] = []
