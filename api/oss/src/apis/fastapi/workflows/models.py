from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.shared.dtos import Windowing, Reference
from oss.src.core.workflows.dtos import (
    #
    Workflow,
    WorkflowCreate,
    WorkflowEdit,
    WorkflowQuery,
    WorkflowFork,
    WorkflowLog,
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


class WorkflowCreateRequest(BaseModel):
    workflow: WorkflowCreate


class WorkflowEditRequest(BaseModel):
    workflow: WorkflowEdit


class WorkflowQueryRequest(BaseModel):
    workflow: Optional[WorkflowQuery] = None
    workflow_refs: Optional[List[Reference]] = None
    include_archived: Optional[bool] = None
    windowing: Optional[Windowing] = None


class WorkflowRequest(BaseModel):
    workflow: Workflow


class WorkflowResponse(BaseModel):
    count: int = 0
    workflow: Optional[Workflow] = None


class WorkflowsResponse(BaseModel):
    count: int = 0
    workflows: List[Workflow] = []


class WorkflowVariantCreateRequest(BaseModel):
    workflow_variant: WorkflowVariantCreate


class WorkflowVariantEditRequest(BaseModel):
    workflow_variant: WorkflowVariantEdit


class WorkflowVariantQueryRequest(BaseModel):
    workflow_variant: Optional[WorkflowVariantQuery] = None
    workflow_refs: Optional[List[Reference]] = None
    workflow_variant_refs: Optional[List[Reference]] = None
    include_archived: Optional[bool] = None
    windowing: Optional[Windowing] = None


class WorkflowVariantResponse(BaseModel):
    count: int = 0
    workflow_variant: Optional[WorkflowVariant] = None


class WorkflowVariantsResponse(BaseModel):
    count: int = 0
    workflow_variants: List[WorkflowVariant] = []


class WorkflowRevisionCreateRequest(BaseModel):
    workflow_revision: WorkflowRevisionCreate


class WorkflowRevisionEditRequest(BaseModel):
    workflow_revision: WorkflowRevisionEdit


class WorkflowRevisionQueryRequest(BaseModel):
    workflow_revision: Optional[WorkflowRevisionQuery] = None
    workflow_refs: Optional[List[Reference]] = None
    workflow_variant_refs: Optional[List[Reference]] = None
    workflow_revision_refs: Optional[List[Reference]] = None
    include_archived: Optional[bool] = None
    windowing: Optional[Windowing] = None


class WorkflowRevisionCommitRequest(BaseModel):
    workflow_revision: WorkflowRevisionCommit


class WorkflowRevisionResponse(BaseModel):
    count: int = 0
    workflow_revision: Optional[WorkflowRevision] = None


class WorkflowRevisionsResponse(BaseModel):
    count: int = 0
    workflow_revisions: List[WorkflowRevision] = []


class WorkflowForkRequest(BaseModel):
    workflow: WorkflowFork


class WorkflowLogRequest(BaseModel):
    workflow: WorkflowLog


class WorkflowRevisionRetrieveRequest(BaseModel):
    workflow_variant_ref: Optional[Reference] = None
    workflow_revision_ref: Optional[Reference] = None
