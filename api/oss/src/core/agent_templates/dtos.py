from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Discriminator, Field, Tag

from oss.src.core.workflows.dtos import WorkflowRevisionData


class InternalTemplateSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["internal"] = "internal"
    key: str = Field(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")


class TemplateSourcePin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1, max_length=128)
    digest: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")


class UploadTemplateSource(BaseModel):
    """A zip the user uploaded as a staged session attachment.

    Attachments are immutable once ready (the row keeps a content digest), so the
    reference itself pins the bytes.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["upload"] = "upload"
    staging_session_id: str = Field(min_length=1, max_length=256)
    attachment_id: UUID


class SessionFileTemplateSource(BaseModel):
    """A zip in a session's working directory, such as one an agent wrote in chat.

    The file is mutable, so load requires the pin that validation returned and
    rejects bytes that no longer match it.
    """

    model_config = ConfigDict(extra="forbid")

    kind: Literal["session_file"] = "session_file"
    session_id: str = Field(min_length=1, max_length=256)
    path: str = Field(min_length=1, max_length=1024)
    pin: TemplateSourcePin | None = None


ArchiveTemplateSource = UploadTemplateSource | SessionFileTemplateSource


def _source_kind(value: Any) -> str:
    # Callers that predate the source union send an internal key without a kind.
    if isinstance(value, dict):
        return value.get("kind", "internal")
    return getattr(value, "kind", "internal")


TemplateSource = Annotated[
    Annotated[InternalTemplateSource, Tag("internal")]
    | Annotated[UploadTemplateSource, Tag("upload")]
    | Annotated[SessionFileTemplateSource, Tag("session_file")],
    Discriminator(_source_kind),
]


class ResolvedTemplateSource(BaseModel):
    model_config = ConfigDict(extra="forbid", arbitrary_types_allowed=True)

    source: TemplateSource
    root: Path
    version: str
    digest: str
    # The package's own plugin name. Archive sources have no catalog key.
    package_key: str | None = None

    @property
    def key(self) -> str:
        if isinstance(self.source, InternalTemplateSource):
            return self.source.key
        if not self.package_key:
            raise ValueError("An archive template source needs its package key.")
        return self.package_key


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

    source: TemplateSource
    base_revision: WorkflowRevisionData
    ui_build_kit_enabled: bool = False
    ui_disabled_ops: list[str] = Field(default_factory=list, max_length=128)
    ui_op_permissions: dict[str, Literal["allow", "ask"]] = Field(
        default_factory=dict, max_length=128
    )
    staging_session_id: str | None = Field(default=None, min_length=1, max_length=256)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=10)
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


class TemplateValidationIssue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    # Package-relative file, and the manifest field inside it when one applies.
    path: str | None = None
    field: str | None = None
    message: str
    next_step: str | None = None


class TemplateValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    valid: bool
    version: str | None = None
    digest: str | None = None
    supported_schema_versions: list[str]
    issues: list[TemplateValidationIssue] = Field(default_factory=list)
