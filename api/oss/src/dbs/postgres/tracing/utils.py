from typing import Any, Dict, Tuple, Optional, Union, List, cast as type_cast
from json import dumps
from datetime import datetime, timedelta, time, timezone
from uuid import UUID
from math import ceil, floor

from sqlalchemy import case, cast, literal, text
from sqlalchemy import and_, or_, not_, Column, bindparam, Text
from sqlalchemy import values, column, true
from sqlalchemy import Float
from sqlalchemy.sql import func, Select, ClauseElement
from sqlalchemy.types import Numeric, Boolean, Integer, String, BigInteger
from sqlalchemy.future import select
from sqlalchemy.sql.elements import ColumnElement
from sqlalchemy.sql.selectable import FromClause
from sqlalchemy.dialects.postgresql import dialect, ARRAY, TEXT, JSONB, BIT
from sqlalchemy.dialects.postgresql import aggregate_order_by

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
    FilteringException,
    Fields,
    Windowing,
    #
    MetricType,
    MetricSpec,
)

log = get_module_logger(__name__)

DEBUG_ARGS = {"dialect": dialect(), "compile_kwargs": {"literal_binds": True}}
TIMEOUT_STMT = text(f"SET LOCAL statement_timeout = '{15_000}'")  # milliseconds


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


def _to_jsonb_path(
    attribute: ColumnElement,
    key: str,
    leaf_as_text: bool = True,
) -> Tuple[ColumnElement, str]:
    parts = key.split(".")

    if leaf_as_text:
        for p in parts[:-1]:
            attribute = attribute.op("->")(p)
        attribute = attribute.op("->>")(parts[-1])
        return attribute, ""
    else:
        for p in parts[:-1]:
            attribute = attribute.op("->")(p)
        return attribute, parts[-1]


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
        container, leaf = _to_jsonb_path(attribute, key, leaf_as_text=False)
        clauses.append(container.op("?")(leaf))

        attribute, _ = _to_jsonb_path(attribute, key)

        if isinstance(value, int):
            attribute = cast(attribute, Float)
        elif isinstance(value, float):
            attribute = cast(attribute, Float)
        elif isinstance(value, list):
            if all(isinstance(v, int) for v in value):
                attribute = cast(attribute, Float)
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
        container, leaf = _to_jsonb_path(attribute, key, leaf_as_text=False)
        clauses.append(container.op("?")(leaf))

        attribute, _ = _to_jsonb_path(attribute, key)

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
        container, leaf = _to_jsonb_path(attribute, key, leaf_as_text=False)
        for v in value:
            bound = bindparam(None, dumps([v]), type_=Text)  # ensure array JSON
            casted = cast(bound, JSONB)
            subclauses.append(container[leaf].contains(casted))

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
            clauses.extend([or_(not_(sc), attribute.is_(None)) for sc in subclauses])
        else:
            clauses.append(or_(not_(or_(*subclauses)), attribute.is_(None)))

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
        container, leaf = _to_jsonb_path(attribute, key, leaf_as_text=False)
        if operator == DictOperator.HAS:
            clauses.append(container[leaf] == value)
        elif operator == DictOperator.HAS_NOT:
            clauses.append(container[leaf] != value)

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
            container, leaf = _to_jsonb_path(attribute, key, leaf_as_text=False)
            clauses.append(container.op("?")(leaf))
        else:
            clauses.append(attribute.isnot(None))

    elif operator == ExistenceOperator.NOT_EXISTS:
        if key:
            container, leaf = _to_jsonb_path(attribute, key, leaf_as_text=False)
            clauses.append(not_(container.op("?")(leaf)))
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


def _handle_fts_field(
    condition: Condition,
) -> List[ClauseElement]:
    conditions = []

    # ------------------------- #
    # field = condition.field
    # key = condition.key
    value = condition.value
    # options = condition.options
    # operator = condition.operator
    attribute: Column = getattr(SpanDBE, "attributes")
    # ------------------------- #

    ts_vector = func.to_tsvector(text("'simple'"), attribute)
    ts_query = func.websearch_to_tsquery(text("'simple'"), text(f"'{value}'"))

    conditions.append(ts_vector.op("@@")(ts_query))

    # ------------------------- #
    # field = condition.field
    # key = condition.key
    value = condition.value
    # options = condition.options
    # operator = condition.operator
    attribute: Column = getattr(SpanDBE, "events")
    # ------------------------- #

    ts_vector = func.to_tsvector(text("'simple'"), attribute)
    ts_query = func.websearch_to_tsquery(text("'simple'"), text(f"'{value}'"))

    conditions.append(ts_vector.op("@@")(ts_query))

    return [or_(*conditions)]


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
    filtering: List[Union[Condition, Filtering]],
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
            elif field == Fields.TRACE_TYPE:
                clauses.extend(_handle_enum_field(condition))
            elif field == Fields.SPAN_ID:
                clauses.extend(_handle_uuid_field(condition))
            elif field == Fields.SPAN_TYPE:
                clauses.extend(_handle_enum_field(condition))
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
            elif field == Fields.EVENTS:
                clauses.extend(_handle_list_field(condition))
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
            elif field == Fields.CONTENT:
                clauses.extend(_handle_fts_field(condition))
            else:
                # raise FilteringException(
                #     f"Unsupported condition field: {field}",
                # )
                log.warning(f"Unsupported condition field: {field}")

    return clauses


# ANALYTICS

_DEFAULT_TIME_DELTA = timedelta(days=30)
_MAX_ALLOWED_BUCKETS = 1024
_SUGGESTED_BUCKETS_LIST = [
    (1 * 1, "1 minute"),
    (1 * 5, "5 minutes"),
    (1 * 15, "15 minutes"),
    (1 * 30, "30 minutes"),
    (1 * 60 * 1, "1 hour"),
    (1 * 60 * 3, "3 hours"),
    (1 * 60 * 6, "6 hours"),
    (1 * 60 * 12, "12 hours"),
    (1 * 60 * 24 * 1, "1 day"),
    (1 * 60 * 24 * 3, "3 days"),
    (1 * 60 * 24 * 7, "7 days"),
    (1 * 60 * 24 * 14, "14 days"),
    (1 * 60 * 24 * 30, "30 days"),
]


def _pluralize_minutes(m: int) -> str:
    return f"{m} minute{'s' if m != 1 else ''}"


def _get_stride(
    oldest: datetime,
    newest: datetime,
    interval: Optional[int] = None,
) -> str:
    # total range in minutes (never negative)
    range_minutes_float = max(0.0, (newest - oldest).total_seconds() / 60.0)

    # If no interval is provided, make the stride the whole range -> single bucket
    if interval is None:
        minutes = max(1, int(ceil(range_minutes_float)))
        return _pluralize_minutes(minutes)

    # Interval given: enforce bucket limits
    desired_interval = max(1, int(interval))
    # number of buckets with requested interval
    desired_buckets = floor(range_minutes_float / desired_interval)

    if desired_buckets <= _MAX_ALLOWED_BUCKETS:
        return _pluralize_minutes(desired_interval)

    # Too many buckets -> pick the first suggested interval that satisfies the cap
    for suggested_minutes, suggested_text in _SUGGESTED_BUCKETS_LIST:
        suggested_minutes = max(1, int(suggested_minutes))
        suggested_buckets = floor(range_minutes_float / suggested_minutes)
        if suggested_buckets <= _MAX_ALLOWED_BUCKETS:
            return suggested_text

    # If nothing fits, use the last (largest) suggestion
    return _SUGGESTED_BUCKETS_LIST[-1][1]


def _get_interval(
    stride: str,
) -> int:
    qty_text, unit = stride.split()
    qty = int(qty_text)
    return {
        "minute": qty,
        "minutes": qty,
        "hour": qty * 60,
        "hours": qty * 60,
        "day": qty * 1440,
        "days": qty * 1440,
        "week": qty * 10080,
        "weeks": qty * 10080,
    }[unit]


def _get_timestamps(
    oldest: datetime,
    newest: datetime,
    interval: int,
) -> List[datetime]:
    current = oldest
    buckets = []
    while current < newest:
        buckets.append(current)
        current += timedelta(minutes=interval)
    return buckets


def parse_windowing(
    windowing: Optional[Windowing] = None,
) -> tuple:
    if not windowing:
        windowing = Windowing()

    now = datetime.now(timezone.utc)
    start_of_next_day = datetime.combine(
        now + timedelta(days=1), time.min, tzinfo=timezone.utc
    )

    if windowing.newest and windowing.newest.tzinfo is None:
        windowing.newest = windowing.newest.replace(tzinfo=timezone.utc)

    if windowing.oldest and windowing.oldest.tzinfo is None:
        windowing.oldest = windowing.oldest.replace(tzinfo=timezone.utc)

    newest = windowing.newest if windowing and windowing.newest else start_of_next_day

    oldest = (
        windowing.oldest
        if windowing and windowing.oldest and windowing.oldest < newest
        else newest - _DEFAULT_TIME_DELTA
    )

    stride = _get_stride(oldest, newest, windowing.interval)
    interval = _get_interval(stride)
    timestamps = _get_timestamps(oldest, newest, interval)

    return oldest, newest, stride, interval, timestamps


PERCENTILE_LEVELS = {
    k: v / 100
    for k, v in {
        "p00.05": 0.05,
        "p00.1": 0.1,
        "p00.5": 0.5,
        "p01": 1,
        "p02.5": 2.5,
        "p05": 5,
        "p10": 10,
        "p12.5": 12.5,
        "p20": 20,
        "p25": 25,
        "p30": 30,
        "p37.5": 37.5,
        "p40": 40,
        "p50": 50,
        "p60": 60,
        "p62.5": 62.5,
        "p70": 70,
        "p75": 75,
        "p80": 80,
        "p87.5": 87.5,
        "p90": 90,
        "p95": 95,
        "p97.5": 97.5,
        "p99": 99,
        "p99.5": 99.5,
        "p99.9": 99.9,
        "p99.95": 99.95,
    }.items()
}
PERCENTILES_KEYS: List[str] = list(PERCENTILE_LEVELS.keys())
PERCENTILES_VALUES: List[float] = list(PERCENTILE_LEVELS.values())
IQR_ITEMS: List[Tuple[str, Tuple[str, str]]] = [
    ("iqr25", ("p37.5", "p62.5")),
    ("iqr50", ("p25", "p75")),
    ("iqr75", ("p12.5", "p87.5")),
    ("iqr80", ("p10", "p90")),
    ("iqr90", ("p05", "p95")),
    ("iqr95", ("p02.5", "p97.5")),
    ("iqr99", ("p00.5", "p99.5")),
    ("iqr99.9", ("p00.05", "p99.95")),
]
CQV_ITEMS: List[Tuple[str, Tuple[str, str]]] = [
    ("cqv25", ("p37.5", "p62.5")),
    ("cqv50", ("p25", "p75")),
    ("cqv75", ("p12.5", "p87.5")),
    ("cqv80", ("p10", "p90")),
    ("cqv90", ("p05", "p95")),
    ("cqv99", ("p00.5", "p99.5")),
    ("cqv95", ("p02.5", "p97.5")),
    ("cqv99.9", ("p00.05", "p99.95")),
]
PSC_ITEMS: List[Tuple[str, Tuple[str, str]]] = [
    ("psc25", ("p37.5", "p62.5")),
    ("psc50", ("p25", "p75")),
    ("psc75", ("p12.5", "p87.5")),
    ("psc80", ("p10", "p90")),
    ("psc90", ("p05", "p95")),
    ("psc99", ("p00.5", "p99.5")),
    ("psc95", ("p02.5", "p97.5")),
    ("psc99.9", ("p00.05", "p99.95")),
]
TOP_K = 3


def build_type_flags(
    *,
    metric_specs: List[MetricSpec],
) -> Optional[Dict[str, bool]]:
    present = {s.type for s in metric_specs}

    return {
        "need_numeric_continuous": (MetricType.NUMERIC_CONTINUOUS in present),
        "need_numeric_discrete": (MetricType.NUMERIC_DISCRETE in present),
        "need_categorical_single": (MetricType.CATEGORICAL_SINGLE in present),
        "need_categorical_multiple": (MetricType.CATEGORICAL_MULTIPLE in present),
        "need_binary": (MetricType.BINARY in present),
        "need_string": (MetricType.STRING in present),
        "need_json": (MetricType.JSON in present),
    }


def build_specs_values(
    *,
    metric_specs: List[MetricSpec],
) -> Optional[FromClause]:
    if not len(metric_specs):
        return None

    data = [
        (
            idx,
            s.path.split("."),  # -> text[]
            s.type.value,
            s.bins,
            s.vmin,
            s.vmax,
            (s.edge if s.edge is not None else True),
        )
        for idx, s in enumerate(metric_specs)
    ]

    vals = values(
        column("idx", Integer),
        column("path", ARRAY(TEXT())),
        column("type", String),
        column("bins", Integer),
        column("vmin", Numeric),
        column("vmax", Numeric),
        column("edge", Boolean),
        name="specs_values",
    ).data(data)

    return vals.alias("specs_values")


def build_base_cte(
    *,
    project_id: UUID,
    oldest: datetime,
    newest: datetime,
    stride: str,
    rate: Optional[float] = None,
    filtering: Optional[Filtering] = None,
) -> Optional[FromClause]:
    timestamp = func.date_bin(
        text(f"'{stride}'"),
        SpanDBE.created_at,
        oldest,
    ).label("timestamp")

    base_stmt: Select = (
        select(
            timestamp,
            SpanDBE.project_id,
            SpanDBE.trace_id,
            SpanDBE.span_id,
            SpanDBE.parent_id,
            SpanDBE.created_at,
            SpanDBE.attributes.label("attributes"),
        )
        .select_from(SpanDBE)
        .where(
            SpanDBE.project_id == project_id,
            SpanDBE.created_at >= oldest,
            SpanDBE.created_at < newest,
        )
        .where(SpanDBE.parent_id.is_(None))
    )

    # External filters
    if filtering is not None:
        base_stmt = base_stmt.filter(
            type_cast(
                ColumnElement[bool],
                combine(
                    operator=filtering.operator,
                    clauses=filter(filtering.conditions),
                ),
            )
        )

    if rate is not None:
        percent = max(0, min(int(rate * 100.0), 100))

        if percent == 0:
            return None

        if percent < 100:
            base_stmt = base_stmt.where(
                cast(
                    text("concat('x', left(cast(trace_id as varchar), 8))"), BIT(32)
                ).cast(BigInteger)
                % 100
                < percent
            )

    return base_stmt.cte("base_cte")


def build_extract_cte(
    *,
    base_cte: FromClause,
    specs_values: FromClause,
) -> Optional[FromClause]:
    extract_stmt = (
        select(
            base_cte.c.timestamp,
            specs_values.c.idx,
            specs_values.c.type,
            specs_values.c.bins,
            specs_values.c.vmin,
            specs_values.c.vmax,
            specs_values.c.edge,
            base_cte.c.attributes.op("#>")(specs_values.c.path).label("jv"),
        )
        .select_from(base_cte)
        .join(specs_values, true())
    )

    return extract_stmt.cte("extract_cte")


def build_statistics_stmt(
    extract_cte: FromClause,
    type_flags: Dict[str, bool],
) -> Optional[FromClause]:
    blocks: List[Select] = []

    # Use independent IFs so multiple families can be included together
    if type_flags.get("need_numeric_continuous"):
        blocks += build_numeric_continuous_blocks(extract_cte=extract_cte)

    if type_flags.get("need_numeric_discrete"):
        blocks += build_numeric_discrete_blocks(extract_cte=extract_cte)

    if type_flags.get("need_categorical_single"):
        blocks += build_categorical_single_blocks(extract_cte=extract_cte)

    if type_flags.get("need_categorical_multiple"):
        blocks += build_categorical_multiple_blocks(extract_cte=extract_cte)

    if type_flags.get("need_binary"):
        blocks += build_binary_blocks(extract_cte=extract_cte)

    if type_flags.get("need_string"):
        blocks += build_string_blocks(extract_cte=extract_cte)

    if type_flags.get("need_json"):
        blocks += build_json_blocks(extract_cte=extract_cte)

    if not blocks:
        return None

    # If only one block family, skip union_all for clarity/perf
    if len(blocks) == 1:
        return blocks[0].cte("statistics_stmt")

    return blocks[0].union_all(*blocks[1:]).cte("statistics_stmt")


def build_numeric_continuous_blocks(
    extract_cte: FromClause,
) -> List[Select]:
    results: List[Select] = []

    # -------------------------------------------------
    # 1. Only valid numeric/continuous rows
    # -------------------------------------------------
    cont_raw = (
        select(
            extract_cte.c.timestamp,
            extract_cte.c.idx,
            extract_cte.c.bins.label("bins_opt"),
            extract_cte.c.vmin.label("vmin_opt"),
            extract_cte.c.vmax.label("vmax_opt"),
            extract_cte.c.edge.label("edge_opt"),
            cast(extract_cte.c.jv.op("#>>")(text("'{}'")), Numeric).label("value"),
        ).where(
            extract_cte.c.type == literal(MetricType.NUMERIC_CONTINUOUS.value),
            extract_cte.c.jv.isnot(None),
            func.jsonb_typeof(extract_cte.c.jv) == literal("number"),
        )
    ).cte("cont_raw")

    # -------------------------------------------------
    # 2. Per-group stats
    # -------------------------------------------------
    cont_minmax = (
        select(
            cont_raw.c.timestamp,
            cont_raw.c.idx,
            func.count(cont_raw.c.value).label("n"),
            func.min(cont_raw.c.value).label("vmin"),
            func.max(cont_raw.c.value).label("vmax"),
            func.max(cont_raw.c.bins_opt).label("bins_opt"),
            func.max(cont_raw.c.vmin_opt).label("vmin_opt"),
            func.max(cont_raw.c.vmax_opt).label("vmax_opt"),
            func.bool_or(cont_raw.c.edge_opt).label("edge_opt"),
        ).group_by(cont_raw.c.timestamp, cont_raw.c.idx)
    ).cte("cont_minmax")

    # -------------------------------------------------
    # 3. Count metric
    # -------------------------------------------------
    cont_count = (
        select(
            cont_raw.c.timestamp,
            cont_raw.c.idx,
            literal("cont_count").label("kind"),
            func.jsonb_build_object("count", func.count(cont_raw.c.value)).label(
                "value"
            ),
        )
        .select_from(
            cont_raw.join(
                cont_minmax,
                (cont_raw.c.timestamp == cont_minmax.c.timestamp)
                & (cont_raw.c.idx == cont_minmax.c.idx),
            )
        )
        .where(cont_minmax.c.n > 0)
        .group_by(cont_raw.c.timestamp, cont_raw.c.idx)
    )
    results.append(cont_count)

    # -------------------------------------------------
    # 4. Basic stats
    # -------------------------------------------------
    cont_basics = (
        select(
            cont_raw.c.timestamp,
            cont_raw.c.idx,
            literal("cont_basics").label("kind"),
            func.jsonb_build_object(
                "sum",
                func.sum(cont_raw.c.value),
                "mean",
                func.avg(cont_raw.c.value),
                "min",
                func.min(cont_raw.c.value),
                "max",
                func.max(cont_raw.c.value),
            ).label("value"),
        )
        .select_from(
            cont_raw.join(
                cont_minmax,
                (cont_raw.c.timestamp == cont_minmax.c.timestamp)
                & (cont_raw.c.idx == cont_minmax.c.idx),
            )
        )
        .where(cont_minmax.c.n > 0)
        .group_by(cont_raw.c.timestamp, cont_raw.c.idx)
    )
    results.append(cont_basics)

    # -------------------------------------------------
    # 5. Percentiles
    # -------------------------------------------------
    cont_pcts = (
        select(
            cont_raw.c.timestamp,
            cont_raw.c.idx,
            literal("cont_pcts").label("kind"),
            func.to_jsonb(
                func.percentile_cont(
                    literal(PERCENTILES_VALUES, ARRAY(Numeric()))
                ).within_group(cont_raw.c.value)
            ).label("value"),
        )
        .select_from(
            cont_raw.join(
                cont_minmax,
                (cont_raw.c.timestamp == cont_minmax.c.timestamp)
                & (cont_raw.c.idx == cont_minmax.c.idx),
            )
        )
        .where(cont_minmax.c.n > 0)
        .group_by(cont_raw.c.timestamp, cont_raw.c.idx)
    )
    results.append(cont_pcts)

    # -------------------------------------------------
    # 6. Chosen min/max/bins
    # -------------------------------------------------
    chosen_min = case(
        (cont_minmax.c.vmin_opt.isnot(None), cast(cont_minmax.c.vmin_opt, Numeric)),
        else_=cont_minmax.c.vmin,
    )
    chosen_max = case(
        (cont_minmax.c.vmax_opt.isnot(None), cast(cont_minmax.c.vmax_opt, Numeric)),
        else_=cont_minmax.c.vmax,
    )
    chosen_bins = case(
        (cont_minmax.c.bins_opt.isnot(None), cast(cont_minmax.c.bins_opt, Integer)),
        else_=cast(func.ceil(func.sqrt(cast(cont_minmax.c.n, Numeric))), Integer),
    )

    cont_bins = (
        select(
            cont_minmax.c.timestamp,
            cont_minmax.c.idx,
            case(
                (
                    (cont_minmax.c.n <= 1) | (chosen_min == chosen_max),
                    literal(1, type_=Integer),
                ),
                else_=chosen_bins,
            ).label("bins"),
            chosen_min.label("vmin"),
            chosen_max.label("vmax"),
            cont_minmax.c.n.label("n"),
            cont_minmax.c.edge_opt.label("edge"),
        ).where(cont_minmax.c.n > 0)
    ).cte("cont_bins")

    # -------------------------------------------------
    # 7. Bin series & intervals (precompute is_last_bin)
    # -------------------------------------------------
    cont_bin_series = (
        func.generate_series(1, cont_bins.c.bins)
        .table_valued("bin")
        .render_derived(name="cont_bin_series")
    )

    is_edge_aligned = cont_bins.c.edge.is_(None) | cont_bins.c.edge.is_(True)

    bin_width = case(
        (is_edge_aligned, (cont_bins.c.vmax - cont_bins.c.vmin) / cont_bins.c.bins),
        else_=(cont_bins.c.vmax - cont_bins.c.vmin) / (cont_bins.c.bins - 1),
    )

    bin_intervals = (
        select(
            cont_bins.c.timestamp,
            cont_bins.c.idx,
            cont_bin_series.c.bin,
            (cont_bin_series.c.bin == cont_bins.c.bins).label("is_last_bin"),
            case(
                (cont_bin_series.c.bin == literal(1, Integer), cont_bins.c.vmin),
                else_=case(
                    (
                        is_edge_aligned,
                        cont_bins.c.vmin + (cont_bin_series.c.bin - 1) * bin_width,
                    ),
                    else_=(cont_bins.c.vmin + (cont_bin_series.c.bin - 1) * bin_width)
                    - (bin_width / 2),
                ),
            ).label("interval_start"),
            case(
                (cont_bin_series.c.bin == cont_bins.c.bins, cont_bins.c.vmax),
                else_=case(
                    (
                        is_edge_aligned,
                        cont_bins.c.vmin + cont_bin_series.c.bin * bin_width,
                    ),
                    else_=(cont_bins.c.vmin + (cont_bin_series.c.bin - 1) * bin_width)
                    + (bin_width / 2),
                ),
            ).label("interval_end"),
        ).select_from(cont_bins.join(cont_bin_series, literal(True)))
    ).cte("bin_intervals")

    # -------------------------------------------------
    # 8. Bin counts (use is_last_bin for <= on last bin)
    # -------------------------------------------------
    cont_bin_counts = (
        select(
            cont_raw.c.timestamp,
            cont_raw.c.idx,
            bin_intervals.c.bin,
            func.count().label("count"),
        )
        .select_from(
            cont_raw.join(
                bin_intervals,
                (cont_raw.c.timestamp == bin_intervals.c.timestamp)
                & (cont_raw.c.idx == bin_intervals.c.idx)
                & (cont_raw.c.value >= bin_intervals.c.interval_start)
                & case(
                    (
                        bin_intervals.c.is_last_bin,
                        cont_raw.c.value <= bin_intervals.c.interval_end,
                    ),
                    else_=(cont_raw.c.value < bin_intervals.c.interval_end),
                ),
            )
        )
        .group_by(cont_raw.c.timestamp, cont_raw.c.idx, bin_intervals.c.bin)
    ).cte("cont_bin_counts")

    # -------------------------------------------------
    # 9. Full histogram (includes empty bins)
    # -------------------------------------------------
    full_hist = (
        select(
            bin_intervals.c.timestamp,
            bin_intervals.c.idx,
            literal("cont_hist").label("kind"),
            func.coalesce(
                func.jsonb_agg(
                    aggregate_order_by(
                        func.jsonb_build_object(
                            "bin",
                            bin_intervals.c.bin,
                            "count",
                            func.coalesce(cont_bin_counts.c.count, literal(0)),
                            "interval",
                            func.jsonb_build_array(
                                bin_intervals.c.interval_start,
                                bin_intervals.c.interval_end,
                            ),
                        ),
                        bin_intervals.c.bin.asc(),
                    )
                ),
                func.jsonb_build_array(),
            ).label("value"),
        )
        .select_from(
            bin_intervals.outerjoin(
                cont_bin_counts,
                (bin_intervals.c.timestamp == cont_bin_counts.c.timestamp)
                & (bin_intervals.c.idx == cont_bin_counts.c.idx)
                & (bin_intervals.c.bin == cont_bin_counts.c.bin),
            )
        )
        .group_by(bin_intervals.c.timestamp, bin_intervals.c.idx)
    )
    results.append(full_hist)

    return results


def build_numeric_discrete_blocks(
    extract_cte: FromClause,
) -> List[Select]:
    results: List[Select] = []

    # Only valid numeric/discrete rows
    disc_raw = (
        select(
            extract_cte.c.timestamp,
            extract_cte.c.idx,
            cast(extract_cte.c.jv.op("#>>")(text("'{}'")), Numeric).label("value"),
        ).where(
            extract_cte.c.type == literal(MetricType.NUMERIC_DISCRETE.value),
            extract_cte.c.jv.isnot(None),
            func.jsonb_typeof(extract_cte.c.jv) == literal("number"),
        )
    ).cte("disc_raw")

    disc_counts = (
        select(
            disc_raw.c.timestamp,
            disc_raw.c.idx,
            func.count(disc_raw.c.value).label("n"),
        ).group_by(disc_raw.c.timestamp, disc_raw.c.idx)
    ).cte("disc_counts")

    # Count (emit only when n>0)
    disc_count = (
        select(
            disc_raw.c.timestamp,
            disc_raw.c.idx,
            literal("disc_count").label("kind"),
            func.jsonb_build_object("count", func.count(disc_raw.c.value)).label(
                "value"
            ),
        )
        .select_from(
            disc_raw.join(
                disc_counts,
                (disc_raw.c.timestamp == disc_counts.c.timestamp)
                & (disc_raw.c.idx == disc_counts.c.idx),
            )
        )
        .where(disc_counts.c.n > 0)
        .group_by(disc_raw.c.timestamp, disc_raw.c.idx)
    )
    results.append(disc_count)

    # Basics (emit only when n>0)
    disc_basics = (
        select(
            disc_raw.c.timestamp,
            disc_raw.c.idx,
            literal("disc_basics").label("kind"),
            func.jsonb_build_object(
                "sum",
                func.sum(disc_raw.c.value),
                "mean",
                func.avg(disc_raw.c.value),
                "min",
                func.min(disc_raw.c.value),
                "max",
                func.max(disc_raw.c.value),
            ).label("value"),
        )
        .select_from(
            disc_raw.join(
                disc_counts,
                (disc_raw.c.timestamp == disc_counts.c.timestamp)
                & (disc_raw.c.idx == disc_counts.c.idx),
            )
        )
        .where(disc_counts.c.n > 0)
        .group_by(disc_raw.c.timestamp, disc_raw.c.idx)
    )
    results.append(disc_basics)

    # Percentiles (emit only when n>0)
    disc_pcts = (
        select(
            disc_raw.c.timestamp,
            disc_raw.c.idx,
            literal("disc_pcts").label("kind"),
            func.to_jsonb(
                func.percentile_cont(
                    literal(PERCENTILES_VALUES, ARRAY(Numeric()))
                ).within_group(disc_raw.c.value)
            ).label("value"),
        )
        .select_from(
            disc_raw.join(
                disc_counts,
                (disc_raw.c.timestamp == disc_counts.c.timestamp)
                & (disc_raw.c.idx == disc_counts.c.idx),
            )
        )
        .where(disc_counts.c.n > 0)
        .group_by(disc_raw.c.timestamp, disc_raw.c.idx)
    )
    results.append(disc_pcts)

    # Exact-value frequency (naturally empty when no rows)
    disc_rows = (
        select(
            disc_raw.c.timestamp,
            disc_raw.c.idx,
            disc_raw.c.value.label("value"),
            func.count().label("count"),
        ).group_by(disc_raw.c.timestamp, disc_raw.c.idx, disc_raw.c.value)
    ).cte("disc_rows")

    disc_freq = select(
        disc_rows.c.timestamp,
        disc_rows.c.idx,
        literal("disc_freq").label("kind"),
        func.coalesce(
            func.jsonb_agg(
                aggregate_order_by(
                    func.jsonb_build_object(
                        "value", disc_rows.c.value, "count", disc_rows.c.count
                    ),
                    disc_rows.c.count.desc(),
                    disc_rows.c.value.asc(),
                )
            ),
            func.jsonb_build_array(),
        ).label("value"),
    ).group_by(disc_rows.c.timestamp, disc_rows.c.idx)
    results.append(disc_freq)

    return results


def build_categorical_single_blocks(
    extract_cte: FromClause,
) -> List[Select]:
    results: List[Select] = []

    # Only valid string rows for categorical/single
    cls_raw = (
        select(
            extract_cte.c.timestamp,
            extract_cte.c.idx,
            cast(extract_cte.c.jv.op("#>>")(text("'{}'")), String).label("value"),
        ).where(
            extract_cte.c.type == literal(MetricType.CATEGORICAL_SINGLE.value),
            extract_cte.c.jv.isnot(None),
            func.jsonb_typeof(extract_cte.c.jv) == literal("string"),
        )
    ).cte("cls_raw")

    # Per-group counts for gating
    cls_counts = (
        select(
            cls_raw.c.timestamp,
            cls_raw.c.idx,
            func.count().label("n"),
        ).group_by(cls_raw.c.timestamp, cls_raw.c.idx)
    ).cte("cls_counts")

    # Total count (emit only when n>0)
    cls_count = (
        select(
            cls_raw.c.timestamp,
            cls_raw.c.idx,
            literal("cls_count").label("kind"),
            func.jsonb_build_object("count", func.count()).label("value"),
        )
        .select_from(
            cls_raw.join(
                cls_counts,
                (cls_raw.c.timestamp == cls_counts.c.timestamp)
                & (cls_raw.c.idx == cls_counts.c.idx),
            )
        )
        .where(cls_counts.c.n > 0)
        .group_by(cls_raw.c.timestamp, cls_raw.c.idx)
    )
    results.append(cls_count)

    # Frequency table (only groups with rows appear)
    cls_rows = (
        select(
            cls_raw.c.timestamp,
            cls_raw.c.idx,
            cls_raw.c.value.label("value"),
            func.count().label("count"),
        ).group_by(cls_raw.c.timestamp, cls_raw.c.idx, cls_raw.c.value)
    ).cte("cls_rows")

    cls_freq = select(
        cls_rows.c.timestamp,
        cls_rows.c.idx,
        literal("cls_freq").label("kind"),
        func.coalesce(
            func.jsonb_agg(
                aggregate_order_by(
                    func.jsonb_build_object(
                        "value",
                        cls_rows.c.value,
                        "count",
                        cls_rows.c.count,
                    ),
                    cls_rows.c.count.desc(),
                    cls_rows.c.value.asc(),
                )
            ),
            func.jsonb_build_array(),
        ).label("value"),
    ).group_by(cls_rows.c.timestamp, cls_rows.c.idx)
    results.append(cls_freq)

    return results


def build_categorical_multiple_blocks(
    extract_cte: FromClause,
) -> List[Select]:
    results: List[Select] = []

    # Unnest array -> "value" (strings only)
    elem = func.jsonb_array_elements(extract_cte.c.jv).table_valued("value")

    lbl_raw = (
        select(
            extract_cte.c.timestamp,
            extract_cte.c.idx,
            elem.c.value.op("#>>")(text("'{}'")).label("value"),
        )
        .select_from(extract_cte.join(elem, literal(True)))
        .where(
            extract_cte.c.type == literal(MetricType.CATEGORICAL_MULTIPLE.value),
            extract_cte.c.jv.isnot(None),
            func.jsonb_typeof(extract_cte.c.jv) == literal("array"),
            func.jsonb_typeof(elem.c.value) == literal("string"),
        )
    ).cte("lbl_raw")

    # Per-group counts for gating
    lbl_counts = (
        select(
            lbl_raw.c.timestamp,
            lbl_raw.c.idx,
            func.count().label("n"),
        ).group_by(lbl_raw.c.timestamp, lbl_raw.c.idx)
    ).cte("lbl_counts")

    # Total count (emit only when n>0)
    lbl_count = (
        select(
            lbl_raw.c.timestamp,
            lbl_raw.c.idx,
            literal("lbl_count").label("kind"),
            func.jsonb_build_object("count", func.count()).label("value"),
        )
        .select_from(
            lbl_raw.join(
                lbl_counts,
                (lbl_raw.c.timestamp == lbl_counts.c.timestamp)
                & (lbl_raw.c.idx == lbl_counts.c.idx),
            )
        )
        .where(lbl_counts.c.n > 0)
        .group_by(lbl_raw.c.timestamp, lbl_raw.c.idx)
    )
    results.append(lbl_count)

    # Frequency table (only groups with rows appear)
    lbl_rows = (
        select(
            lbl_raw.c.timestamp,
            lbl_raw.c.idx,
            lbl_raw.c.value.label("value"),
            func.count().label("count"),
        ).group_by(lbl_raw.c.timestamp, lbl_raw.c.idx, lbl_raw.c.value)
    ).cte("lbl_rows")

    lbl_freq = select(
        lbl_rows.c.timestamp,
        lbl_rows.c.idx,
        literal("lbl_freq").label("kind"),
        func.coalesce(
            func.jsonb_agg(
                aggregate_order_by(
                    func.jsonb_build_object(
                        "value",
                        lbl_rows.c.value,
                        "count",
                        lbl_rows.c.count,
                    ),
                    lbl_rows.c.count.desc(),
                    lbl_rows.c.value.asc(),
                )
            ),
            func.jsonb_build_array(),
        ).label("value"),
    ).group_by(lbl_rows.c.timestamp, lbl_rows.c.idx)
    results.append(lbl_freq)

    return results


def build_binary_blocks(
    extract_cte: FromClause,
) -> List[Select]:
    results: List[Select] = []

    bin_raw = (
        select(
            extract_cte.c.timestamp,
            extract_cte.c.idx,
            extract_cte.c.jv.label("value"),
        ).where(
            extract_cte.c.type == literal(MetricType.BINARY.value),
            extract_cte.c.jv.isnot(None),
            func.jsonb_typeof(extract_cte.c.jv) == literal("boolean"),
        )
    ).cte("bin_raw")

    # Count (gate empty groups)
    bin_counts = (
        select(
            bin_raw.c.timestamp,
            bin_raw.c.idx,
            func.count().label("n"),
        ).group_by(bin_raw.c.timestamp, bin_raw.c.idx)
    ).cte("bin_counts")

    bin_count = (
        select(
            bin_raw.c.timestamp,
            bin_raw.c.idx,
            literal("bin_count").label("kind"),
            func.jsonb_build_object("count", func.count()).label("value"),
        )
        .select_from(
            bin_raw.join(
                bin_counts,
                (bin_raw.c.timestamp == bin_counts.c.timestamp)
                & (bin_raw.c.idx == bin_counts.c.idx),
            )
        )
        .where(bin_counts.c.n > 0)
        .group_by(bin_raw.c.timestamp, bin_raw.c.idx)
    )
    results.append(bin_count)

    # Frequency via FILTER (fewer CASEs, no NULLs)
    t_cond = cast(bin_raw.c.value, Boolean).is_(True)
    f_cond = cast(bin_raw.c.value, Boolean).is_(False)

    bin_freq = select(
        bin_raw.c.timestamp,
        bin_raw.c.idx,
        literal("bin_freq").label("kind"),
        func.jsonb_build_object(
            True,
            func.count().filter(t_cond),
            False,
            func.count().filter(f_cond),
        ).label("value"),
    ).group_by(bin_raw.c.timestamp, bin_raw.c.idx)
    results.append(bin_freq)

    return results


def build_string_blocks(
    extract_cte: FromClause,
) -> List[Select]:
    results: List[Select] = []

    # Only valid strings
    str_raw = (
        select(
            extract_cte.c.timestamp,
            extract_cte.c.idx,
            extract_cte.c.jv.label("value"),
        ).where(
            extract_cte.c.type == literal(MetricType.STRING.value),
            extract_cte.c.jv.isnot(None),
            func.jsonb_typeof(extract_cte.c.jv) == literal("string"),
        )
    ).cte("str_raw")

    str_counts = (
        select(
            str_raw.c.timestamp,
            str_raw.c.idx,
            func.count().label("n"),
        ).group_by(str_raw.c.timestamp, str_raw.c.idx)
    ).cte("str_counts")

    # Count (emit only when n>0)
    str_count = (
        select(
            str_raw.c.timestamp,
            str_raw.c.idx,
            literal("str_count").label("kind"),
            func.jsonb_build_object("count", func.count()).label("value"),
        )
        .select_from(
            str_raw.join(
                str_counts,
                (str_raw.c.timestamp == str_counts.c.timestamp)
                & (str_raw.c.idx == str_counts.c.idx),
            )
        )
        .where(str_counts.c.n > 0)
        .group_by(str_raw.c.timestamp, str_raw.c.idx)
    )
    results.append(str_count)

    return results


def build_json_blocks(
    extract_cte: FromClause,
) -> List[Select]:
    results: List[Select] = []

    # Only valid JSON objects
    json_raw = (
        select(
            extract_cte.c.timestamp,
            extract_cte.c.idx,
            extract_cte.c.jv.label("value"),
        ).where(
            extract_cte.c.type == literal(MetricType.JSON.value),
            extract_cte.c.jv.isnot(None),
            func.jsonb_typeof(extract_cte.c.jv) == literal("object"),
        )
    ).cte("json_raw")

    json_counts = (
        select(
            json_raw.c.timestamp,
            json_raw.c.idx,
            func.count().label("n"),
        ).group_by(json_raw.c.timestamp, json_raw.c.idx)
    ).cte("json_counts")

    # Count (emit only when n>0)
    json_count = (
        select(
            json_raw.c.timestamp,
            json_raw.c.idx,
            literal("json_count").label("kind"),
            func.jsonb_build_object("count", func.count()).label("value"),
        )
        .select_from(
            json_raw.join(
                json_counts,
                (json_raw.c.timestamp == json_counts.c.timestamp)
                & (json_raw.c.idx == json_counts.c.idx),
            )
        )
        .where(json_counts.c.n > 0)
        .group_by(json_raw.c.timestamp, json_raw.c.idx)
    )
    results.append(json_count)

    return results


def compute_range(
    value: Dict[str, Any],
) -> Dict[str, Any]:
    if "min" in value and "max" in value:
        value["range"] = value["max"] - value["min"]

    return value


def parse_pcts(
    value: List[Optional[float]],
) -> Dict[str, Any]:
    if value is None or len(value) != len(PERCENTILES_KEYS):
        return {}

    return {"pcts": dict(zip(PERCENTILES_KEYS, value))}


def compute_iqrs(
    value: Dict[str, Any],
) -> Dict[str, Any]:
    pcts = value.get("pcts")

    if not pcts:
        return value

    iqrs: Dict[str, float] = {}

    for k, v in IQR_ITEMS:
        if v[0] in pcts and v[1] in pcts:
            iqrs[k] = pcts[v[1]] - pcts[v[0]]

    value["iqrs"] = iqrs

    return value


def compute_cqvs(
    value: Dict[str, Any],
) -> Dict[str, Any]:
    pcts = value.get("pcts")

    if not pcts:
        return value

    if (
        pcts["p01"] * pcts["p99"] < 0
        or abs(pcts["p50"]) < abs(pcts["p99"]) / 100.0
        or abs(pcts["p50"]) < abs(pcts["p01"]) / 100.0
    ):
        return value

    pscs = {}

    for k, v in PSC_ITEMS:
        if v[0] in pcts and v[1] in pcts:
            pscs[k] = (
                (pcts[v[1]] - pcts[v[0]]) / (pcts[v[1]] + pcts[v[0]])
                if (pcts[v[1]] + pcts[v[0]]) != 0
                else 0.0
            )

    value["pscs"] = pscs

    return value


def compute_pscs(
    value: Dict[str, Any],
) -> Dict[str, Any]:
    pcts = value.get("pcts")

    if not pcts:
        return value

    if (
        pcts["p01"] * pcts["p99"] < 0
        or abs(pcts["p50"]) < abs(pcts["p99"]) / 100.0
        or abs(pcts["p50"]) < abs(pcts["p01"]) / 100.0
    ):
        return value

    pscs = {}

    for k, v in PSC_ITEMS:
        if v[0] in pcts and v[1] in pcts:
            pscs[k] = (
                (pcts[v[1]] - pcts[v[0]]) / pcts["p50"] if pcts["p50"] != 0 else 0.0
            )

    value["pscs"] = pscs

    return value


def normalize_hist(
    value: List[Dict[str, Any]],
) -> Dict[str, Any]:
    hist = value

    if not hist:
        return {}

    count = 0.0

    for h in hist:
        count += float(h.get("count", 0.0))

    for h in hist:
        h["density"] = round(
            float(h.get("count", 0.0)) / count if count > 0.0 else 0.0, 5
        )

    return {"hist": hist}


def parse_bin_freq(
    value: Dict[str, Any],
) -> List[Dict[str, Any]]:
    return [
        {
            "value": True,
            "count": value.get("true", 0),
        },
        {
            "value": False,
            "count": value.get("false", 0),
        },
    ]


def normalize_freq(
    value: List[Dict[str, Any]],
) -> Dict[str, Any]:
    freq = value

    if not freq:
        return {}

    count = 0.0

    for f in freq:
        count += float(f.get("count", 0.0))

    for f in freq:
        f["density"] = round(
            float(f.get("count", 0.0)) / count if count > 0.0 else 0.0, 5
        )

    return {"freq": freq}


def compute_uniq(
    value: Dict[str, Any],
) -> Dict[str, Any]:
    freq = value.get("freq")

    if not freq:
        return value

    uniq = []

    for f in freq:
        if f.get("value") is not None:
            uniq.append(f.get("value"))

    value["uniq"] = uniq

    return value
