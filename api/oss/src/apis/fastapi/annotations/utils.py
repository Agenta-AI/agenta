from typing import Optional, Tuple

from jsonschema import (
    Draft202012Validator,
    Draft7Validator,
    Draft4Validator,
    Draft6Validator,
    Draft201909Validator,
)

from fastapi import status, HTTPException


from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import References, Flags, Data, Meta
from oss.src.core.tracing.dtos import Attributes
from oss.src.core.workflows.dtos import WorkflowFlags


log = get_module_logger(__name__)


def _get_jsonschema_validator(
    format: dict,  # pylint: disable=redefined-builtin
):
    schema_uri = format.get(
        "$schema",
        "https://json-schema.org/draft/2020-12/schema",
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
    return Draft202012Validator  # fallback


def validate_data_against_schema(
    data: dict,
    schema: dict,  # pylint: disable=redefined-builtin
):
    validator_class = _get_jsonschema_validator(schema)
    validator = validator_class(schema)

    errors = list(validator.iter_errors(data))

    if errors:
        details = []
        for e in errors:
            loc = list(e.absolute_path)
            msg = e.message
            details.append(
                {
                    "loc": ["body", "annotation", "data"] + loc,
                    "msg": msg,
                    "type": "value_error.json_schema",
                }
            )

        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=details
        )


def parse_into_attributes(
    data: Optional[Data] = None,
    meta: Optional[Meta] = None,
    references: Optional[References] = None,
    flags: Optional[Flags] = None,
) -> Attributes:
    # TODO - add error handling

    attributes: Attributes = dict(
        agenta=(
            dict(
                data=data,
                meta=meta,
                references=references,
                flags=flags,
            )
            if (data or meta or references or flags)
            else None
        )
    )

    return attributes


def parse_from_attributes(
    attributes: Attributes,
) -> Tuple[
    Optional[Data],  # data
    Optional[Meta],  # meta
    Optional[References],  # references
    Optional[Flags],  # flags
]:
    # TODO - add error handling
    agenta: dict = attributes.get("agenta", {})
    data: dict = agenta.get("data")
    meta: dict = agenta.get("meta")
    references = agenta.get("references")
    flags: dict = agenta.get("flags")

    return (
        data,
        meta,
        references,
        flags,
    )


class AnnotationFlags(WorkflowFlags):
    is_sdk: Optional[bool] = False
    is_web: Optional[bool] = False
