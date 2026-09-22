from uuid import UUID
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    TemplateLoadCommand,
)
from oss.src.core.workflows.dtos import WorkflowRevisionData


class _StrictRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GatewayConnectionChoiceRequest(_StrictRequestModel):
    connection_key: str = Field(min_length=1, max_length=128)
    kind: Literal["gateway"]
    provider: Literal["composio"]
    integration: str = Field(pattern=r"^[a-z0-9]+(?:[_-][a-z0-9]+)*$")


class MCPConnectionChoiceRequest(_StrictRequestModel):
    connection_key: str = Field(min_length=1, max_length=128)
    kind: Literal["mcp"]
    server: str = Field(min_length=1, max_length=128)


class SkipConnectionChoiceRequest(_StrictRequestModel):
    connection_key: str = Field(min_length=1, max_length=128)
    kind: Literal["skip"]


TemplateConnectionChoiceRequest = Annotated[
    GatewayConnectionChoiceRequest
    | MCPConnectionChoiceRequest
    | SkipConnectionChoiceRequest,
    Field(discriminator="kind"),
]


class TemplateLoadRequest(_StrictRequestModel):
    source: InternalTemplateSource
    base_revision: WorkflowRevisionData
    ui_build_kit_enabled: bool = False
    ui_disabled_ops: list[str] = Field(default_factory=list, max_length=128)
    staging_session_id: str | None = Field(default=None, min_length=1, max_length=256)
    attachment_ids: list[UUID] = Field(default_factory=list, max_length=10)
    initial_message: str = Field(min_length=1, max_length=20_000)
    connection_choices: list[TemplateConnectionChoiceRequest] = Field(
        default_factory=list,
        max_length=64,
    )

    @model_validator(mode="before")
    @classmethod
    def reject_server_owned_fields(cls, value: Any) -> Any:
        # Native revision parameters are not template source/binding metadata.
        # Their own schema and compiler validate them; ordinary names such as
        # path, version, credentials and connection are legitimate there.
        if isinstance(value, dict):
            base = value.get("base_revision")
            if isinstance(base, dict) and isinstance(base.get("meta"), dict):
                if "_ag" in base["meta"]:
                    raise ValueError("'_ag' is server-owned and cannot be supplied.")
        return value

    @field_validator("initial_message")
    @classmethod
    def normalize_initial_message(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("initial_message must not be blank")
        return value

    def to_domain(self, *, request_key: str) -> TemplateLoadCommand:
        return TemplateLoadCommand.model_validate(
            {
                **self.model_dump(mode="json"),
                "request_key": request_key,
            }
        )
