from typing import Dict, Union, Any
from uuid import UUID
from datetime import datetime
from collections import OrderedDict

from oss.src.utils.logging import get_module_logger

from oss.src.core.shared.dtos import Reference

from oss.src.core.tracing.dtos import (
    OTelSpanKind,
    OTelStatusCode,
    OTelSpan,
    OTelLink,
    OTelFlatSpans,
    Link,
    Query,
    FilteringException,
    Filtering,
    Condition,
    ComparisonOperator,
    NumericOperator,
    StringOperator,
    ListOperator,
    DictOperator,
    ExistenceOperator,
    Fields,
    _C_OPS,
    _N_OPS,
    _S_OPS,
    _L_OPS,
    _D_OPS,
    _E_OPS,
)

from oss.src.core.tracing.dtos import OTelAttributes


log = get_module_logger(__name__)

# ATTRIBUTES


def unmarshal_attributes(
    marshalled: OTelAttributes,
) -> OTelAttributes:
    """
    Unmarshals a dictionary of marshalled attributes into a nested dictionary

    Example:
    marshalled = {
        "ag.type": "tree",
        "ag.span_name": "root",
        "ag.node.children.0.name": "child1",
        "ag.node.children.1.name": "child2"
    }
    unmarshalled = {
        "ag": {
            "type": "tree",
            "node": {
                "name": "root",
                "children": [
                    {
                        "name": "child1",
                    },
                    {
                        "name": "child2",
                    }
                ]
            }
        }
    }
    """
    unmarshalled = {}

    for key, value in marshalled.items():
        keys = key.split(".")

        level = unmarshalled

        for i, part in enumerate(keys[:-1]):
            if part.isdigit():
                part = int(part)

                if not isinstance(level, list):
                    level = []

                while len(level) <= part:
                    level.append({})

                level = level[part]

            else:
                if part not in level:
                    level[part] = {} if not keys[i + 1].isdigit() else []

                level = level[part]

        last_key = keys[-1]

        if last_key.isdigit():
            last_key = int(last_key)

            if not isinstance(level, list):
                level = []

            while len(level) <= last_key:
                level.append(None)

            level[last_key] = value

        else:
            level[last_key] = value

    return unmarshalled


def marshall(
    d: Union[Dict[str, Any], list],
    parent_key: str = "",
    sep: str = ".",
) -> Dict[str, Any]:
    """Recursively flattens a nested dict/list into dot notation."""
    items = []

    if isinstance(d, dict):
        for k, v in d.items():
            new_key = f"{parent_key}{sep}{k}" if parent_key else k
            if isinstance(v, (dict, list)):
                items.extend(marshall(v, new_key, sep=sep).items())
            else:
                items.append((new_key, v))

    elif isinstance(d, list):
        for idx, v in enumerate(d):
            new_key = f"{parent_key}{sep}{idx}" if parent_key else str(idx)
            if isinstance(v, (dict, list)):
                items.extend(marshall(v, new_key, sep=sep).items())
            else:
                items.append((new_key, v))

    return dict(items)


def unmarshall(
    d: Dict[str, Any],
    sep: str = ".",
) -> Dict[str, Any]:
    items = {}

    for compound_key, value in d.items():
        keys = compound_key.split(sep)
        current = items

        for i, key in enumerate(keys):
            is_last = i == len(keys) - 1
            next_key = keys[i + 1] if not is_last else None
            is_index = key.isdigit()
            key = int(key) if is_index else key

            if is_last:
                if isinstance(current, list) and isinstance(key, int):
                    while len(current) <= key:
                        current.append(None)
                    current[key] = value
                elif isinstance(current, dict):
                    current[key] = value
            else:
                next_is_index = next_key.isdigit() if next_key else False

                if isinstance(current, list) and isinstance(key, int):
                    while len(current) <= key:
                        current.append([] if next_is_index else {})
                    if current[key] is None:
                        current[key] = [] if next_is_index else {}
                    current = current[key]
                elif isinstance(current, dict):
                    if key not in current:
                        current[key] = [] if next_is_index else {}
                    current = current[key]

    return items


# TREE


def parse_span_idx_to_span_id_tree(
    span_idx: Dict[str, OTelSpan],
) -> OrderedDict:
    span_id_tree = OrderedDict()
    index = {}

    def push(span_dto: OTelSpan) -> None:
        if span_dto.parent_id is None:
            span_id_tree[span_dto.span_id] = OrderedDict()
            index[span_dto.span_id] = span_id_tree[span_dto.span_id]
        elif span_dto.parent_id in index:
            index[span_dto.parent_id][span_dto.span_id] = OrderedDict()
            index[span_dto.span_id] = index[span_dto.parent_id][span_dto.span_id]

    for span_dto in sorted(span_idx.values(), key=lambda span_dto: span_dto.start_time):
        push(span_dto)

    return span_id_tree


def connect_children(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, dict],
) -> None:
    _connect_tree_dfs(spans_id_tree, spans_idx)


def _connect_tree_dfs(
    spans_id_tree: OrderedDict,
    spans_idx: Dict[str, OTelSpan],
):
    for span_id, children_spans_id_tree in spans_id_tree.items():
        children_spans_id_tree: OrderedDict

        parent_span = spans_idx[span_id]

        parent_span.spans = dict()

        _connect_tree_dfs(children_spans_id_tree, spans_idx)

        for child_span_id in children_spans_id_tree.keys():
            child_span_name = spans_idx[child_span_id].span_name
            if child_span_name not in parent_span.spans:
                parent_span.spans[child_span_name] = spans_idx[child_span_id]
            else:
                if not isinstance(parent_span.spans[child_span_name], list):
                    parent_span.spans[child_span_name] = [
                        parent_span.spans[child_span_name]
                    ]

                parent_span.spans[child_span_name].append(spans_idx[child_span_id])

        if len(parent_span.spans) == 0:
            parent_span.spans = None


# VALUES


def parse_ref_id_to_uuid(
    ref_id: str,
):
    clean_ref_id = None

    # HEX   # 0x31d6cfe04b9011ec800142010a8000b0
    if ref_id.startswith("0x") and len(ref_id) == (2 + 32):
        ref_id = ref_id[2:]

    # UUID # 31d6cfe0-4b90-11ec-8001-42010a8000b0
    # HEX  # 31d6cfe04b9011ec800142010a8000b0
    try:
        clean_ref_id = str(UUID(ref_id))
    except Exception as e:
        log.error(
            "ref_id must be a UUID, got %s [%s]",
            type(ref_id),
            ref_id,
        )
        raise TypeError() from e

    return clean_ref_id


def parse_ref_slug_to_str(
    ref_slug: str,
):
    clean_ref_slug = None

    try:
        clean_ref_slug = str(ref_slug)
    except Exception as e:
        log.error(
            "ref_slug must be a string, got %s [%s]",
            type(ref_slug),
            ref_slug,
        )
        raise TypeError() from e

    return clean_ref_slug


def parse_trace_id_to_uuid(
    trace_id: str,
):
    clean_trace_id = None

    # HEX   # 0x31d6cfe04b9011ec800142010a8000b0
    if trace_id.startswith("0x") and len(trace_id) == (2 + 32):
        trace_id = trace_id[2:]

    # UUID # 31d6cfe0-4b90-11ec-8001-42010a8000b0
    # HEX  # 31d6cfe04b9011ec800142010a8000b0
    try:
        clean_trace_id = str(UUID(trace_id))
    except Exception as e:
        log.error(
            "trace_id must be a UUID, got %s [%s]",
            type(trace_id),
            trace_id,
        )
        raise TypeError() from e

    return clean_trace_id


def parse_span_id_to_uuid(
    span_id: str,
):
    clean_span_id = None

    # HEX   # 0x31d6cfe04b9011ec
    if span_id.startswith("0x") and len(span_id) == (2 + 16):
        span_id = span_id[2:] + span_id[2:]

    # HEX   # 31d6cfe04b9011ec
    if len(span_id) == 16:
        span_id = span_id + span_id

    # UUID # 31d6cfe0-4b90-11ec-31d6-cfe04b9011ec
    # HEX  # 31d6cfe04b9011ec31d6cfe04b9011ec
    try:
        clean_span_id = str(UUID(span_id))
    except Exception as e:
        log.error(
            "span_id must be a UUID, got %s [%s]",
            type(span_id),
            span_id,
        )
        raise TypeError() from e

    return clean_span_id


def parse_trace_id_from_uuid(
    trace_id: Union[UUID, str],
):
    if isinstance(trace_id, UUID):
        return trace_id.hex

    if isinstance(trace_id, str):
        return UUID(trace_id).hex


def parse_span_id_from_uuid(
    span_id: Union[UUID, str],
):
    if isinstance(span_id, UUID):
        return span_id.hex[16:]

    if isinstance(span_id, str):
        return UUID(span_id).hex[16:]


def parse_span_kind_to_enum(
    span_kind: str,
):
    try:
        return OTelSpanKind(span_kind)

    except ValueError as e:
        log.error(f"Unsupported span_kind value: {span_kind}")

        raise FilteringException(
            f"Unsupported span_kind value: {span_kind}",
        ) from e


def parse_status_code_to_enum(
    status_code: str,
):
    try:
        return OTelStatusCode(status_code)

    except ValueError as e:
        log.error(f"Unsupported status_code value: {status_code}")

        raise FilteringException(
            f"Unsupported status_code value: {status_code}",
        ) from e


def parse_value_to_enum(value: str, enum: type) -> type:
    try:
        return enum(value)
    except ValueError as e:
        raise FilteringException(
            f"Unsupported condition value: '{value}'",
        ) from e


def parse_timestamp_to_datetime(ts):
    if isinstance(ts, datetime):
        return ts

    if isinstance(ts, str):
        try:
            ts = int(ts)
        except ValueError:
            return datetime.fromisoformat(ts)

    if isinstance(ts, int):
        digits = len(str(ts))
        # Heuristic based on digit length
        if digits == 10:  # seconds
            ts *= 1_000_000
        elif digits == 13:  # milliseconds
            ts *= 1_000
        elif digits == 16:  # microseconds
            pass
        elif digits == 19:  # nanoseconds
            ts //= 1_000  # lose some precision, but reasonable fallback
        else:  # assume microseconds
            raise FilteringException(f"Timestamp {ts} is ambiguous.")

        return datetime.fromtimestamp(ts / 1_000_000)

    return None  # or raise TypeError if desired


# CONDITIONS


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
                ).model_dump()
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

                if ref_id:
                    _values.append(
                        Reference(
                            id=parse_ref_id_to_uuid(ref_id),
                        ).model_dump(exclude_none=True)
                    )

                if ref_slug:
                    _values.append(
                        Reference(
                            slug=parse_ref_slug_to_str(ref_slug),
                        ).model_dump(exclude_none=True)
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


# def _parse_events_condition(condition: Condition) -> None: ...


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
    if condition.operator not in _C_OPS + _S_OPS + _L_OPS + _E_OPS:
        raise FilteringException(
            "'status_message' only supports comparison, string, list, and existence operators.",
        )

    if condition.operator in _S_OPS + _L_OPS and condition.value is None:
        raise FilteringException(
            "'status_message' value is required and thus never null for string and list operators.",
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


# FILTERING / CONDITION


def parse_filtering(filtering: Filtering) -> None:
    for condition in filtering.conditions:
        if isinstance(condition, Filtering):
            parse_filtering(condition)
        elif isinstance(condition, Condition):
            parse_condition(condition)
        else:
            raise FilteringException(
                f"Unsupported condition type '{type(condition)}'.",
            )


def parse_condition(condition: Condition) -> None:
    if condition.field == Fields.TRACE_ID:
        _parse_trace_id_condition(condition)
    elif condition.field == Fields.SPAN_ID:
        _parse_span_id_condition(condition)
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
    # elif condition.field == Fields.EVENTS:
    #     _parse_events_condition(condition)
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
    else:
        raise FilteringException(
            f"Unsupported condition field '{condition.field}'.",
        )


# INGEST / QUERY


def parse_ingest(span_dtos: OTelFlatSpans) -> None:
    pass


def parse_query(query: Query) -> None:
    parse_filtering(query.filtering)
