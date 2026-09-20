from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from agenta.sdk.agents import SkillTemplate

from oss.src.core.agent_templates.dtos import InternalTemplateSource
from oss.src.core.workflows.dtos import WorkflowRevisionData


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GatewayConnectionOption(StrictModel):
    kind: Literal["gateway"]
    provider: Literal["composio"]
    integration: str = Field(min_length=1)


class MCPConnectionOption(StrictModel):
    kind: Literal["mcp"]
    server: str = Field(min_length=1)


TemplateConnectionOption = Annotated[
    GatewayConnectionOption | MCPConnectionOption,
    Field(discriminator="kind"),
]


class TemplatePermissions(StrictModel):
    default: Literal["inherit", "allow", "ask", "deny"] | None = None
    tools: dict[str, Literal["inherit", "allow", "ask", "deny"]] = Field(
        default_factory=dict
    )


class TemplateConnectionPolicy(StrictModel):
    permissions: TemplatePermissions | None = None


class TemplateConnectionRequirement(StrictModel):
    key: str
    required: bool
    purpose: str = Field(min_length=1)
    options: list[TemplateConnectionOption] = Field(min_length=1)
    policy: TemplateConnectionPolicy | None = None
    setup_notes: str | None = None


class ScheduleTrigger(StrictModel):
    type: Literal["schedule"]
    schedule: str = Field(min_length=1)


class SubscriptionTrigger(StrictModel):
    type: Literal["subscription"]
    connection: str
    event_key: str = Field(min_length=1)
    trigger_config: dict[str, Any] | None = None


TemplateAutomationTrigger = Annotated[
    ScheduleTrigger | SubscriptionTrigger,
    Field(discriminator="type"),
]


class TemplateAutomationRecipe(StrictModel):
    key: str
    name: str = Field(min_length=1)
    required: bool
    trigger: TemplateAutomationTrigger
    inputs_fields: Any = None
    setup_notes: str | None = None


class WorkspaceFileDeclaration(StrictModel):
    type: Literal["file"]
    source: str
    path: str


class WorkspaceDirectoryDeclaration(StrictModel):
    type: Literal["directory"]
    path: str


WorkspaceEntryDeclaration = Annotated[
    WorkspaceFileDeclaration | WorkspaceDirectoryDeclaration,
    Field(discriminator="type"),
]


class WorkspaceDeclaration(StrictModel):
    entries: list[WorkspaceEntryDeclaration]


class TemplateAgentDeclaration(StrictModel):
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)
    instructions: str
    setup: str | None = None
    skills: list[str] = Field(default_factory=list)
    connections: list[TemplateConnectionRequirement] = Field(default_factory=list)
    automations: list[TemplateAutomationRecipe] = Field(default_factory=list)
    workspace: WorkspaceDeclaration = Field(
        default_factory=lambda: WorkspaceDeclaration(entries=[])
    )


class AgentaExtensionManifest(StrictModel):
    schema_version: Literal[1]
    entry: str
    agents: dict[str, TemplateAgentDeclaration]


class ParsedWorkspaceFile(StrictModel):
    source: str
    path: str
    content: bytes


class ParsedWorkspace(StrictModel):
    files: list[ParsedWorkspaceFile] = Field(default_factory=list)
    directories: list[str] = Field(default_factory=list)


class ParsedMCPServer(StrictModel):
    name: str
    transport: Literal["streamable-http"] = "streamable-http"
    url: str


class ParsedTemplateAgent(StrictModel):
    key: str
    name: str
    description: str
    instructions: str
    setup: str | None = None
    connections: list[TemplateConnectionRequirement] = Field(default_factory=list)
    automations: list[TemplateAutomationRecipe] = Field(default_factory=list)


class ParsedTemplatePackage(StrictModel):
    source: InternalTemplateSource
    version: str
    digest: str
    agent: ParsedTemplateAgent
    skills: list[SkillTemplate] = Field(default_factory=list)
    workspace: ParsedWorkspace = Field(default_factory=ParsedWorkspace)
    mcp_servers: dict[str, ParsedMCPServer] = Field(default_factory=dict)


class UnresolvedTemplateBinding(StrictModel):
    connection_key: str
    purpose: str
    setup_notes: str | None = None
    selected_option: dict[str, Any] | None = None


class TemplateBindingPlan(StrictModel):
    tools: list[dict[str, Any]] = Field(default_factory=list)
    mcps: list[dict[str, Any]] = Field(default_factory=list)
    unresolved: list[UnresolvedTemplateBinding] = Field(default_factory=list)


class InstalledSkillRef(StrictModel):
    name: str
    workflow_id: UUID
    workflow_slug: str


class CompiledTemplate(StrictModel):
    workflow_name: str
    workflow_description: str
    revision_data: WorkflowRevisionData
    workspace: ParsedWorkspace
    first_message: str
