from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Reference,
    Windowing,
)
from oss.src.core.applications.dtos import (
    Application,
    ApplicationCreate,
    ApplicationEdit,
    ApplicationQuery,
    #
    ApplicationVariant,
    ApplicationVariantCreate,
    ApplicationVariantEdit,
    ApplicationVariantQuery,
    #
    ApplicationRevision,
    ApplicationRevisionCreate,
    ApplicationRevisionEdit,
    ApplicationRevisionQuery,
    ApplicationRevisionCommit,
    #
    LegacyApplication,
    LegacyApplicationCreate,
    LegacyApplicationEdit,
)

# APPLICATIONS -----------------------------------------------------------------


class ApplicationCreateRequest(BaseModel):
    application: ApplicationCreate


class ApplicationEditRequest(BaseModel):
    application: ApplicationEdit


class ApplicationQueryRequest(BaseModel):
    application: Optional[ApplicationQuery] = None
    #
    application_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class ApplicationResponse(BaseModel):
    count: int = 0
    application: Optional[Application] = None


class ApplicationsResponse(BaseModel):
    count: int = 0
    applications: List[Application] = []


# APPLICATION VARIANTS ---------------------------------------------------------


class ApplicationVariantCreateRequest(BaseModel):
    application_variant: ApplicationVariantCreate


class ApplicationVariantEditRequest(BaseModel):
    application_variant: ApplicationVariantEdit


class ApplicationVariantQueryRequest(BaseModel):
    application_variant: Optional[ApplicationVariantQuery] = None
    #
    application_refs: Optional[List[Reference]] = None
    application_variant_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class ApplicationVariantResponse(BaseModel):
    count: int = 0
    application_variant: Optional[ApplicationVariant] = None


class ApplicationVariantsResponse(BaseModel):
    count: int = 0
    application_variants: List[ApplicationVariant] = []


# APPLICATION REVISIONS --------------------------------------------------------


class ApplicationRevisionCreateRequest(BaseModel):
    application_revision: ApplicationRevisionCreate


class ApplicationRevisionEditRequest(BaseModel):
    application_revision: ApplicationRevisionEdit


class ApplicationRevisionQueryRequest(BaseModel):
    application_revision: Optional[ApplicationRevisionQuery] = None
    #
    application_refs: Optional[List[Reference]] = None
    application_variant_refs: Optional[List[Reference]] = None
    application_revision_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class ApplicationRevisionCommitRequest(BaseModel):
    application_revision_commit: ApplicationRevisionCommit


class ApplicationRevisionRetrieveRequest(BaseModel):
    application_ref: Optional[Reference] = None
    application_variant_ref: Optional[Reference] = None
    application_revision_ref: Optional[Reference] = None


class ApplicationRevisionResponse(BaseModel):
    count: int = 0
    application_revision: Optional[ApplicationRevision] = None


class ApplicationRevisionsResponse(BaseModel):
    count: int = 0
    application_revisions: List[ApplicationRevision] = []


# LEGACY APPLICATIONS ----------------------------------------------------------


class LegacyApplicationCreateRequest(BaseModel):
    application: LegacyApplicationCreate


class LegacyApplicationEditRequest(BaseModel):
    application: LegacyApplicationEdit


class LegacyApplicationResponse(BaseModel):
    count: int = 0
    application: Optional[LegacyApplication] = None


class LegacyApplicationsResponse(BaseModel):
    count: int = 0
    applications: List[LegacyApplication] = []
