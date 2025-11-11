from typing import Optional, Tuple, List, Dict

from jsonschema import (
    Draft202012Validator,
    Draft7Validator,
    Draft4Validator,
    Draft6Validator,
    Draft201909Validator,
)

from fastapi import status, HTTPException


from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Flags, Tags, Meta, Data, Reference
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
    *,
    type: Optional[Dict[str, str]] = None,
    flags: Optional[Flags] = None,
    tags: Optional[Tags] = None,
    data: Optional[Data] = None,
    meta: Optional[Meta] = None,
    references: Optional[List[Reference]] = None,
) -> Attributes:
    attributes: Attributes = dict(
        ag=(
            dict(
                type=type,
                flags=flags,
                tags=tags,
                meta=meta,
                data=data,
                references=references,
            )
            if type or flags or tags or meta or data or references
            else None
        )
    )

    return attributes


def parse_from_attributes(
    attributes: Attributes,
) -> Tuple[
    Optional[Dict[str, str]],  # type
    Optional[Flags],  # flags
    Optional[Tags],  # tags
    Optional[Data],  # data
    Optional[Meta],  # meta
    Optional[List[Reference]],  # references
]:
    # TODO - add error handling
    ag: dict = attributes.get("ag", {})
    type: dict = ag.get("type", {})
    flags: dict = ag.get("flags")
    tags: dict = ag.get("tags")
    meta: dict = ag.get("meta")
    data: dict = ag.get("data")
    references = ag.get("references")

    return (
        type,
        flags,
        tags,
        meta,
        data,
        references,
    )


class AnnotationFlags(WorkflowFlags):
    is_sdk: Optional[bool] = None
    is_web: Optional[bool] = None
    is_evaluation: Optional[bool] = None
