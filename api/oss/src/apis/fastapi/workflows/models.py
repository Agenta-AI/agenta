from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import (
    Windowing,
    Reference,
)
from oss.src.core.workflows.dtos import (
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
    resolve: bool = False  # Optionally resolve embeds on retrieve


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
