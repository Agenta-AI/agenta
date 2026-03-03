from __future__ import annotations

import os
import json
import re
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple, Union
from uuid import UUID


import httpx

from oss.src.dbs.postgres.tracing.utils import (
    parse_windowing,
    PERCENTILES_KEYS,
    PERCENTILES_VALUES,
)
from oss.src.core.tracing.dtos import (
    MetricSpec,
    MetricType,
    Focus,
    Filtering,
    Condition,
    LogicalOperator,
    ComparisonOperator,
    NumericOperator,
    StringOperator,
    ListOperator,
    DictOperator,
    ExistenceOperator,
    TextOptions,
    ListOptions,
    FilteringException,
)

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.dtos import (
    OTelFlatSpan,
    OTelSpan,
    OTelLink,
    TracingQuery,
    Bucket,
    MetricsBucket,
)
from oss.src.core.shared.dtos import Windowing
from oss.src.core.tracing.utils import marshall
from oss.src.utils.logging import get_module_logger
from oss.src.dbs.postgres.tracing.mappings import map_span_dto_to_span_dbe
from oss.src.dbs.postgres.tracing.dbes import SpanDBE


log = get_module_logger(__name__)


def _normalize_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat(sep=" ", timespec="microseconds")
    return value


class ClickHouseTracingDAO(TracingDAOInterface):
    def __init__(self) -> None:
        self.url = os.getenv(
            "CLICKHOUSE_TRACING_URL",
            "https://er3fulih5c.eu-central-1.aws.clickhouse.cloud:8443",
        )
        self.user = os.getenv("CLICKHOUSE_TRACING_USER", "default")
        self.password = os.getenv("CLICKHOUSE_TRACING_PASSWORD", "")
        self.database = os.getenv("CLICKHOUSE_TRACING_DATABASE", "default")
        self.table = os.getenv("CLICKHOUSE_TRACING_TABLE", "spans_beta")
        self.batch_spans = int(os.getenv("CLICKHOUSE_TRACING_BATCH_SPANS", "1000"))

    async def _query_json(self, sql: str) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                self.url,
                params={"query": f"{sql} FORMAT JSON"},
                auth=(self.user, self.password),
            )
            response.raise_for_status()
            return response.json()

    def _normalize_uuid(self, value: str) -> str:
        if not value:
            return value
        v = value.replace("-", "")
        if len(v) == 32:
            return f"{v[0:8]}-{v[8:12]}-{v[12:16]}-{v[16:20]}-{v[20:32]}"
        return value

    def _escape_sql(self, value: str) -> str:
        return value.replace("'", "''")

    def _format_literal(self, value: Any) -> str:
        if value is None:
            return "NULL"
        if isinstance(value, Enum):
            return self._format_literal(value.value)
        if isinstance(value, bool):
            return "1" if value else "0"
        if isinstance(value, (int, float)):
            return str(value)
        if isinstance(value, datetime):
            return self._format_datetime(value)
        return f"'{self._escape_sql(str(value))}'"

    def _format_datetime(self, value: datetime) -> str:
        # ClickHouse toDateTime64 doesn't accept timezone offsets like +00:00
        # Convert to UTC and format without timezone suffix
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        formatted = value.strftime("%Y-%m-%d %H:%M:%S.%f")
        return f"toDateTime64('{formatted}', 6, 'UTC')"

    def _bucket_key(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        if isinstance(value, datetime):
            dt = value
        else:
            text = str(value).strip()
            if not text:
                return None
            text = text.replace(" ", "T")
            if text.endswith("Z"):
                text = text[:-1] + "+00:00"
            try:
                dt = datetime.fromisoformat(text)
            except ValueError:
                return None

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)

        return dt.isoformat()

    def _format_uuid(self, value: Union[UUID, str]) -> str:
        normalized = self._normalize_uuid(str(value))
        return f"toUUID('{self._escape_sql(normalized)}')"

    def _json_extract_expr(
        self, *, key: str, value_type: str = "string", source: str = "attributes"
    ) -> str:
        parts = [p for p in key.split(".") if p]
        if not parts:
            return ""
        quoted = ", ".join(f"'{self._escape_sql(p)}'" for p in parts)
        json_source = f"toJSONString({source})"
        if value_type == "float":
            return f"JSONExtractFloat({json_source}, {quoted})"
        if value_type == "int":
            return f"JSONExtractUInt({json_source}, {quoted})"
        if value_type == "raw":
            return f"JSONExtractRaw({json_source}, {quoted})"
        return f"JSONExtractString({json_source}, {quoted})"

    def _attributes_expr(self, key: str, *, value_type: str) -> str:
        metric_path = f"attributes.{key}"
        mapped = self._metric_expr(MetricSpec(path=metric_path))
        if mapped:
            return mapped
        return self._json_extract_expr(key=key, value_type=value_type)

    def _string_match_expr(
        self,
        *,
        expr: str,
        operator: StringOperator,
        value: str,
        options: Optional[TextOptions] = None,
    ) -> str:
        if not isinstance(options, TextOptions):
            options = TextOptions()
        case_sensitive = bool(options.case_sensitive)
        exact_match = bool(options.exact_match)
        pattern = value

        def wrap_like(text: str) -> str:
            return f"'{self._escape_sql(text)}'"

        if operator == StringOperator.STARTSWITH:
            pattern = f"{value}%"
            clause = f"{expr} LIKE {wrap_like(pattern)}"
        elif operator == StringOperator.ENDSWITH:
            pattern = f"%{value}"
            clause = f"{expr} LIKE {wrap_like(pattern)}"
        elif operator == StringOperator.CONTAINS:
            pattern = f"%{value}%"
            clause = f"{expr} LIKE {wrap_like(pattern)}"
        elif operator == StringOperator.LIKE:
            clause = f"{expr} LIKE {wrap_like(value)}"
        elif operator == StringOperator.MATCHES:
            if exact_match:
                clause = f"{expr} = {wrap_like(value)}"
            else:
                pattern = f"%{value}%"
                clause = f"{expr} LIKE {wrap_like(pattern)}"
        else:
            clause = f"{expr} = {wrap_like(value)}"

        if case_sensitive:
            return clause
        if "LIKE" in clause:
            rhs = clause.split("LIKE")[-1].strip()
            return f"lower({expr}) LIKE lower({rhs})"
        rhs = clause.split("=")[-1].strip()
        return f"lower({expr}) = lower({rhs})"

    def _condition_to_sql(self, condition: Condition) -> Optional[str]:
        field = condition.field
        key = condition.key
        value = condition.value
        operator = condition.operator or ComparisonOperator.IS
        options = condition.options

        # Resolve enums
        if isinstance(operator, Enum):
            operator = operator

        # Field aliases
        if field in ["environment", "variant"]:
            expr = self._json_extract_expr(
                key=f"ag.data.parameters.{field}", value_type="string"
            )
            return self._build_simple_condition(expr, operator, value, options)

        if field == "content":
            if not value:
                return None
            pattern = self._escape_sql(str(value))
            return (
                f"match(toJSONString(attributes), '{pattern}') "
                f"OR match(toJSONString(events), '{pattern}')"
            )

        # UUID fields
        if field in ["trace_id", "span_id", "parent_id", "created_by_id", "updated_by_id", "deleted_by_id"]:
            expr = field
            return self._build_uuid_condition(expr, operator, value, options)

        # Enum-like fields
        if field in ["trace_type", "span_type", "span_kind", "status_code"]:
            expr = field
            return self._build_simple_condition(expr, operator, value, options)

        if field in ["span_name", "status_message"]:
            expr = field
            return self._build_string_condition(expr, operator, value, options)

        if field in ["start_time", "end_time", "created_at", "updated_at", "deleted_at"]:
            expr = field
            return self._build_datetime_condition(expr, operator, value, options)

        if field == "attributes":
            if not key:
                return None
            expr = self._attributes_expr(
                key=key,
                value_type="float" if isinstance(operator, NumericOperator) else "string",
            )
            return self._build_simple_condition(expr, operator, value, options)

        if field in ["links", "references", "events"]:
            return self._build_list_json_condition(field, operator, value, options, key)

        return None

    def _build_uuid_condition(
        self,
        expr: str,
        operator: Union[
            ComparisonOperator,
            NumericOperator,
            StringOperator,
            ListOperator,
            DictOperator,
            ExistenceOperator,
        ],
        value: Any,
        options: Optional[ListOptions] = None,
    ) -> Optional[str]:
        if isinstance(operator, ComparisonOperator):
            if value is None:
                return f"{expr} IS {'NOT ' if operator == ComparisonOperator.IS_NOT else ''}NULL"
            return f"{expr} {'!=' if operator == ComparisonOperator.IS_NOT else '='} {self._format_uuid(value)}"
        if isinstance(operator, ListOperator) and isinstance(value, list):
            ids = ",".join(self._format_uuid(v) for v in value)
            if operator == ListOperator.IN:
                return f"{expr} IN ({ids})"
            if operator == ListOperator.NOT_IN:
                return f"{expr} NOT IN ({ids})"
        if isinstance(operator, ExistenceOperator):
            return f"{expr} IS {'NOT ' if operator == ExistenceOperator.NOT_EXISTS else ''}NULL"
        return None

    def _build_datetime_condition(
        self,
        expr: str,
        operator: Union[
            ComparisonOperator,
            NumericOperator,
            StringOperator,
            ListOperator,
            DictOperator,
            ExistenceOperator,
        ],
        value: Any,
        options: Optional[ListOptions] = None,
    ) -> Optional[str]:
        if isinstance(operator, ComparisonOperator):
            if value is None:
                return f"{expr} IS {'NOT ' if operator == ComparisonOperator.IS_NOT else ''}NULL"
            return f"{expr} {'!=' if operator == ComparisonOperator.IS_NOT else '='} {self._format_literal(value)}"
        if isinstance(operator, NumericOperator):
            if operator == NumericOperator.BETWEEN and isinstance(value, list) and len(value) == 2:
                return f"{expr} BETWEEN {self._format_literal(value[0])} AND {self._format_literal(value[1])}"
            op_map = {
                NumericOperator.EQ: "=",
                NumericOperator.NEQ: "!=",
                NumericOperator.GT: ">",
                NumericOperator.LT: "<",
                NumericOperator.GTE: ">=",
                NumericOperator.LTE: "<=",
            }
            return f"{expr} {op_map.get(operator, '=')} {self._format_literal(value)}"
        if isinstance(operator, ListOperator) and isinstance(value, list):
            vals = ",".join(self._format_literal(v) for v in value)
            if operator == ListOperator.IN:
                return f"{expr} IN ({vals})"
            if operator == ListOperator.NOT_IN:
                return f"{expr} NOT IN ({vals})"
        return None

    def _build_string_condition(
        self,
        expr: str,
        operator: Union[
            ComparisonOperator,
            NumericOperator,
            StringOperator,
            ListOperator,
            DictOperator,
            ExistenceOperator,
        ],
        value: Any,
        options: Optional[Union[TextOptions, ListOptions]] = None,
    ) -> Optional[str]:
        if isinstance(operator, ComparisonOperator):
            if value is None:
                return f"{expr} IS {'NOT ' if operator == ComparisonOperator.IS_NOT else ''}NULL"
            return f"{expr} {'!=' if operator == ComparisonOperator.IS_NOT else '='} {self._format_literal(value)}"
        if isinstance(operator, StringOperator) and value is not None:
            return self._string_match_expr(
                expr=expr,
                operator=operator,
                value=str(value),
                options=options if isinstance(options, TextOptions) else None,
            )
        if isinstance(operator, NumericOperator) and value is not None:
            op_map = {
                NumericOperator.EQ: "=",
                NumericOperator.NEQ: "!=",
                NumericOperator.GT: ">",
                NumericOperator.LT: "<",
                NumericOperator.GTE: ">=",
                NumericOperator.LTE: "<=",
            }
            if operator == NumericOperator.BETWEEN and isinstance(value, list) and len(value) == 2:
                return f"{expr} BETWEEN {self._format_literal(value[0])} AND {self._format_literal(value[1])}"
            return f"{expr} {op_map.get(operator, '=')} {self._format_literal(value)}"
        if isinstance(operator, ListOperator) and isinstance(value, list):
            vals = ",".join(self._format_literal(v) for v in value)
            if operator == ListOperator.IN:
                return f"{expr} IN ({vals})"
            if operator == ListOperator.NOT_IN:
                return f"{expr} NOT IN ({vals})"
        if isinstance(operator, ExistenceOperator):
            return f"{expr} IS {'NOT ' if operator == ExistenceOperator.NOT_EXISTS else ''}NULL"
        return None

    def _build_simple_condition(
        self,
        expr: str,
        operator: Union[ComparisonOperator, NumericOperator, StringOperator, ListOperator, DictOperator, ExistenceOperator],
        value: Any,
        options: Optional[Union[TextOptions, ListOptions]] = None,
    ) -> Optional[str]:
        if isinstance(operator, StringOperator):
            return self._build_string_condition(expr, operator, value, options)
        if isinstance(operator, NumericOperator):
            return self._build_string_condition(expr, operator, value, options)
        if isinstance(operator, ComparisonOperator):
            return self._build_string_condition(expr, operator, value, options)
        if isinstance(operator, ListOperator):
            return self._build_string_condition(expr, operator, value, options)
        if isinstance(operator, ExistenceOperator):
            return self._build_string_condition(expr, operator, value, options)
        if isinstance(operator, DictOperator):
            return None
        return None

    def _build_list_json_condition(
        self,
        field: str,
        operator: Union[
            ComparisonOperator,
            NumericOperator,
            StringOperator,
            ListOperator,
            DictOperator,
            ExistenceOperator,
        ],
        value: Any,
        options: Optional[ListOptions] = None,
        key: Optional[str] = None,
    ) -> Optional[str]:
        json_expr = f"toJSONString(`{field}`)"
        if isinstance(operator, ExistenceOperator):
            return f"{json_expr} IS {'NOT ' if operator == ExistenceOperator.NOT_EXISTS else ''}NULL"
        if isinstance(operator, ComparisonOperator):
            if value is None:
                return f"{json_expr} IS {'NOT ' if operator == ComparisonOperator.IS_NOT else ''}NULL"
            return f"{json_expr} {'!=' if operator == ComparisonOperator.IS_NOT else '='} {self._format_literal(value)}"
        if isinstance(operator, DictOperator) and key is not None:
            needle = self._escape_sql(str(key))
            if operator == DictOperator.HAS:
                return f"match({json_expr}, '{needle}')"
            if operator == DictOperator.HAS_NOT:
                return f"NOT match({json_expr}, '{needle}')"
        if isinstance(operator, ListOperator) and isinstance(value, list):
            needles: List[str] = []
            for item in value:
                if isinstance(item, dict):
                    if item.get("id"):
                        needles.append(str(item.get("id")))
                    elif item.get("name"):
                        needles.append(str(item.get("name")))
                else:
                    needles.append(str(item))
            if not needles:
                return None
            regex = "|".join(self._escape_sql(n) for n in needles)
            if operator == ListOperator.IN:
                return f"match({json_expr}, '{regex}')"
            if operator == ListOperator.NOT_IN:
                return f"NOT match({json_expr}, '{regex}')"
        return None

    def _combine_filtering(self, filtering: Filtering) -> Optional[str]:
        clauses: List[str] = []
        for item in filtering.conditions:
            if isinstance(item, Filtering):
                nested = self._combine_filtering(item)
                if nested:
                    clauses.append(nested)
            elif isinstance(item, Condition):
                clause = self._condition_to_sql(item)
                if clause:
                    clauses.append(clause)
        if not clauses:
            return None
        operator = filtering.operator
        if operator == LogicalOperator.AND:
            return "(" + " AND ".join(clauses) + ")"
        if operator == LogicalOperator.OR:
            return "(" + " OR ".join(clauses) + ")"
        if operator == LogicalOperator.NAND:
            return "NOT (" + " AND ".join(clauses) + ")"
        if operator == LogicalOperator.NOR:
            return "NOT (" + " OR ".join(clauses) + ")"
        if operator == LogicalOperator.NOT:
            if len(clauses) != 1:
                raise FilteringException("'NOT' operator only supports a single condition.")
            return "NOT (" + clauses[0] + ")"
        raise FilteringException(f"Unsupported logical operator: {operator}")

    def _build_time_window_clauses(
        self,
        *,
        windowing: Optional[Windowing],
        time_col: str,
        id_col: str,
        default_order: str = "descending",
        include_cursor: bool = True,
    ) -> Tuple[List[str], str]:
        if not windowing:
            return [], default_order
        order = windowing.order or default_order
        clauses: List[str] = []
        newest = windowing.newest
        oldest = windowing.oldest
        next_id = windowing.next

        if order == "ascending":
            if newest:
                clauses.append(f"{time_col} <= {self._format_datetime(newest)}")
            if oldest:
                if next_id:
                    clauses.append(f"{time_col} >= {self._format_datetime(oldest)}")
                else:
                    clauses.append(f"{time_col} > {self._format_datetime(oldest)}")
            if include_cursor and next_id:
                next_expr = self._format_uuid(next_id)
                if oldest:
                    clauses.append(
                        "(" +
                        f"{time_col} > {self._format_datetime(oldest)} OR "
                        f"({time_col} = {self._format_datetime(oldest)} AND {id_col} > {next_expr})" +
                        ")"
                    )
                else:
                    clauses.append(f"{id_col} > {next_expr}")
        else:
            if newest:
                if next_id:
                    clauses.append(f"{time_col} <= {self._format_datetime(newest)}")
                else:
                    clauses.append(f"{time_col} < {self._format_datetime(newest)}")
            if oldest:
                clauses.append(f"{time_col} >= {self._format_datetime(oldest)}")
            if include_cursor and next_id:
                next_expr = self._format_uuid(next_id)
                if newest:
                    clauses.append(
                        "(" +
                        f"{time_col} < {self._format_datetime(newest)} OR "
                        f"({time_col} = {self._format_datetime(newest)} AND {id_col} < {next_expr})" +
                        ")"
                    )
                else:
                    clauses.append(f"{id_col} < {next_expr}")

        return clauses, order

    def _build_where(
        self,
        *,
        project_id: UUID,
        query: Optional[TracingQuery] = None,
        time_col: Optional[str] = None,
        include_cursor: bool = True,
        include_time: bool = True,
        include_filtering: bool = True,
        include_sampling: bool = True,
    ) -> Tuple[str, str]:
        clauses = [f"project_id = {self._format_uuid(project_id)}"]
        order = "descending"

        windowing = query.windowing if query else None
        if include_time and time_col and windowing:
            time_clauses, order = self._build_time_window_clauses(
                windowing=windowing,
                time_col=time_col,
                id_col="span_id",
                default_order="descending",
                include_cursor=include_cursor,
            )
            clauses.extend(time_clauses)

        if include_filtering and query and query.filtering:
            filter_clause = self._combine_filtering(query.filtering)
            if filter_clause:
                clauses.append(filter_clause)

        if include_sampling and windowing and windowing.rate is not None:
            percent = max(0, min(int(windowing.rate * 100.0), 100))
            if percent == 0:
                clauses.append("1 = 0")
            elif percent < 100:
                clauses.append(
                    f"(cityHash64(trace_id) % 100) < {percent}"
                )

        return " AND ".join(clauses), order

    def _metric_expr(self, spec: MetricSpec) -> str:
        if spec.path == "attributes.ag.metrics.duration.cumulative":
            return "duration_cumulative"
        if spec.path == "attributes.ag.metrics.tokens.cumulative.total":
            return "tokens_total"
        if spec.path == "attributes.ag.metrics.costs.cumulative.total":
            return "cost_total"
        if spec.path == "attributes.ag.metrics.errors.cumulative":
            return "JSONExtractFloat(toJSONString(attributes), 'ag','metrics','errors','cumulative')"
        if spec.path == "attributes.ag.type.trace":
            return "trace_type"
        if spec.path == "attributes.ag.type.span":
            return "span_type"

        if spec.path.startswith("attributes."):
            parts = spec.path.split(".")[1:]
            quoted = ", ".join(f"'{p}'" for p in parts)
            return f"JSONExtractString(toJSONString(attributes), {quoted})"
        return ""

    def _normalize_json_sequence(self, value: Any) -> List[Any]:
        if value is None:
            return []
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            if not value:
                return []
            if all(str(k).isdigit() for k in value.keys()):
                return [value[k] for k in sorted(value.keys(), key=lambda x: int(str(x)))]
            return [value]
        return []

    def _to_json_object(self, value: Any) -> Dict[str, Any]:
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
        if isinstance(value, list):
            return {str(i): item for i, item in enumerate(value)}
        return {"0": value}

    def _normalize_datetime_value(self, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc)
        if isinstance(value, str):
            text = value.strip()
            if not text:
                return value
            text = text.replace(" ", "T")
            if text.endswith("Z") or re.search(r"[+-]\d{2}:\d{2}$", text):
                return text
            return f"{text}Z"
        return value

    def _row_to_span(self, row: Dict[str, Any]) -> OTelSpan:
        payload = dict(row)
        for field in ["created_at", "updated_at", "deleted_at", "start_time", "end_time"]:
            payload[field] = self._normalize_datetime_value(payload.get(field))
        payload["references"] = self._normalize_json_sequence(payload.get("references"))
        payload["links"] = self._normalize_json_sequence(payload.get("links"))
        payload["hashes"] = self._normalize_json_sequence(payload.get("hashes"))
        payload["events"] = self._normalize_json_sequence(payload.get("events"))
        if payload.get("attributes") is None:
            payload["attributes"] = {}
        return OTelSpan(**payload)

    async def ingest(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        if not span_dtos:
            return []

        rows: List[Dict[str, Any]] = []
        for span_dto in span_dtos:
            span_dbe = map_span_dto_to_span_dbe(
                project_id=project_id,
                user_id=user_id,
                span_dto=span_dto,
            )
            row = {c.name: getattr(span_dbe, c.name) for c in SpanDBE.__table__.columns}
            for key, value in row.items():
                row[key] = _normalize_value(value)

            if span_dto.references:
                row["references"] = self._to_json_object([
                    marshall(ref.model_dump(mode="json", exclude_none=True))
                    for ref in span_dto.references
                ])
            if span_dto.links:
                row["links"] = self._to_json_object([
                    marshall(link.model_dump(mode="json", exclude_none=True))
                    for link in span_dto.links
                ])
            if span_dto.hashes:
                row["hashes"] = self._to_json_object([
                    marshall(hash.model_dump(mode="json", exclude_none=True))
                    for hash in span_dto.hashes
                ])
            if span_dto.events:
                row["events"] = self._to_json_object([
                    event.model_dump(mode="json") for event in span_dto.events
                ])

            row["references"] = self._to_json_object(row.get("references"))
            row["links"] = self._to_json_object(row.get("links"))
            row["hashes"] = self._to_json_object(row.get("hashes"))
            row["events"] = self._to_json_object(row.get("events"))

            rows.append(row)

        query = f"INSERT INTO {self.database}.{self.table} FORMAT JSONEachRow"

        async with httpx.AsyncClient(timeout=120.0) as client:
            for i in range(0, len(rows), self.batch_spans):
                chunk = rows[i : i + self.batch_spans]
                payload = "\n".join(json.dumps(row) for row in chunk)
                response = await client.post(
                    self.url,
                    params={"query": query},
                    auth=(self.user, self.password),
                    content=payload.encode("utf-8"),
                    headers={"Content-Type": "application/json"},
                )
                if response.status_code >= 400:
                    log.error(
                        "[clickhouse] ingest failed",
                        status_code=response.status_code,
                        response_body=response.text[:2000],
                    )
                response.raise_for_status()

        link_dtos = [
            OTelLink(trace_id=span_dto.trace_id, span_id=span_dto.span_id)
            for span_dto in span_dtos
        ]
        return link_dtos

    async def query(
        self, *, project_id: UUID, query: TracingQuery
    ) -> List[OTelFlatSpan]:
        focus = query.formatting.focus if query.formatting else Focus.TRACE

        if focus == Focus.TRACE:
            base_where, _ = self._build_where(
                project_id=project_id,
                query=query,
                time_col="start_time",
                include_cursor=False,
                include_time=True,
                include_filtering=True,
                include_sampling=True,
            )
            filtered_cte = (
                "filtered AS ("
                f"SELECT trace_id, start_time FROM {self.database}.{self.table} "
                f"WHERE {base_where}"
                ")"
            )
            latest_cte = (
                "latest AS ("
                "SELECT trace_id, max(start_time) AS max_start "
                "FROM filtered GROUP BY trace_id"
                ")"
            )

            windowing = query.windowing
            order = windowing.order if windowing and windowing.order else "descending"
            paging_clauses, order = self._build_time_window_clauses(
                windowing=windowing,
                time_col="max_start",
                id_col="trace_id",
                default_order="descending",
                include_cursor=True,
            ) if windowing else ([], order)

            paging_where = " AND ".join(paging_clauses) if paging_clauses else "1 = 1"
            limit_clause = (
                f"LIMIT {windowing.limit}" if windowing and windowing.limit else ""
            )

            paged_cte = (
                "paged AS ("
                "SELECT trace_id, max_start FROM latest "
                f"WHERE {paging_where} "
                f"ORDER BY max_start {'ASC' if order == 'ascending' else 'DESC'}, trace_id "
                f"{limit_clause}"
                ")"
            )

            sql = (
                f"WITH {filtered_cte}, {latest_cte}, {paged_cte} "
                f"SELECT s.* FROM {self.database}.{self.table} s "
                "INNER JOIN paged p ON s.trace_id = p.trace_id "
                f"WHERE s.project_id = {self._format_uuid(project_id)} "
                f"ORDER BY p.max_start {'ASC' if order == 'ascending' else 'DESC'}, s.start_time ASC"
            )
        else:
            where, order = self._build_where(
                project_id=project_id,
                query=query,
                time_col="start_time",
                include_cursor=True,
                include_time=True,
                include_filtering=True,
                include_sampling=True,
            )
            limit_clause = (
                f"LIMIT {query.windowing.limit}"
                if query.windowing and query.windowing.limit
                else ""
            )
            sql = (
                "SELECT * FROM {db}.{table} WHERE {where} "
                "ORDER BY start_time {direction}, span_id {direction} {limit}"
            ).format(
                db=self.database,
                table=self.table,
                where=where,
                direction="ASC" if order == "ascending" else "DESC",
                limit=limit_clause,
            )

        data = await self._query_json(sql)
        rows = data.get("data", [])
        return [self._row_to_span(row) for row in rows]

    async def analytics(
        self, *, project_id: UUID, query: TracingQuery, specs: List[MetricSpec]
    ) -> List[MetricsBucket]:
        if not specs:
            return []

        if not query.windowing:
            query.windowing = Windowing()

        oldest, newest, _, interval, timestamps = parse_windowing(query.windowing)
        where, _ = self._build_where(
            project_id=project_id,
            query=query,
            time_col="created_at",
            include_cursor=False,
            include_time=True,
            include_filtering=True,
            include_sampling=True,
        )

        oldest_expr = self._format_datetime(oldest)
        if interval:
            bucket_expr = (
                f"toStartOfInterval(created_at, INTERVAL {interval} minute, {oldest_expr})"
            )
        else:
            bucket_expr = oldest_expr

        metrics_by_bucket: Dict[str, Dict[str, Any]] = {
            t.isoformat(): {} for t in timestamps
        }

        for spec in specs:
            if spec.type not in [
                MetricType.NUMERIC_CONTINUOUS,
                MetricType.CATEGORICAL_SINGLE,
            ]:
                continue

            expr = self._metric_expr(spec)
            if not expr:
                continue

            if spec.type == MetricType.CATEGORICAL_SINGLE:
                sql = (
                    "SELECT {bucket} AS timestamp, {expr} AS value, count() AS count "
                    "FROM {db}.{table} WHERE {where} "
                    "GROUP BY timestamp, value ORDER BY timestamp"
                ).format(
                    bucket=bucket_expr,
                    expr=expr,
                    db=self.database,
                    table=self.table,
                    where=where,
                )
                data = await self._query_json(sql)
                for row in data.get("data", []):
                    ts = row.get("timestamp")
                    ts_key = ts.isoformat() if isinstance(ts, datetime) else str(ts)
                    bucket_metrics = metrics_by_bucket.setdefault(ts_key, {})
                    metric_entry = bucket_metrics.setdefault(
                        spec.path,
                        {"type": spec.type.value, "value": {}},
                    )
                    metric_entry["value"][row.get("value")] = row.get("count")
                continue

            bins = spec.bins or 20
            sql = (
                "SELECT {bucket} AS timestamp, "
                "count() AS count, min({expr}) AS min, max({expr}) AS max, "
                "sum({expr}) AS sum, avg({expr}) AS mean, "
                "quantilesExact({pcts})({expr}) AS pcts, "
                "histogram({bins})({expr}) AS hist "
                "FROM {db}.{table} WHERE {where} "
                "GROUP BY timestamp ORDER BY timestamp"
            ).format(
                bucket=bucket_expr,
                expr=expr,
                pcts=", ".join(str(v) for v in PERCENTILES_VALUES),
                bins=bins,
                db=self.database,
                table=self.table,
                where=where,
            )
            data = await self._query_json(sql)
            for row in data.get("data", []):
                ts = row.get("timestamp")
                ts_key = ts.isoformat() if isinstance(ts, datetime) else str(ts)
                pcts_vals = row.get("pcts") or []
                pcts = {
                    key: pcts_vals[idx] if idx < len(pcts_vals) else None
                    for idx, key in enumerate(PERCENTILES_KEYS)
                }
                hist = []
                hist_raw = row.get("hist") or []
                for idx, item in enumerate(hist_raw, start=1):
                    if isinstance(item, list) or isinstance(item, tuple):
                        if len(item) == 3:
                            start, end, count = item
                        else:
                            start, end, count = None, None, item
                    else:
                        start, end, count = None, None, item
                    hist.append(
                        {
                            "bin": idx,
                            "count": count,
                            "interval": [start, end],
                        }
                    )

                metrics_by_bucket.setdefault(ts_key, {})[spec.path] = {
                    "type": spec.type.value,
                    "count": row.get("count"),
                    "min": row.get("min"),
                    "max": row.get("max"),
                    "sum": row.get("sum"),
                    "mean": row.get("mean"),
                    "range": (row.get("max") or 0) - (row.get("min") or 0),
                    "pcts": pcts,
                    "hist": hist,
                }

        buckets: List[MetricsBucket] = []
        for ts_key, metrics in metrics_by_bucket.items():
            bucket = MetricsBucket(
                timestamp=datetime.fromisoformat(ts_key),
                interval=interval,
                metrics=metrics,
            )
            buckets.append(bucket)
        return buckets

    async def legacy_analytics(
        self, *, project_id: UUID, query: TracingQuery
    ) -> List[Bucket]:
        if not query.windowing:
            query.windowing = Windowing()

        oldest, newest, _, interval, timestamps = parse_windowing(query.windowing)
        where, _ = self._build_where(
            project_id=project_id,
            query=query,
            time_col="created_at",
            include_cursor=False,
            include_time=True,
            include_filtering=True,
            include_sampling=True,
        )

        oldest_expr = self._format_datetime(oldest)
        if interval:
            bucket_expr = (
                f"toStartOfInterval(created_at, INTERVAL {interval} minute, {oldest_expr})"
            )
        else:
            bucket_expr = oldest_expr

        focus = query.formatting.focus if query.formatting else Focus.TRACE
        focus_clause = "parent_id IS NULL" if focus == Focus.TRACE else "1 = 1"

        total_sql = (
            "SELECT {bucket} AS timestamp, count() AS count, "
            "sum(duration_cumulative) AS duration, "
            "sum(cost_total) AS costs, sum(tokens_total) AS tokens "
            "FROM {db}.{table} WHERE {where} AND {focus} "
            "GROUP BY timestamp ORDER BY timestamp"
        ).format(
            bucket=bucket_expr,
            db=self.database,
            table=self.table,
            where=where,
            focus=focus_clause,
        )

        exception_pattern = r'"name"\s*:\s*"exception"'
        error_sql = (
            "SELECT {bucket} AS timestamp, count() AS count, "
            "sum(duration_cumulative) AS duration, "
            "sum(cost_total) AS costs, sum(tokens_total) AS tokens "
            "FROM {db}.{table} WHERE {where} AND {focus} "
            "AND match(toJSONString(events), '{pattern}') "
            "GROUP BY timestamp ORDER BY timestamp"
        ).format(
            bucket=bucket_expr,
            db=self.database,
            table=self.table,
            where=where,
            focus=focus_clause,
            pattern=exception_pattern,
        )

        total_data = await self._query_json(total_sql)
        error_data = await self._query_json(error_sql)

        totals_by_ts = {
            key: row
            for row in total_data.get("data", [])
            for key in [self._bucket_key(row.get("timestamp"))]
            if key
        }
        errors_by_ts = {
            key: row
            for row in error_data.get("data", [])
            for key in [self._bucket_key(row.get("timestamp"))]
            if key
        }

        buckets: List[Bucket] = []
        for ts in timestamps:
            bucket_key = self._bucket_key(ts)
            total_row = totals_by_ts.get(bucket_key) if bucket_key else None
            error_row = errors_by_ts.get(bucket_key) if bucket_key else None
            buckets.append(
                Bucket(
                    timestamp=ts,
                    interval=interval,
                    total={
                        "count": total_row.get("count") if total_row else 0,
                        "duration": total_row.get("duration") if total_row else 0,
                        "costs": total_row.get("costs") if total_row else 0,
                        "tokens": total_row.get("tokens") if total_row else 0,
                    },
                    errors={
                        "count": error_row.get("count") if error_row else 0,
                        "duration": error_row.get("duration") if error_row else 0,
                        "costs": error_row.get("costs") if error_row else 0,
                        "tokens": error_row.get("tokens") if error_row else 0,
                    },
                )
            )
        return buckets

    async def fetch(
        self, *, project_id: UUID, trace_ids: List[UUID]
    ) -> List[OTelFlatSpan]:
        if not trace_ids:
            return []
        ids = ",".join(f"toUUID('{tid}')" for tid in trace_ids)
        sql = (
            "SELECT * FROM {db}.{table} "
            "WHERE project_id = toUUID('{project_id}') AND trace_id IN ({ids}) "
            "ORDER BY start_time"
        ).format(db=self.database, table=self.table, project_id=project_id, ids=ids)
        data = await self._query_json(sql)
        rows = data.get("data", [])
        return [self._row_to_span(row) for row in rows]

    async def delete(
        self, *, project_id: UUID, trace_ids: List[UUID]
    ) -> List[OTelLink]:
        if not trace_ids:
            return []
        ids = ",".join(f"toUUID('{tid}')" for tid in trace_ids)
        sql = (
            "ALTER TABLE {db}.{table} DELETE WHERE project_id = toUUID('{project_id}') "
            "AND trace_id IN ({ids})"
        ).format(db=self.database, table=self.table, project_id=project_id, ids=ids)
        await self._query_json(sql)
        return [OTelLink(trace_id=str(tid), span_id="") for tid in trace_ids]

    async def sessions(
        self,
        *,
        project_id: UUID,
        realtime: Optional[bool] = None,
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        return await self._query_by_group(
            project_id=project_id,
            group="session",
            realtime=realtime,
            windowing=windowing,
        )

    async def users(
        self,
        *,
        project_id: UUID,
        realtime: Optional[bool] = None,
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        return await self._query_by_group(
            project_id=project_id,
            group="user",
            realtime=realtime,
            windowing=windowing,
        )

    async def _query_by_group(
        self,
        *,
        project_id: UUID,
        group: str,
        realtime: Optional[bool] = None,
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        id_expr = self._json_extract_expr(
            key=f"ag.{group}.id", value_type="string"
        )

        base_where, order = self._build_where(
            project_id=project_id,
            query=TracingQuery(windowing=windowing),
            time_col="start_time",
            include_cursor=False,
            include_time=True,
            include_filtering=False,
            include_sampling=False,
        )

        base_where = (
            f"{base_where} AND {id_expr} IS NOT NULL AND {id_expr} != ''"
        )

        activity_expr = "max(start_time)" if realtime else "min(start_time)"
        activity_label = "last_active" if realtime else "first_active"

        paging_clauses, order = self._build_time_window_clauses(
            windowing=windowing,
            time_col=activity_label,
            id_col="id",
            default_order="descending",
            include_cursor=False,
        ) if windowing else ([], order)

        paging_where = " AND ".join(paging_clauses) if paging_clauses else "1 = 1"
        limit_clause = f"LIMIT {windowing.limit}" if windowing and windowing.limit else ""

        sql = (
            "WITH grouped AS ("
            "SELECT {id_expr} AS id, "
            f"{activity_expr} AS {activity_label} "
            "FROM {db}.{table} WHERE {where} "
            "GROUP BY id"
            ") "
            "SELECT id, {activity_label} FROM grouped "
            f"WHERE {paging_where} "
            f"ORDER BY {activity_label} {'ASC' if order == 'ascending' else 'DESC'} "
            f"{limit_clause}"
        ).format(
            id_expr=id_expr,
            activity_label=activity_label,
            activity_expr=activity_expr,
            db=self.database,
            table=self.table,
            where=base_where,
        )

        data = await self._query_json(sql)
        rows = data.get("data", [])
        ids: List[str] = []
        activity_cursor: Optional[datetime] = None
        for row in rows:
            if row.get("id"):
                ids.append(str(row.get("id")))
                activity_cursor = row.get(activity_label)

        return ids, activity_cursor
