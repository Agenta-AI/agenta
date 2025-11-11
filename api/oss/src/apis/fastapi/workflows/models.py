from typing import Optional, List

from pydantic import BaseModel

from oss.src.core.workflows.dtos import (
    WorkflowArtifact as Workflow,
    WorkflowVariant,
    WorkflowRevision,
)


class WorkflowRequest(BaseModel):
    workflow: Workflow


class WorkflowResponse(BaseModel):
    count: int
    workflow: Optional[Workflow] = None


class WorkflowsResponse(BaseModel):
    count: int
    workflows: List[Workflow] = []


class WorkflowVariantRequest(BaseModel):
    variant: WorkflowVariant


class WorkflowVariantResponse(BaseModel):
    count: int
    variant: Optional[WorkflowVariant] = None


class WorkflowVariantsResponse(BaseModel):
    count: int
    variants: List[WorkflowVariant] = []


class WorkflowRevisionRequest(BaseModel):
    revision: WorkflowRevision


class WorkflowRevisionResponse(BaseModel):
    count: int
    revision: Optional[WorkflowRevision] = None


class WorkflowRevisionsResponse(BaseModel):
    count: int
    revisions: List[WorkflowRevision] = []
