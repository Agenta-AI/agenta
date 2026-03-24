from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.workflows.dtos import (
    #
    WorkflowCatalogType,
    WorkflowCatalogTemplate,
    WorkflowCatalogPreset,
    #
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    WorkflowFork,
    WorkflowRevisionsLog,
    #
    WorkflowVariant,
    WorkflowVariantCreate,
    WorkflowVariantEdit,
    WorkflowVariantQuery,
    #
    WorkflowRevision,
    WorkflowRevisionCreate,
    WorkflowRevisionEdit,
    WorkflowRevisionQuery,
    WorkflowRevisionCommit,
    #
    SimpleWorkflow,
    SimpleWorkflowCreate,
    SimpleWorkflowEdit,
    SimpleWorkflowQuery,
)
from oss.src.core.embeds.dtos import (
    ErrorPolicy,
    ResolutionInfo,
)


# WORKFLOWS --------------------------------------------------------------------


class WorkflowCreateRequest(BaseModel):
    workflow: WorkflowCreate


class WorkflowEditRequest(BaseModel):
    workflow: WorkflowEdit


class WorkflowQueryRequest(BaseModel):
    workflow: Optional[WorkflowQuery] = None
    #
    workflow_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class WorkflowForkRequest(BaseModel):
    workflow: WorkflowFork


class WorkflowResponse(BaseModel):
    count: int = 0
    workflow: Optional[Workflow] = None


class WorkflowsResponse(BaseModel):
    count: int = 0
    workflows: List[Workflow] = []
    windowing: Optional[Windowing] = None


# WORKFLOW VARIANTS ------------------------------------------------------------


class WorkflowVariantCreateRequest(BaseModel):
    workflow_variant: WorkflowVariantCreate


class WorkflowVariantEditRequest(BaseModel):
    workflow_variant: WorkflowVariantEdit


class WorkflowVariantQueryRequest(BaseModel):
    workflow_variant: Optional[WorkflowVariantQuery] = None
    #
    workflow_refs: Optional[List[Reference]] = None
    workflow_variant_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class WorkflowVariantResponse(BaseModel):
    count: int = 0
    workflow_variant: Optional[WorkflowVariant] = None


class WorkflowVariantsResponse(BaseModel):
    count: int = 0
    workflow_variants: List[WorkflowVariant] = []
    windowing: Optional[Windowing] = None


# WORKFLOW REVISIONS -----------------------------------------------------------


class WorkflowRevisionCreateRequest(BaseModel):
    workflow_revision: WorkflowRevisionCreate


class WorkflowRevisionEditRequest(BaseModel):
    workflow_revision: WorkflowRevisionEdit


class WorkflowRevisionQueryRequest(BaseModel):
    workflow_revision: Optional[WorkflowRevisionQuery] = None
    #
    workflow_refs: Optional[List[Reference]] = None
    workflow_variant_refs: Optional[List[Reference]] = None
    workflow_revision_refs: Optional[List[Reference]] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class WorkflowRevisionCommitRequest(BaseModel):
    workflow_revision: WorkflowRevisionCommit


class WorkflowRevisionRetrieveRequest(BaseModel):
    workflow_ref: Optional[Reference] = None
    workflow_variant_ref: Optional[Reference] = None
    workflow_revision_ref: Optional[Reference] = None
    #
    environment_ref: Optional[Reference] = None
    environment_variant_ref: Optional[Reference] = None
    environment_revision_ref: Optional[Reference] = None
    key: Optional[str] = None
    #
    resolve: Optional[bool] = None  # Optionally resolve embeds on retrieve


class WorkflowRevisionDeployRequest(BaseModel):
    workflow_ref: Optional[Reference] = None
    workflow_variant_ref: Optional[Reference] = None
    workflow_revision_ref: Optional[Reference] = None
    #
    environment_ref: Optional[Reference] = None
    environment_variant_ref: Optional[Reference] = None
    environment_revision_ref: Optional[Reference] = None
    key: Optional[str] = None
    #
    message: Optional[str] = None


class WorkflowRevisionsLogRequest(BaseModel):
    workflow: WorkflowRevisionsLog


class WorkflowRevisionResponse(BaseModel):
    count: int = 0
    workflow_revision: Optional[WorkflowRevision] = None
    resolution_info: Optional[ResolutionInfo] = None  # Included when resolve=True


class WorkflowRevisionsResponse(BaseModel):
    count: int = 0
    workflow_revisions: List[WorkflowRevision] = []
    windowing: Optional[Windowing] = None


# WORKFLOW REVISION RESOLUTION -------------------------------------------------


class WorkflowRevisionResolveRequest(BaseModel):
    workflow_ref: Optional[Reference] = None
    workflow_variant_ref: Optional[Reference] = None
    workflow_revision_ref: Optional[Reference] = None
    #
    workflow_revision: Optional[WorkflowRevision] = None
    #
    max_depth: Optional[int] = 10
    max_embeds: Optional[int] = 100
    error_policy: Optional[ErrorPolicy] = ErrorPolicy.EXCEPTION


class WorkflowRevisionResolveResponse(BaseModel):
    count: int = 0
    workflow_revision: Optional[WorkflowRevision] = None
    resolution_info: Optional[ResolutionInfo] = None


# WORKFLOW CATALOG -------------------------------------------------------------


class WorkflowCatalogTypeResponse(BaseModel):
    count: int = 0
    type: Optional[WorkflowCatalogType] = None


class WorkflowCatalogTypesResponse(BaseModel):
    count: int = 0
    types: List[WorkflowCatalogType] = []


class WorkflowCatalogTemplateResponse(BaseModel):
    count: int = 0
    template: Optional[WorkflowCatalogTemplate] = None


class WorkflowCatalogTemplatesResponse(BaseModel):
    count: int = 0
    templates: List[WorkflowCatalogTemplate] = []


class WorkflowCatalogPresetResponse(BaseModel):
    count: int = 0
    preset: Optional[WorkflowCatalogPreset] = None


class WorkflowCatalogPresetsResponse(BaseModel):
    count: int = 0
    presets: List[WorkflowCatalogPreset] = []


# SIMPLE WORKFLOWS -------------------------------------------------------------


class SimpleWorkflowCreateRequest(BaseModel):
    workflow: SimpleWorkflowCreate


class SimpleWorkflowEditRequest(BaseModel):
    workflow: SimpleWorkflowEdit


class SimpleWorkflowQueryRequest(BaseModel):
    workflow: Optional[SimpleWorkflowQuery] = None
    #
    include_archived: Optional[bool] = None
    #
    windowing: Optional[Windowing] = None


class SimpleWorkflowResponse(BaseModel):
    count: int = 0
    workflow: Optional[SimpleWorkflow] = None


class SimpleWorkflowsResponse(BaseModel):
    count: int = 0
    workflows: List[SimpleWorkflow] = []
