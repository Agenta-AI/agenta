# /agenta/sdk/models/running.py

from typing import Any, Dict, Optional, Union
from uuid import UUID
from urllib.parse import urlparse

from jsonschema.exceptions import SchemaError
from jsonschema import (
    Draft202012Validator,
    Draft201909Validator,
    Draft7Validator,
    Draft4Validator,
    Draft6Validator,
)
from pydantic import (
    BaseModel,
    ConfigDict,
    model_validator,
    ValidationError,
)

from agenta.sdk.models.shared import (
    TraceID,
    SpanID,
    Link,
    Reference,
    Lifecycle,
    Header,
    Metadata,
    Data,
    Schema,
    Status,
    Commit,
)


class JsonSchemas(BaseModel):
    parameters: Optional[Schema] = None
    inputs: Optional[Schema] = None
    outputs: Optional[Schema] = None


class WorkflowFlags(BaseModel):
    is_custom: Optional[bool] = None
    is_evaluator: Optional[bool] = None
    is_human: Optional[bool] = None


class WorkflowServiceInterface(BaseModel):
    version: str = "2025.07.14"

    uri: Optional[str] = None
    url: Optional[str] = None
    headers: Optional[Dict[str, Union[str, Reference]]] = None
    schemas: Optional[JsonSchemas] = None

    @model_validator(mode="after")
    def validate_jsonschemas_and_url(self) -> "WorkflowServiceInterface":
        errors = []

        if self.schemas:
            for key, schema in self.schemas.model_dump().items():
                try:
                    if not schema:
                        continue

                    validator_class = self._get_validator_class_from_schema(schema)
                    validator_class.check_schema(schema)
                except SchemaError as e:
                    errors.append(
                        {
                            "loc": ("schemas", key),
                            "msg": f"Invalid JSON Schema: {e.message}",
                            "type": "value_error.jsonschema",
                            "ctx": {"error": str(e)},
                            "input": schema,
                        }
                    )

        if self.url:
            if not self._is_valid_http_url(self.url):
                errors.append(
                    {
                        "loc": ("url",),
                        "msg": "Invalid HTTP(S) URL",
                        "type": "value_error.url",
                        "ctx": {"error": "Invalid URL format"},
                        "input": self.url,
                    }
                )

        if errors:
            raise ValidationError.from_exception_data(
                self.__class__.__name__,
                errors,  # type: ignore
            )

        return self

    @staticmethod
    def _get_validator_class_from_schema(schema: Dict[str, Any]):
        """Detect JSON Schema draft from $schema or fallback to 2020-12."""
        schema_uri = schema.get(
            "$schema", "https://json-schema.org/draft/2020-12/schema"
        )
        if "2020-12" in schema_uri:
            return Draft202012Validator
        elif "2019-09" in schema_uri:
            return Draft201909Validator
        elif "draft-07" in schema_uri:
            return Draft7Validator
        elif "draft-06" in schema_uri:
            return Draft6Validator
        elif "draft-04" in schema_uri:
            return Draft4Validator
        else:
            return Draft202012Validator

    @staticmethod
    def _is_valid_http_url(url: str) -> bool:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)


class WorkflowServiceConfiguration(BaseModel):
    script: Optional[Data] = None
    parameters: Optional[Data] = None


class WorkflowRevisionData(
    WorkflowServiceInterface,
    WorkflowServiceConfiguration,
):
    pass


class WorkflowRevision(
    Reference,
    Lifecycle,
    Header,
    Metadata,
    Commit,
):
    flags: Optional[WorkflowFlags] = None  # type: ignore

    data: Optional[WorkflowRevisionData] = None

    artifact_id: Optional[UUID] = None
    variant_id: Optional[UUID] = None


class WorkflowServiceStatus(Status):
    type: Optional[str] = None
    stacktrace: Optional[Union[list[str], str]] = None


class WorkflowServiceRequestData(BaseModel):
    revision: Optional[dict] = None
    parameters: Optional[dict] = None
    #
    testcase: Optional[dict] = None
    inputs: Optional[dict] = None
    #
    trace: Optional[dict] = None
    outputs: Optional[Any] = None


class WorkflowServiceResponseData(BaseModel):
    outputs: Optional[Any] = None


class WorkflowServiceBaseRequest(Metadata):
    version: str = "2025.07.14"

    interface: Optional[Union[WorkflowServiceInterface, Dict[str, Any]]] = None
    configuration: Optional[Union[WorkflowServiceConfiguration, Dict[str, Any]]] = None

    references: Optional[Dict[str, Union[Reference, Dict[str, Any]]]] = None
    links: Optional[Dict[str, Union[Link, Dict[str, Any]]]] = None

    secrets: Optional[Dict[str, Any]] = None
    credentials: Optional[str] = None

    @model_validator(mode="before")
    def _coerce_nested_models(cls, values: Dict[str, Any]) -> Dict[str, Any]:
        """Convert dicts into their respective Pydantic models."""
        if "interface" in values and isinstance(values["interface"], dict):
            values["interface"] = WorkflowServiceInterface(**values["interface"])

        if "configuration" in values and isinstance(values["configuration"], dict):
            values["configuration"] = WorkflowServiceConfiguration(
                **values["configuration"]
            )

        if "references" in values and isinstance(values["references"], dict):
            values["references"] = {
                k: (Reference(**v) if isinstance(v, dict) else v)
                for k, v in values["references"].items()
            }

        if "links" in values and isinstance(values["links"], dict):
            values["links"] = {
                k: (Link(**v) if isinstance(v, dict) else v)
                for k, v in values["links"].items()
            }

        return values


class WorkflowServiceRequest(WorkflowServiceBaseRequest):
    data: Optional[WorkflowServiceRequestData] = None


class WorkflowServiceBaseResponse(TraceID, SpanID):
    version: str = "2025.07.14"

    status: Optional[WorkflowServiceStatus] = WorkflowServiceStatus()


class WorkflowServiceBatchResponse(WorkflowServiceBaseResponse):
    data: Optional[WorkflowServiceResponseData] = None


class WorkflowServiceStreamResponse(WorkflowServiceBaseResponse):
    generator: Any  # Callable[[], AsyncGenerator[Any, None]]

    model_config = ConfigDict(arbitrary_types_allowed=True)

    async def iterator(self):
        async for item in self.generator():
            yield item


WorkflowServiceResponse = Union[
    WorkflowServiceBatchResponse,
    WorkflowServiceStreamResponse,
]
