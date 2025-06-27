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
    count: int = 0
    workflow: Optional[Workflow] = None


class WorkflowsResponse(BaseModel):
    count: int = 0
    workflows: List[Workflow] = []


class WorkflowVariantRequest(BaseModel):
    variant: WorkflowVariant


class WorkflowVariantResponse(BaseModel):
    count: int = 0
    variant: Optional[WorkflowVariant] = None


class WorkflowVariantsResponse(BaseModel):
    count: int = 0
    variants: List[WorkflowVariant] = []


class WorkflowRevisionRequest(BaseModel):
    revision: WorkflowRevision


class WorkflowRevisionResponse(BaseModel):
    count: int = 0
    revision: Optional[WorkflowRevision] = None


class WorkflowRevisionsResponse(BaseModel):
    count: int = 0
    revisions: List[WorkflowRevision] = []
