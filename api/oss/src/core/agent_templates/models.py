from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from agenta.sdk.agents import SkillTemplate

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    TemplateSource,
    ResolvedTemplateSource,
)
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
    source: TemplateSource
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


class CompiledTemplate(StrictModel):
    workflow_name: str
    workflow_description: str
    revision_data: WorkflowRevisionData
    workspace: ParsedWorkspace
    first_message: str


class PreparedTemplateLoad(StrictModel):
    runtime_parameters: dict[str, Any] | None = None
    workflow_id: UUID
    workflow_slug: str
    variant_id: UUID
    revision_id: UUID
    resolved_source: ResolvedTemplateSource
    workspace: ParsedWorkspace
    first_message: str
    replayed: bool


class CatalogAuthorLink(StrictModel):
    kind: str = Field(min_length=1, max_length=64)
    url: str = Field(min_length=1, max_length=2048)
    label: str | None = Field(default=None, max_length=128)


class CatalogAuthor(StrictModel):
    schema_version: Literal[1]
    id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    name: str = Field(min_length=1, max_length=128)
    bio: str = Field(min_length=1, max_length=2000)
    avatar_url: str | None = Field(default=None, max_length=2048)
    links: list[CatalogAuthorLink] = Field(default_factory=list)


class CatalogMedia(StrictModel):
    kind: Literal["image", "video"]
    url: str = Field(min_length=1, max_length=2048)
    alt: str = Field(min_length=1, max_length=500)
    caption: str | None = Field(default=None, max_length=500)
    poster_url: str | None = Field(default=None, max_length=2048)


class CatalogTemplateTool(StrictModel):
    name: str = Field(min_length=1)
    description: str = Field(min_length=1)


class CatalogTemplateExample(StrictModel):
    prompt: str = Field(min_length=1)
    steps: list[str] = Field(min_length=1)
    reply: str = Field(min_length=1)
    artifacts: list[str] | None = None
    status: str | None = None


class CatalogTemplateDisplay(StrictModel):
    initials: str = Field(min_length=1, max_length=4)
    color: str = Field(pattern=r"^#[0-9A-Fa-f]{6}$")
    instructions_summary: str = Field(min_length=1)
    trigger: str = Field(min_length=1)
    trigger_description: str = Field(min_length=1)
    seed_message: str = Field(min_length=1)
    builder_message: str | None = None
    model: str = Field(min_length=1)
    # Keyed by package connection key; the package owns the connection itself.
    connection_tools: dict[str, list[CatalogTemplateTool]] = Field(default_factory=dict)
    example: CatalogTemplateExample | None = None


class CatalogTemplateMetadata(StrictModel):
    author_id: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
    display_name: str | None = Field(default=None, min_length=1)
    summary: str = Field(min_length=1)
    description: str | None = Field(default=None, min_length=1)
    category: str = Field(min_length=1)
    tags: list[str] = Field(default_factory=list)
    display: CatalogTemplateDisplay
    media: list[CatalogMedia] = Field(default_factory=list)


class CatalogTemplateRecord(StrictModel):
    latest: str = Field(min_length=1, max_length=128)
    versions: dict[str, str] = Field(min_length=1)
    # Unlisted records stay loadable by key but never appear in the gallery or website.
    listed: bool = True
    metadata: CatalogTemplateMetadata | None = None


class CatalogDocument(StrictModel):
    schema_version: Literal[1]
    templates: dict[str, CatalogTemplateRecord]


class AgentTemplateConnectionOption(StrictModel):
    slug: str
    scope: str | None = None
    tools: list[CatalogTemplateTool] | None = None


class AgentTemplateConnection(StrictModel):
    key: str
    role: str
    required: bool
    primary: AgentTemplateConnectionOption
    alternatives: list[str] = Field(default_factory=list)


class AgentTemplateEntry(StrictModel):
    key: str
    source: InternalTemplateSource
    version: str
    latest: str
    versions: list[str]
    digest: str
    name: str
    summary: str
    description: str
    category: str
    tags: list[str]
    author: CatalogAuthor
    initials: str
    color: str
    instructions_summary: str
    trigger: str
    trigger_description: str
    seed_message: str
    builder_message: str
    model: str
    tools_summary: str
    connections: list[AgentTemplateConnection]
    example: CatalogTemplateExample | None = None
    media: list[CatalogMedia] = Field(default_factory=list)
