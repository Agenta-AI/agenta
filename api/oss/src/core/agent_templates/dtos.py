from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from oss.src.core.workflows.dtos import WorkflowRevisionData


class InternalTemplateSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["internal"] = "internal"
    key: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class TemplateSourcePin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1, max_length=128)
    digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class ResolvedTemplateSource(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    source: InternalTemplateSource
    root: Path
    version: str
    digest: str


class GatewayTemplateChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_key: str
    kind: Literal["gateway"]
    provider: str
    integration: str


class MCPTemplateChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_key: str
    kind: Literal["mcp"]
    server: str


class SkipTemplateChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_key: str
    kind: Literal["skip"]


TemplateConnectionChoice = Annotated[
    GatewayTemplateChoice | MCPTemplateChoice | SkipTemplateChoice,
    Field(discriminator="kind"),
]


class TemplateLoadCommand(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: InternalTemplateSource
    base_revision: WorkflowRevisionData
    initial_message: str
    connection_choices: list[TemplateConnectionChoice] = Field(default_factory=list)
    request_key: str


class TemplateLoadResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workflow_id: UUID
    workflow_slug: str
    variant_id: UUID
    revision_id: UUID
    session_id: str
    execution_id: str
    input_id: UUID
    replayed: bool
