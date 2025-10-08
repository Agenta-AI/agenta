from jsonschema import (
    Draft202012Validator,
    Draft7Validator,
    Draft4Validator,
    Draft6Validator,
    Draft201909Validator,
)

from fastapi import status, HTTPException


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
