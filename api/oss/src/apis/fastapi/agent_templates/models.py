from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    TemplateLoadCommand,
)
from oss.src.core.workflows.dtos import WorkflowRevisionData


_FORBIDDEN_INPUT_KEYS = {
    "_ag",
    "archive",
    "connection",
    "connection_id",
    "credentials",
    "digest",
    "execution_id",
    "mcp_endpoint_slug",
    "path",
    "resolved_connection_slug",
    "secret",
    "secret_id",
    "session_id",
    "version",
    "workflow_id",
}


_MODEL_CONNECTION_PATHS = {
    ("base_revision", "parameters", "agent", "llm", "connection"),
    (
        "base_revision",
        "schemas",
        "parameters",
        "properties",
        "agent",
        "default",
        "llm",
        "connection",
    ),
}


def _find_forbidden_key(value: Any, path: tuple[str, ...] = ()) -> str | None:
    if isinstance(value, dict):
        for key, child in value.items():
            child_path = (*path, str(key))
            # Model auth selection is authored by the user, unlike tool bindings.
            if (
                str(key).lower() in _FORBIDDEN_INPUT_KEYS
                and child_path not in _MODEL_CONNECTION_PATHS
            ):
                return str(key)
            found = _find_forbidden_key(child, child_path)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = _find_forbidden_key(child, (*path, "[]"))
            if found is not None:
                return found
    return None


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
    initial_message: str = Field(min_length=1, max_length=20_000)
    connection_choices: list[TemplateConnectionChoiceRequest] = Field(
        default_factory=list,
        max_length=64,
    )

    @model_validator(mode="before")
    @classmethod
    def reject_server_owned_fields(cls, value: Any) -> Any:
        found = _find_forbidden_key(value)
        if found is not None:
            raise ValueError(f"'{found}' is server-owned and cannot be supplied.")
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
