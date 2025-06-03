from typing import Optional
from urllib.parse import urlparse
from uuid import UUID

from pydantic import BaseModel, model_validator, ValidationError

from jsonschema import (
    Draft202012Validator,
    Draft201909Validator,
    Draft7Validator,
    Draft4Validator,
    Draft6Validator,
)
from jsonschema.exceptions import SchemaError

from oss.src.core.shared.dtos import Tags

from oss.src.core.git.dtos import Artifact, Variant, Revision


class WorkflowData(BaseModel):
    service: Optional[dict] = None  # url, schema, kind, etc
    configuration: Optional[dict] = None  # parameters, variables, etc

    @model_validator(mode="after")
    def validate_all(self) -> "WorkflowData":
        errors = []

        if self.service and self.service.get("agenta") and self.service.get("format"):
            format = self.service.get("format")  # pylint: disable=redefined-builtin

            try:
                validator_class = self._get_validator_class_from_schema(format)
                validator_class.check_schema(format)
            except SchemaError as e:
                errors.append(
                    {
                        "loc": ("format",),
                        "msg": f"Invalid JSON Schema: {e.message}",
                        "type": "value_error",
                        "ctx": {"error": str(e)},
                        "input": format,
                    }
                )

        if self.service and self.service.get("agenta") and self.service.get("url"):
            url = self.service.get("url")

            if not self._is_valid_http_url(url):
                errors.append(
                    {
                        "loc": ("url",),
                        "msg": "Invalid HTTP(S) URL",
                        "type": "value_error.url",
                        "ctx": {"error": "Invalid URL format"},
                        "input": url,
                    }
                )

        if errors:
            raise ValidationError.from_exception_data(
                self.__class__.__name__,
                errors,
            )

        return self

    @staticmethod
    def _get_validator_class_from_schema(schema: dict):
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
            # fallback default if unknown $schema
            return Draft202012Validator

    @staticmethod
    def _is_valid_http_url(url: str) -> bool:
        parsed = urlparse(url)
        return parsed.scheme in ("http", "https") and bool(parsed.netloc)


class WorkflowFlags(BaseModel):
    is_custom: Optional[bool] = None
    is_evaluator: Optional[bool] = None
    is_human: Optional[bool] = None


class WorkflowArtifact(Artifact):
    flags: Optional[WorkflowFlags] = None


class WorkflowVariant(Variant):
    flags: Optional[WorkflowFlags] = None

    artifact_id: Optional[UUID] = None
    artifact: Optional[WorkflowArtifact] = None


class WorkflowRevision(Revision):
    data: Optional[WorkflowData] = None
    flags: Optional[WorkflowFlags] = None

    variant_id: Optional[UUID] = None
    variant: Optional[WorkflowVariant] = None


class WorkflowQuery(BaseModel):
    artifact_ref: Optional[WorkflowArtifact] = None
    variant_ref: Optional[WorkflowVariant] = None
    revision_ref: Optional[WorkflowRevision] = None

    flags: Optional[WorkflowFlags] = None
    meta: Optional[Tags] = None

    include_archived: Optional[bool] = None
