from typing import Optional, List

from pydantic import BaseModel

from oss.src.utils.exceptions import Support

from oss.src.core.shared.dtos import (
    Reference,
    Windowing,
)
from oss.src.core.applications.dtos import (
    Application,
    ApplicationCatalogType,
    ApplicationCatalogTemplate,
    ApplicationCatalogPreset,
    ApplicationCreate,
    ApplicationEdit,
    ApplicationQuery,
    ApplicationFork,
    ApplicationRevisionsLog,
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
    SimpleApplication,
    SimpleApplicationCreate,
    SimpleApplicationEdit,
    SimpleApplicationQuery,
)
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
    ResolutionInfo,
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


class ApplicationResponse(Support):
    count: int = 0
    application: Optional[Application] = None


class ApplicationsResponse(Support):
    count: int = 0
    applications: List[Application] = []


class ApplicationForkRequest(BaseModel):
    application: ApplicationFork


class ApplicationRevisionsLogRequest(BaseModel):
    application: ApplicationRevisionsLog


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


class ApplicationVariantResponse(Support):
    count: int = 0
    application_variant: Optional[ApplicationVariant] = None


class ApplicationVariantsResponse(Support):
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
    resolve: Optional[bool] = None  # Optionally resolve embeds on query


class ApplicationRevisionCommitRequest(BaseModel):
    application_revision_commit: ApplicationRevisionCommit


class ApplicationRevisionRetrieveRequest(BaseModel):
    application_ref: Optional[Reference] = None
    application_variant_ref: Optional[Reference] = None
    application_revision_ref: Optional[Reference] = None
    environment_ref: Optional[Reference] = None
    environment_variant_ref: Optional[Reference] = None
    environment_revision_ref: Optional[Reference] = None
    key: Optional[str] = None
    resolve: Optional[bool] = None  # Optionally resolve embeds on retrieve


class ApplicationRevisionDeployRequest(BaseModel):
    application_ref: Optional[Reference] = None
    application_variant_ref: Optional[Reference] = None
    application_revision_ref: Optional[Reference] = None
    environment_ref: Optional[Reference] = None
    environment_variant_ref: Optional[Reference] = None
    environment_revision_ref: Optional[Reference] = None
    key: Optional[str] = None
    message: Optional[str] = None


class ApplicationRevisionResponse(Support):
    count: int = 0
    application_revision: Optional[ApplicationRevision] = None
    resolution_info: Optional[ResolutionInfo] = None  # Included when resolve=True


class ApplicationRevisionsResponse(Support):
    count: int = 0
    application_revisions: List[ApplicationRevision] = []


# SIMPLE APPLICATIONS ----------------------------------------------------------


class SimpleApplicationCreateRequest(BaseModel):
    application: SimpleApplicationCreate


class SimpleApplicationEditRequest(BaseModel):
    application: SimpleApplicationEdit


class SimpleApplicationQueryRequest(BaseModel):
    application: Optional[SimpleApplicationQuery] = None
    #
    application_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = False
    #
    windowing: Optional[Windowing] = None


class SimpleApplicationResponse(Support):
    count: int = 0
    application: Optional[SimpleApplication] = None


class SimpleApplicationsResponse(Support):
    count: int = 0
    applications: List[SimpleApplication] = []


# APPLICATION REVISION RESOLUTION ----------------------------------------------


class ApplicationRevisionResolveRequest(BaseModel):
    application_ref: Optional[Reference] = None
    application_variant_ref: Optional[Reference] = None
    application_revision_ref: Optional[Reference] = None
    #
    max_depth: Optional[int] = 10
    max_embeds: Optional[int] = 100
    error_policy: Optional[ErrorPolicy] = ErrorPolicy.EXCEPTION


class ApplicationRevisionResolveResponse(Support):
    count: int = 0
    application_revision: Optional[ApplicationRevision] = None
    resolution_info: Optional[ResolutionInfo] = None


class ApplicationCatalogTypeResponse(Support):
    count: int = 0
    type: Optional[ApplicationCatalogType] = None


class ApplicationCatalogTypesResponse(Support):
    count: int = 0
    types: List[ApplicationCatalogType] = []


class ApplicationCatalogTemplateResponse(Support):
    count: int = 0
    template: Optional[ApplicationCatalogTemplate] = None


class ApplicationCatalogTemplatesResponse(Support):
    count: int = 0
    templates: List[ApplicationCatalogTemplate] = []


class ApplicationCatalogPresetResponse(Support):
    count: int = 0
    preset: Optional[ApplicationCatalogPreset] = None


class ApplicationCatalogPresetsResponse(Support):
    count: int = 0
    presets: List[ApplicationCatalogPreset] = []
