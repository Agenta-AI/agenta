from datetime import datetime
from bson import ObjectId
from typing import Optional, List
from pydantic import BaseModel, Field


class Workspace(BaseModel):
    id: Optional[str]
    name: str
    description: Optional[str]
    type: Optional[str]
    
    
class CreateWorkspace(BaseModel):
    name: str
    description: Optional[str]
    type: Optional[str]
    organization_id: str


class WorkspaceUpdate(BaseModel):
    name: Optional[str]
    description: Optional[str]
    updated_at: Optional[datetime]

