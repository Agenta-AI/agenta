"""Filtering/query parsing helpers for tracing."""

from typing import Optional

from oss.src.utils.logging import get_module_logger
from oss.src.core.shared.dtos import Link, Reference
from oss.src.core.tracing.dtos import (
    Condition,
    Fields,
    Filtering,
    FilteringException,
    OTelFlatSpans,
    OTelSpanKind,
    OTelStatusCode,
    SpanType,
    StringOperator,
    TraceType,
    TracingQuery,
    _C_OPS,
    _D_OPS,
    _E_OPS,
    _L_OPS,
    _N_OPS,
    _S_OPS,
)

from .attributes import unmarshall
from .parsing import (
    parse_evt_name_to_str,
    parse_ref_id_to_uuid,
    parse_ref_slug_to_str,
    parse_ref_version_to_str,
    parse_span_id_to_uuid,
    parse_timestamp_to_datetime,
    parse_trace_id_to_uuid,
    parse_value_to_enum,
)

log = get_module_logger(__name__)


def _parse_trace_id_condition(condition: Condition) -> None:
    if condition.value is None:
        raise FilteringException(
            "'trace_id' is required and thus never null.",
        )

    if condition.operator not in _C_OPS + _L_OPS:
        raise FilteringException(
            "'trace_id' only supports comparison and list operators.",
        )

    if isinstance(condition.value, list):
        condition.value = [parse_trace_id_to_uuid(value) for value in condition.value]
    else:
        condition.value = parse_trace_id_to_uuid(condition.value)


def _parse_span_id_condition(condition: Condition) -> None:
    if condition.value is None:
        raise FilteringException(
            "'span_id' is required and thus never null.",
        )

    if condition.operator not in _C_OPS + _L_OPS:
        raise FilteringException(
            "'span_id' only supports comparison and list operators.",
        )

    if isinstance(condition.value, list):
        condition.value = [parse_span_id_to_uuid(value) for value in condition.value]
    else:
        condition.value = parse_span_id_to_uuid(condition.value)


def _parse_parent_id_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _L_OPS:
        raise FilteringException(
            "'parent_id' only supports comparison and list operators.",
        )

    if condition.value is None:
        pass
    elif isinstance(condition.value, list):
        condition.value = [parse_span_id_to_uuid(value) for value in condition.value]
    else:
        condition.value = parse_span_id_to_uuid(condition.value)


def _parse_attributes_condition(condition: Condition) -> None:
    if condition.key is None:
        raise FilteringException(
            "'attributes' key is required and thus never null.",
        )


def _parse_links_condition(condition: Condition) -> None:
    if condition.operator not in _L_OPS + _D_OPS + _E_OPS:
        raise FilteringException(
            "'links' only supports list, dict, and existence operators.",
        )

    if condition.operator in _L_OPS + _E_OPS and condition.key is not None:
        raise FilteringException(
            "'links' key is only supported for dict operators.",
        )

    if condition.operator in _E_OPS and condition.value is not None:
        raise FilteringException(
            "'links' value is not supported for existence operators.",
        )

    if condition.operator in _L_OPS:
        if not isinstance(condition.value, list):
            raise FilteringException(
                "'links' value must be one or more (possibly partial) links.",
            )

        if not all(isinstance(v, dict) for v in condition.value):
            raise FilteringException(
                "'links' value must be one or more (possibly partial) links.",
            )

    if condition.operator in _D_OPS:
        if not isinstance(condition.key, str) or not condition.key.startswith(
            "attributes."
        ):
            raise FilteringException(
                "'links' key must be a string in dot notation starting with 'attributes'.",
            )

    if condition.operator in _E_OPS:
        pass
    elif condition.operator in _L_OPS:
        try:
            for i, v in enumerate(condition.value):
                v: dict

                trace_id = v.get("trace_id")
                span_id = v.get("span_id")

                condition.value[i] = Link(
                    trace_id=parse_trace_id_to_uuid(trace_id) if trace_id else None,
                    span_id=parse_span_id_to_uuid(span_id) if span_id else None,
                ).model_dump(mode="json")
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise FilteringException(
                "'links' value must be one or more (possibly partial) links.",
            ) from e
    elif condition.operator in _D_OPS:
        try:
            unmarshall({condition.key: condition.value})
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise FilteringException(
                "'links' key must be a string in dot notation.",
            ) from e


def _parse_references_condition(condition: Condition) -> None:
    if condition.operator not in _L_OPS + _D_OPS + _E_OPS:
        raise FilteringException(
            "'references' only supports list, dict, and existence operators.",
        )

    if condition.operator in _L_OPS + _E_OPS and condition.key is not None:
        raise FilteringException(
            "'references' key is only supported for dict operators.",
        )

    if condition.operator in _E_OPS and condition.value is not None:
        raise FilteringException(
            "'references' value is not supported for existence operators.",
        )

    if condition.operator in _L_OPS:
        if not isinstance(condition.value, list):
            raise FilteringException(
                "'references' value must be one or more (possibly partial) references.",
            )

        if not all(isinstance(v, dict) for v in condition.value):
            raise FilteringException(
                "'references' value must be one or more (possibly partial) references.",
            )

    if condition.operator in _D_OPS:
        if not isinstance(condition.key, str) or not condition.key.startswith(
            "attributes."
        ):
            raise FilteringException(
                "'references' key must be a string in dot notation starting with 'attributes'.",
            )

    if condition.operator in _E_OPS:
        pass
    elif condition.operator in _L_OPS:
        try:
            _values = []

            for v in condition.value:
                v: dict

                ref_id = v.get("id")
                ref_slug = v.get("slug")
                ref_version = v.get("version")

                if ref_id:
                    _values.append(
                        Reference(
                            id=parse_ref_id_to_uuid(ref_id),
                        ).model_dump(mode="json", exclude_none=True)
                    )

                if ref_slug:
                    _values.append(
                        Reference(
                            slug=parse_ref_slug_to_str(ref_slug),
                        ).model_dump(mode="json", exclude_none=True)
                    )

                if ref_version:
                    _values.append(
                        Reference(
                            version=parse_ref_version_to_str(ref_version),
                        ).model_dump(mode="json", exclude_none=True)
                    )

            condition.value = _values
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error(e)
            raise FilteringException(
                "'references' value must be one or more (possibly partial) references.",
            ) from e
    elif condition.operator in _D_OPS:
        try:
            unmarshall({condition.key: condition.value})
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise FilteringException(
                "'references' key must be a string in dot notation.",
            ) from e


def _parse_events_condition(condition: Condition) -> None:
    if condition.operator not in _L_OPS + _D_OPS + _E_OPS:
        raise FilteringException(
            "'events' only supports list, dict, and existence operators.",
        )

    if condition.operator in _L_OPS + _E_OPS and condition.key is not None:
        raise FilteringException(
            "'events' key is only supported for dict operators.",
        )

    if condition.operator in _E_OPS and condition.value is not None:
        raise FilteringException(
            "'events' value is not supported for existence operators.",
        )

    if condition.operator in _L_OPS:
        if not isinstance(condition.value, list):
            raise FilteringException(
                "'events' value must be one or more (possibly partial) events.",
            )

        if not all(isinstance(v, dict) for v in condition.value):
            raise FilteringException(
                "'events' value must be one or more (possibly partial) events.",
            )

    if condition.operator in _D_OPS:
        if not isinstance(condition.key, str) or not condition.key.startswith(
            "attributes."
        ):
            raise FilteringException(
                "'events' key must be a string in dot notation starting with 'attributes'.",
            )

    if condition.operator in _E_OPS:
        pass
    elif condition.operator in _L_OPS:
        try:
            _values = []

            for v in condition.value:
                v: dict

                name = v.get("name")

                if name:
                    _values.append(dict(name=parse_evt_name_to_str(name)))

            condition.value = _values
        except Exception as e:  # pylint: disable=broad-exception-caught
            log.error(e)
            raise FilteringException(
                "'events' value must be one or more (possibly partial) events.",
            ) from e
    elif condition.operator in _D_OPS:
        try:
            unmarshall({condition.key: condition.value})
        except Exception as e:  # pylint: disable=broad-exception-caught
            raise FilteringException(
                "'events' key must be a string in dot notation.",
            ) from e


def _parse_enum_field_condition(condition: Condition, enum: type) -> None:
    if condition.operator not in _C_OPS + _L_OPS:
        raise FilteringException(
            f"'{condition.field}' only supports comparison and list operators.",
        )

    if condition.value is None:
        pass
    elif isinstance(condition.value, list):
        condition.value = [
            parse_value_to_enum(value, enum) for value in condition.value
        ]
    else:
        condition.value = parse_value_to_enum(condition.value, enum)


def _parse_string_field_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _N_OPS + _S_OPS + _L_OPS + _E_OPS:
        raise FilteringException(
            "'status_message' only supports comparison, numeric, string, list, and existence operators.",
        )

    if condition.operator in _N_OPS + _S_OPS + _L_OPS and condition.value is None:
        raise FilteringException(
            "'status_message' value is required and thus never null for numeric, string, and list operators.",
        )

    if condition.operator in _E_OPS and condition.value is not None:
        raise FilteringException(
            "'status_message' value is not supported for existence operators.",
        )

    if condition.value is None:
        pass
    elif isinstance(condition.value, list):
        condition.value = [str(value) for value in condition.value]
    else:
        condition.value = str(condition.value)


def _parse_timestamp_field_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _N_OPS + _S_OPS + _L_OPS:
        raise FilteringException(
            f"'{condition.field}' only supports comparison, numeric, string, and list operators.",
        )

    if condition.operator in _S_OPS and not isinstance(condition.value, str):
        raise FilteringException(
            f"'{condition.field}' only supports string operators with string values."
        )

    if condition.operator in _S_OPS and isinstance(condition.value, str):
        pass
    elif isinstance(condition.value, list):
        condition.value = [
            parse_timestamp_to_datetime(value) for value in condition.value
        ]
    else:
        condition.value = parse_timestamp_to_datetime(condition.value)


def _parse_uuid_field_condition(condition: Condition) -> None:
    if condition.operator not in _C_OPS + _L_OPS + _E_OPS:
        raise FilteringException(
            f"'{condition.field}' only supports comparison, list, and existence operators.",
        )

    if condition.operator in _L_OPS and condition.value is None:
        raise FilteringException(
            f"'{condition.field}' value is required and thus never null for list operators.",
        )

    if condition.value is None:
        pass
    elif isinstance(condition.value, list):
        condition.value = [parse_trace_id_to_uuid(value) for value in condition.value]
    else:
        condition.value = parse_trace_id_to_uuid(condition.value)


def _parse_fts_field_condition(condition: Condition) -> None:
    if condition.operator != StringOperator.CONTAINS:
        raise FilteringException(
            f"'{condition.field}' only supports full-text search operator: 'contains'.",
        )

    if condition.value is None:
        raise FilteringException(
            f"'{condition.field}' value is required and thus never null for full-text search.",
        )

    if not isinstance(condition.value, str):
        raise FilteringException(
            f"'{condition.field}' value must be a string for full-text search.",
        )


# FILTERING / CONDITION


def parse_filtering(
    filtering: Optional[Filtering] = None,
) -> None:
    if filtering is None:
        return

    for condition in filtering.conditions:
        if isinstance(condition, Filtering):
            parse_filtering(condition)
        elif isinstance(condition, Condition):
            parse_condition(condition)
        else:
            raise FilteringException(
                f"Unsupported condition type '{type(condition)}'.",
            )


def parse_condition(
    condition: Optional[Condition] = None,
) -> None:
    if condition is None:
        return

    if condition.field == Fields.TRACE_ID:
        _parse_trace_id_condition(condition)
    elif condition.field == Fields.TRACE_TYPE:
        _parse_enum_field_condition(condition, TraceType)
    elif condition.field == Fields.SPAN_ID:
        _parse_span_id_condition(condition)
    elif condition.field == Fields.SPAN_TYPE:
        _parse_enum_field_condition(condition, SpanType)
    elif condition.field == Fields.PARENT_ID:
        _parse_parent_id_condition(condition)
    elif condition.field == Fields.SPAN_KIND:
        _parse_enum_field_condition(condition, OTelSpanKind)
    elif condition.field == Fields.SPAN_NAME:
        _parse_string_field_condition(condition)
    elif condition.field == Fields.START_TIME:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.END_TIME:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.STATUS_CODE:
        _parse_enum_field_condition(condition, OTelStatusCode)
    elif condition.field == Fields.STATUS_MESSAGE:
        _parse_string_field_condition(condition)
    elif condition.field == Fields.ATTRIBUTES:
        _parse_attributes_condition(condition)
    elif condition.field == Fields.LINKS:
        _parse_links_condition(condition)
    elif condition.field == Fields.REFERENCES:
        _parse_references_condition(condition)
    elif condition.field == Fields.EVENTS:
        _parse_events_condition(condition)
    elif condition.field == Fields.CREATED_AT:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.UPDATED_AT:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.DELETED_AT:
        _parse_timestamp_field_condition(condition)
    elif condition.field == Fields.CREATED_BY_ID:
        _parse_uuid_field_condition(condition)
    elif condition.field == Fields.UPDATED_BY_ID:
        _parse_uuid_field_condition(condition)
    elif condition.field == Fields.DELETED_BY_ID:
        _parse_uuid_field_condition(condition)
    elif condition.field == Fields.CONTENT:
        _parse_fts_field_condition(condition)
    else:
        # raise FilteringException(
        #     f"Unsupported condition field '{condition.field}'.",
        # )
        log.warning(f"Unsupported condition field: {condition.field}")


# INGEST / QUERY


def parse_ingest(span_dtos: OTelFlatSpans) -> None:
    pass


def parse_query(query: TracingQuery) -> None:
    parse_filtering(query.filtering)
