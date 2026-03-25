from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.environments.dtos import (
    Environment,
    EnvironmentCreate,
    EnvironmentEdit,
    EnvironmentQuery,
    EnvironmentRevisionsLog,
    #
    EnvironmentVariant,
    EnvironmentVariantCreate,
    EnvironmentVariantEdit,
    EnvironmentVariantQuery,
    #
    EnvironmentRevision,
    EnvironmentRevisionCreate,
    EnvironmentRevisionEdit,
    EnvironmentRevisionQuery,
    EnvironmentRevisionCommit,
    #
    SimpleEnvironment,
    SimpleEnvironmentCreate,
    SimpleEnvironmentEdit,
    SimpleEnvironmentQuery,
)
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
    ResolutionInfo,
)


# ENVIRONMENTS -----------------------------------------------------------------


class EnvironmentCreateRequest(BaseModel):
    environment: EnvironmentCreate


class EnvironmentEditRequest(BaseModel):
    environment: EnvironmentEdit


class EnvironmentQueryRequest(BaseModel):
    environment: Optional[EnvironmentQuery] = None
    #
    environment_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class EnvironmentResponse(BaseModel):
    count: int = 0
    environment: Optional[Environment] = None


class EnvironmentsResponse(BaseModel):
    count: int = 0
    environments: List[Environment] = []


# ENVIRONMENT VARIANTS ---------------------------------------------------------


class EnvironmentVariantCreateRequest(BaseModel):
    environment_variant: EnvironmentVariantCreate


class EnvironmentVariantEditRequest(BaseModel):
    environment_variant: EnvironmentVariantEdit


class EnvironmentVariantQueryRequest(BaseModel):
    environment_variant: Optional[EnvironmentVariantQuery] = None
    #
    environment_refs: Optional[List[Reference]] = None
    environment_variant_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class EnvironmentVariantResponse(BaseModel):
    count: int = 0
    environment_variant: Optional[EnvironmentVariant] = None


class EnvironmentVariantsResponse(BaseModel):
    count: int = 0
    environment_variants: List[EnvironmentVariant] = []


# ENVIRONMENT REVISIONS --------------------------------------------------------


class EnvironmentRevisionCreateRequest(BaseModel):
    environment_revision: EnvironmentRevisionCreate


class EnvironmentRevisionEditRequest(BaseModel):
    environment_revision: EnvironmentRevisionEdit


class EnvironmentRevisionQueryRequest(BaseModel):
    environment_revision: Optional[EnvironmentRevisionQuery] = None
    #
    environment_refs: Optional[List[Reference]] = None
    environment_variant_refs: Optional[List[Reference]] = None
    environment_revision_refs: Optional[List[Reference]] = None
    #
    application_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None
    resolve: Optional[bool] = None  # Optionally resolve embeds on query


class EnvironmentRevisionCommitRequest(BaseModel):
    environment_revision_commit: EnvironmentRevisionCommit


class EnvironmentRevisionRetrieveRequest(BaseModel):
    environment_ref: Optional[Reference] = None
    environment_variant_ref: Optional[Reference] = None
    environment_revision_ref: Optional[Reference] = None
    resolve: Optional[bool] = None  # Optionally resolve embeds on retrieve


class EnvironmentRevisionsLogRequest(BaseModel):
    environment: EnvironmentRevisionsLog


class EnvironmentRevisionResponse(BaseModel):
    count: int = 0
    environment_revision: Optional[EnvironmentRevision] = None
    resolution_info: Optional[ResolutionInfo] = None  # Included when resolve=True


class EnvironmentRevisionsResponse(BaseModel):
    count: int = 0
    environment_revisions: List[EnvironmentRevision] = []


# SIMPLE ENVIRONMENTS ----------------------------------------------------------


class SimpleEnvironmentCreateRequest(BaseModel):
    environment: SimpleEnvironmentCreate


class SimpleEnvironmentEditRequest(BaseModel):
    environment: SimpleEnvironmentEdit


class SimpleEnvironmentQueryRequest(BaseModel):
    environment: Optional[SimpleEnvironmentQuery] = None
    #
    environment_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = False
    #
    windowing: Optional[Windowing] = None


class SimpleEnvironmentResponse(BaseModel):
    count: int = 0
    environment: Optional[SimpleEnvironment] = None


class SimpleEnvironmentsResponse(BaseModel):
    count: int = 0
    environments: List[SimpleEnvironment] = []


# ENVIRONMENT REVISION RESOLUTION ----------------------------------------------


class EnvironmentRevisionResolveRequest(BaseModel):
    environment_ref: Optional[Reference] = None
    environment_variant_ref: Optional[Reference] = None
    environment_revision_ref: Optional[Reference] = None
    #
    max_depth: Optional[int] = 10
    max_embeds: Optional[int] = 100
    error_policy: Optional[ErrorPolicy] = ErrorPolicy.EXCEPTION


class EnvironmentRevisionResolveResponse(BaseModel):
    count: int = 0
    environment_revision: Optional[EnvironmentRevision] = None
    resolution_info: Optional[ResolutionInfo] = None
