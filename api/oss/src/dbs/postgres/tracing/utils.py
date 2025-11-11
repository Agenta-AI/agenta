from typing import Any, Optional, List, Dict, Union
from datetime import datetime
from hashlib import blake2b
from json import dumps

from sqlalchemy import and_, or_, not_, cast, Column, text, bindparam, Text
from sqlalchemy import TIMESTAMP, Enum, Integer, String, Boolean, Float
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import false, func, ClauseElement, ColumnElement


from oss.src.utils.logging import get_module_logger

from oss.src.dbs.postgres.tracing.dbes import SpanDBE

from oss.src.core.tracing.dtos import (
    Filtering,
    Condition,
    TextOptions,
    ListOptions,
    LogicalOperator,
    ComparisonOperator,
    NumericOperator,
    StringOperator,
    ListOperator,
    DictOperator,
    ExistenceOperator,
)
from oss.src.core.tracing.dtos import (
    Link,
    FilteringException,
    Fields,
    Filtering,
    Condition,
    ComparisonOperator,
    NumericOperator,
    StringOperator,
    ListOperator,
    ExistenceOperator,
)
from oss.src.core.shared.dtos import Reference

log = get_module_logger(__name__)

# UTILS


def _to_nested_value(
    key: str,
    value: Any,
) -> Dict[str, Any]:
    for part in reversed(key.split(".")):
        try:
            idx = int(part)
            value = [value] if not isinstance(value, list) else value
            d = []
            d.extend([{}] * (idx + 1))
            d[idx] = value
            value = d
        except ValueError:
            value = {part: value}

    return value


# OPERATORS


def _handle_comparison_operator(
    *,
    attribute: ColumnElement,
    operator: ComparisonOperator,
    value: Optional[Any] = None,
    key: Optional[str] = None,
) -> List[ClauseElement]:
    clauses = []

    if key is not None:
        value = _to_nested_value(key, value)
        value = dumps(value)
        value = bindparam(None, value, type_=Text)
        value = cast(value, JSONB)

        if operator == ComparisonOperator.IS:
            return [attribute.contains(value)]
        elif operator == ComparisonOperator.IS_NOT:
            return [not_(attribute.contains(value))]

    else:
        if operator == ComparisonOperator.IS:
            if value is None:
                clauses.append(attribute.is_(None))
            else:
                clauses.append(attribute == value)
        elif operator == ComparisonOperator.IS_NOT:
            if value is None:
                clauses.append(attribute.isnot(None))
            else:
                clauses.append(attribute != value)

    return clauses


def _handle_numeric_operator(
    *,
    attribute: ColumnElement,
    operator: NumericOperator,
    value: Union[int, float, str, list],
    key: Optional[str] = None,
) -> List[ClauseElement]:
    clauses = []

    if key is not None:
        clauses.append(attribute.has_key(key))

        attribute = attribute[key].astext  # defaults to string

        if isinstance(value, int):
            attribute = cast(attribute, Integer)
        elif isinstance(value, float):
            attribute = cast(attribute, Float)
        elif isinstance(value, list):
            if all(isinstance(v, int) for v in value):
                attribute = cast(attribute, Integer)
            elif all(isinstance(v, float) for v in value):
                attribute = cast(attribute, Float)
            elif all(isinstance(v, str) for v in value):
                attribute = cast(attribute, String)
            else:
                attribute = cast(attribute, String)
        else:
            attribute = cast(attribute, String)

    if operator == NumericOperator.EQ:
        clauses.append(attribute == value)
    elif operator == NumericOperator.NEQ:
        clauses.append(attribute != value)
    elif operator == NumericOperator.GT:
        clauses.append(attribute > value)
    elif operator == NumericOperator.LT:
        clauses.append(attribute < value)
    elif operator == NumericOperator.GTE:
        clauses.append(attribute >= value)
    elif operator == NumericOperator.LTE:
        clauses.append(attribute <= value)
    elif operator == NumericOperator.BETWEEN:
        clauses.append(attribute.between(value[0], value[1]))

    return clauses


def _handle_string_operator(
    *,
    attribute: ColumnElement,
    operator: StringOperator,
    value: str,
    options: Optional[TextOptions] = None,
    key: Optional[str] = None,
) -> List[ColumnElement]:
    clauses: List[ColumnElement] = []

    if not isinstance(options, TextOptions):
        options = TextOptions()

    if key is not None:
        clauses.append(attribute.has_key(key))

        attribute = attribute[key].astext

        attribute = cast(attribute, String)

    case_sensitive = options.case_sensitive if options else False
    exact_match = options.exact_match if options else False

    if operator == StringOperator.STARTSWITH:
        clauses.append(
            attribute.startswith(value)  # --------
            if case_sensitive
            else attribute.ilike(f"{value}%")
        )
    elif operator == StringOperator.ENDSWITH:
        clauses.append(
            attribute.endswith(value)  # ----------
            if case_sensitive
            else attribute.ilike(f"%{value}")
        )
    elif operator == StringOperator.CONTAINS:
        clauses.append(
            attribute.contains(value)  # ----------
            if case_sensitive
            else attribute.ilike(f"%{value}%")
        )
    elif operator == StringOperator.LIKE:
        clauses.append(
            attribute.like(value)  # --------------
            if case_sensitive
            else attribute.ilike(value)
        )
    elif operator == StringOperator.MATCHES:
        if exact_match:
            clauses.append(
                attribute == value  # -------------
                if case_sensitive
                else attribute.ilike(value)
            )
        else:
            clauses.append(
                attribute.like(f"%{value}%")  # ---
                if case_sensitive
                else attribute.ilike(f"%{value}%")
            )

    return clauses


def _handle_list_operator(
    attribute: ColumnElement,
    operator: ListOperator,
    value: List[Any],
    options: Optional[ListOptions] = None,
    key: Optional[str] = None,
    marshalled: Optional[bool] = False,
) -> List[ClauseElement]:
    clauses: List[ClauseElement] = []

    if not isinstance(options, ListOptions):
        options = ListOptions()

    subclauses: List[ClauseElement] = []

    if key is not None and not marshalled:
        attribute = attribute[key]
        for v in value:
            bound = bindparam(None, f"[{v}]", type_=Text)
            casted = cast(bound, JSONB)
            subclauses.append(attribute.contains(casted))

    elif marshalled:
        for v in value:
            bound = bindparam(None, dumps([v]), type_=Text)  # Wrap in array
            casted = cast(bound, JSONB)
            subclauses.append(attribute.contains(casted))

    else:
        if operator == ListOperator.IN:
            if options.all:
                for v in value:
                    clauses.append(attribute.in_([v]))
            else:
                clauses.append(attribute.in_(value))
            return clauses
        elif operator == ListOperator.NOT_IN:
            if options.all:
                for v in value:
                    clauses.append(attribute.notin_([v]))
            else:
                clauses.append(attribute.notin_(value))
            return clauses

    if operator == ListOperator.IN:
        if options.all:
            clauses.extend(subclauses)
        else:
            clauses.append(or_(*subclauses))
    elif operator == ListOperator.NOT_IN:
        if options.all:
            clauses.extend([not_(sc) for sc in subclauses])
        else:
            clauses.append(not_(or_(*subclauses)))

    return clauses


def _handle_dict_operator(
    attribute: ColumnElement,
    operator: DictOperator,
    key: str,
    value: Any,
    marshalled: bool = False,
) -> List[ClauseElement]:
    clauses: List[ClauseElement] = []

    if not marshalled:
        attribute = attribute[key]

        if operator == DictOperator.HAS:
            clauses.append(attribute == value)
        elif operator == DictOperator.HAS_NOT:
            clauses.append(attribute != value)

    else:
        value = [{key: value}]
        value = bindparam(None, dumps(value), type_=Text)
        value = cast(value, JSONB)

        if operator == DictOperator.HAS:
            clauses.append(attribute.contains(value))
        elif operator == DictOperator.HAS_NOT:
            clauses.append(not_(attribute.contains(value)))

    return clauses


def _handle_existence_operator(
    attribute: ColumnElement,
    operator: ListOperator,
    key: Optional[str] = None,
) -> List[ClauseElement]:
    clauses = []

    if operator == ExistenceOperator.EXISTS:
        if key:
            clauses.append(attribute.op("?")(key))
        else:
            clauses.append(attribute.isnot(None))

    elif operator == ExistenceOperator.NOT_EXISTS:
        if key:
            clauses.append(not_(attribute.op("?")(key)))
        else:
            clauses.append(attribute.is_(None))

    return clauses


# FIELDS


def _handle_attributes_field(
    condition: Condition,
) -> List[ClauseElement]:
    # ------------------------- #
    field = condition.field
    key = condition.key
    value = condition.value
    options = condition.options
    operator = condition.operator
    attribute: Column = getattr(SpanDBE, field)
    # ------------------------- #

    clauses = []

    if isinstance(operator, ComparisonOperator):
        clauses.extend(
            _handle_comparison_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                key=key,
            )
        )
    elif isinstance(operator, NumericOperator):
        clauses.extend(
            _handle_numeric_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                key=key,
            )
        )
    elif isinstance(operator, StringOperator):
        clauses.extend(
            _handle_string_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                key=key,
            )
        )
    elif isinstance(operator, ListOperator):
        clauses.extend(
            _handle_list_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                options=options,
                key=key,
            )
        )

    elif isinstance(operator, ExistenceOperator):
        clauses.extend(
            _handle_existence_operator(
                attribute=attribute,
                operator=operator,
                key=key,
            )
        )

    return clauses


def _handle_list_field(
    condition: Condition,
) -> List[ClauseElement]:
    # ------------------------- #
    field = condition.field
    key = condition.key
    value = condition.value
    options = condition.options
    operator = condition.operator
    attribute = getattr(SpanDBE, field)
    # ------------------------- #

    clauses: List[ClauseElement] = []

    if isinstance(operator, ListOperator):
        clauses.extend(
            _handle_list_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                options=options,
                marshalled=True,
            )
        )

    elif isinstance(operator, DictOperator):
        clauses.extend(
            _handle_dict_operator(
                attribute=attribute,
                operator=operator,
                key=key,
                value=value,
                marshalled=True,
            )
        )

    elif isinstance(operator, ExistenceOperator):
        clauses.extend(
            _handle_existence_operator(
                attribute=attribute,
                operator=operator,
                key=None,
            )
        )

    return clauses


# def _handle_events_field(
#     condition: Condition,
# ) -> List[ClauseElement]: ...


def _handle_enum_field(
    condition: Condition,
) -> List[ClauseElement]:
    # ------------------------- #
    field = condition.field
    # key = condition.key
    value = condition.value
    options = condition.options
    operator = condition.operator
    attribute: Column = getattr(SpanDBE, field)
    # ------------------------- #

    clauses = []

    if isinstance(operator, ComparisonOperator):
        clauses.extend(
            _handle_comparison_operator(
                attribute=attribute,
                operator=operator,
                value=value,
            )
        )
    elif isinstance(operator, ListOperator):
        clauses.extend(
            _handle_list_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                options=options,
            )
        )

    return clauses


def _handle_string_field(
    condition: Condition,
) -> List[ClauseElement]:
    # ------------------------- #
    field = condition.field
    # key = condition.key
    value = condition.value
    options = condition.options
    operator = condition.operator
    attribute: Column = getattr(SpanDBE, field)
    # ------------------------- #

    clauses = []

    if isinstance(operator, ComparisonOperator):
        clauses.extend(
            _handle_comparison_operator(
                attribute=attribute,
                operator=operator,
                value=value,
            )
        )
    elif isinstance(operator, StringOperator):
        clauses.extend(
            _handle_string_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                options=options,
            )
        )
    elif isinstance(operator, ListOperator):
        clauses.extend(
            _handle_list_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                options=options,
            )
        )

    elif isinstance(operator, ExistenceOperator):
        clauses.extend(
            _handle_existence_operator(
                attribute=attribute,
                operator=operator,
                key=None,
            )
        )

    return clauses


def _handle_timestamp_field(
    condition: Condition,
) -> List[ClauseElement]:
    # ------------------------- #
    field = condition.field
    # key = condition.key
    value = condition.value
    options = condition.options
    operator = condition.operator
    attribute: Column = getattr(SpanDBE, field)
    # ------------------------- #

    clauses = []

    if isinstance(operator, ComparisonOperator):
        clauses.extend(
            _handle_comparison_operator(
                attribute=attribute,
                operator=operator,
                value=value,
            )
        )
    elif isinstance(operator, NumericOperator):
        clauses.extend(
            _handle_numeric_operator(
                attribute=attribute,
                operator=operator,
                value=value,
            )
        )
    elif isinstance(operator, StringOperator):
        clauses.extend(
            _handle_string_operator(
                attribute=cast(attribute, String),
                operator=operator,
                value=value,
                options=options,
            )
        )
    elif isinstance(operator, ListOperator):
        clauses.extend(
            _handle_list_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                options=options,
            )
        )

    return clauses


def _handle_uuid_field(
    condition: Condition,
) -> List[ClauseElement]:
    # ------------------------- #
    field = condition.field
    # key = condition.key
    value = condition.value
    options = condition.options
    operator = condition.operator
    attribute: Column = getattr(SpanDBE, field)
    # ------------------------- #

    clauses = []

    if isinstance(operator, ComparisonOperator):
        clauses.extend(
            _handle_comparison_operator(
                attribute=attribute,
                operator=operator,
                value=value,
            )
        )
    elif isinstance(operator, ListOperator):
        clauses.extend(
            _handle_list_operator(
                attribute=attribute,
                operator=operator,
                value=value,
                options=options,
            )
        )

    elif isinstance(operator, ExistenceOperator):
        clauses.extend(
            _handle_existence_operator(
                attribute=attribute,
                operator=operator,
                key=None,
            )
        )

    return clauses


# COMBINE / FILTER


def combine(
    operator: LogicalOperator,
    clauses: List[ClauseElement],
) -> ClauseElement:
    if operator == LogicalOperator.AND:
        return and_(*clauses)
    elif operator == LogicalOperator.OR:
        return or_(*clauses)
    elif operator == LogicalOperator.NAND:
        return not_(and_(*clauses))
    elif operator == LogicalOperator.NOR:
        return not_(or_(*clauses))
    elif operator == LogicalOperator.NOT:
        if len(clauses) == 1:
            return not_(clauses[0])
        else:
            raise FilteringException(
                "'NOT' operator only supports a single condition.",
            )
    else:
        raise FilteringException(
            f"Unsupported logical operator: {operator}",
        )


def filter(  # pylint:disable=redefined-builtin
    filtering: Filtering,
) -> List[ClauseElement]:
    clauses = []

    for condition in filtering:
        if isinstance(condition, Filtering):
            operator = condition.operator
            conditions = condition.conditions

            clauses.append(combine(operator, filter(conditions)))

        elif isinstance(condition, Condition):
            field = condition.field

            if field == Fields.TRACE_ID:
                clauses.extend(_handle_uuid_field(condition))
            elif field == Fields.SPAN_ID:
                clauses.extend(_handle_uuid_field(condition))
            elif field == Fields.PARENT_ID:
                clauses.extend(_handle_uuid_field(condition))
            elif field == Fields.SPAN_KIND:
                clauses.extend(_handle_enum_field(condition))
            elif field == Fields.SPAN_NAME:
                clauses.extend(_handle_string_field(condition))
            elif field == Fields.START_TIME:
                clauses.extend(_handle_timestamp_field(condition))
            elif field == Fields.END_TIME:
                clauses.extend(_handle_timestamp_field(condition))
            elif field == Fields.STATUS_CODE:
                clauses.extend(_handle_enum_field(condition))
            elif field == Fields.STATUS_MESSAGE:
                clauses.extend(_handle_string_field(condition))
            elif field == Fields.ATTRIBUTES:
                clauses.extend(_handle_attributes_field(condition))
            elif field == Fields.LINKS:
                clauses.extend(_handle_list_field(condition))
            elif field == Fields.REFERENCES:
                clauses.extend(_handle_list_field(condition))
            # elif field == Fields.EVENTS:
            #     clauses.extend(_handle_events_field(condition))
            elif field == Fields.CREATED_AT:
                clauses.extend(_handle_timestamp_field(condition))
            elif field == Fields.UPDATED_AT:
                clauses.extend(_handle_timestamp_field(condition))
            elif field == Fields.DELETED_AT:
                clauses.extend(_handle_timestamp_field(condition))
            elif field == Fields.CREATED_BY_ID:
                clauses.extend(_handle_uuid_field(condition))
            elif field == Fields.UPDATED_BY_ID:
                clauses.extend(_handle_uuid_field(condition))
            elif field == Fields.DELETED_BY_ID:
                clauses.extend(_handle_uuid_field(condition))
            else:
                raise FilteringException(
                    f"Unsupported condition field: {field}",
                )

    return clauses
