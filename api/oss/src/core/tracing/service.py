from typing import TYPE_CHECKING, Dict, List, Optional, Tuple, Union
from uuid import UUID
from datetime import datetime

from oss.src.utils.logging import get_module_logger
from oss.src.utils.common import is_ee

from oss.src.core.tracing.interfaces import TracingDAOInterface
from oss.src.core.tracing.utils.parsing import (
    parse_span_id_to_uuid,
    parse_span_id_from_uuid,
    parse_spans_from_request,
    parse_spans_into_response,
    parse_trace_id_from_uuid,
    parse_trace_id_to_uuid,
)
from oss.src.core.tracing.utils.trees import (
    calculate_and_propagate_metrics,
    trace_map_to_traces,
)
from oss.src.core.tracing.streaming import publish_spans
from oss.src.core.tracing.utils.filtering import parse_query
from oss.src.core.tracing.dtos import (
    ComparisonOperator,
    Condition,
    Focus,
    Format,
    Formatting,
    ListOperator,
    OTelLink,
    OTelLinks,
    OTelFlatSpans,
    OTelFlatSpan,
    OTelSpan,
    OTelTraceTree,
    Span,
    Spans,
    TracingQuery,
    Bucket,
    Filtering,
    MetricType,
    MetricSpec,
    MetricsBucket,
    QueryFocusConflictError,
    FilteringException,
    #
    Trace,
    Traces,
    Windowing,
)
from oss.src.core.shared.dtos import Reference

if TYPE_CHECKING:
    from oss.src.core.queries.service import QueriesService


if is_ee():
    from ee.src.utils.entitlements import check_entitlements, Counter


log = get_module_logger(__name__)


DEFAULT_ANALYTICS_SPECS: Tuple[Tuple[MetricType, str], ...] = (
    (MetricType.NUMERIC_CONTINUOUS, "attributes.ag.metrics.duration.cumulative"),
    (MetricType.NUMERIC_CONTINUOUS, "attributes.ag.metrics.errors.cumulative"),
    (MetricType.NUMERIC_CONTINUOUS, "attributes.ag.metrics.costs.cumulative.total"),
    (MetricType.NUMERIC_CONTINUOUS, "attributes.ag.metrics.tokens.cumulative.total"),
    (MetricType.CATEGORICAL_SINGLE, "attributes.ag.type.trace"),
    (MetricType.CATEGORICAL_SINGLE, "attributes.ag.type.span"),
)


class TracingService:
    """
    Tracing service for managing spans and traces.
    """

    def __init__(
        self,
        tracing_dao: TracingDAOInterface,
    ):
        self.tracing_dao = tracing_dao

    ## SPANS

    async def ingest(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        #
        span_dtos: List[OTelFlatSpan],
    ) -> List[OTelLink]:
        """Ingest spans (upsert: create if new, update if exists)."""
        return await self.tracing_dao.ingest(
            project_id=project_id,
            user_id=user_id,
            #
            span_dtos=span_dtos,
        )

    async def ingest_span_dtos(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        span_dtos: List[OTelFlatSpan],
        sync: bool = False,
        propagate_metrics: bool = True,
    ) -> OTelLinks:
        if propagate_metrics:
            span_dtos = calculate_and_propagate_metrics(span_dtos)

        if sync:
            if is_ee():
                delta = sum(1 for span_dto in span_dtos if span_dto.parent_id is None)
                if delta > 0:
                    allowed, _, _ = await check_entitlements(  # type: ignore
                        organization_id=organization_id,
                        key=Counter.TRACES,  # type: ignore
                        delta=delta,
                        use_cache=False,
                    )
                    if not allowed:
                        raise ValueError("Trace quota exceeded for organization")

            await self.ingest(
                project_id=project_id,
                user_id=user_id,
                span_dtos=span_dtos,
            )
        else:
            await publish_spans(
                organization_id=organization_id,
                project_id=project_id,
                user_id=user_id,
                span_dtos=span_dtos,
            )

        return [
            OTelLink(
                trace_id=parse_trace_id_from_uuid(span_dto.trace_id),
                span_id=parse_span_id_from_uuid(span_dto.span_id),
            )
            for span_dto in span_dtos
        ]

    async def ingest_spans(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        spans: Optional[OTelFlatSpans] = None,
        traces: Optional[OTelTraceTree] = None,
        sync: bool = False,
    ) -> OTelLinks:
        _spans: Dict[str, Union[OTelSpan, OTelFlatSpans]] = dict()

        if spans:
            _spans = {
                "spans": [
                    OTelFlatSpan(
                        **span.model_dump(
                            mode="json",
                            exclude_none=True,
                            exclude_unset=True,
                        )
                    )
                    for span in spans
                ]
            }
        elif traces:
            for spans_tree in traces.values():
                if spans_tree.spans:
                    for span in spans_tree.spans.values():
                        if not isinstance(span, list):
                            _spans[span.span_id] = OTelSpan(
                                **span.model_dump(
                                    mode="json",
                                    exclude_none=True,
                                    exclude_unset=True,
                                )
                            )

        span_dtos = parse_spans_from_request(_spans)

        return await self.ingest_span_dtos(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            span_dtos=span_dtos,
            sync=sync,
        )

    ## HELPERS
    # Static/class helper methods are intentionally grouped in this section.

    @staticmethod
    def _extract_single_trace_spans(
        *,
        spans: Optional[OTelFlatSpans] = None,
        traces: Optional[OTelTraceTree] = None,
    ) -> Dict[str, Union[OTelSpan, OTelFlatSpans]]:
        if traces:
            if len(traces) == 0:
                raise ValueError("Missing trace")
            if len(traces) > 1:
                raise ValueError("Too many traces")
            extracted = list(traces.values())[0].spans
            if not extracted:
                raise ValueError("Missing spans")
            return extracted

        if spans:
            extracted = {span.span_id: span for span in spans}
            if not extracted:
                raise ValueError("Missing spans")
            return extracted

        raise ValueError("Missing spans")

    @staticmethod
    def _validate_single_trace_roots(
        spans: Dict[str, Union[OTelSpan, OTelFlatSpans]],
    ) -> None:
        root_spans = 0
        for span in spans.values():
            if not isinstance(span, list) and span.parent_id is None:
                root_spans += 1

        if root_spans == 0:
            raise ValueError("Missing root span")
        if root_spans > 1:
            raise ValueError("Too many root spans")

    @staticmethod
    def _extract_trace_ids_from_spans(
        spans: Dict[str, Union[OTelSpan, OTelFlatSpans]],
    ) -> List[str]:
        trace_ids: List[str] = []
        seen = set()

        for span in spans.values():
            if isinstance(span, list):
                span_items = span
            else:
                span_items = [span]

            for span_item in span_items:
                if not span_item or not span_item.trace_id:
                    continue
                if span_item.trace_id in seen:
                    continue
                seen.add(span_item.trace_id)
                trace_ids.append(span_item.trace_id)

        return trace_ids

    async def create_trace(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        spans: Optional[OTelFlatSpans] = None,
        traces: Optional[OTelTraceTree] = None,
        sync: bool = True,
    ) -> OTelLinks:
        extracted_spans = self._extract_single_trace_spans(spans=spans, traces=traces)
        self._validate_single_trace_roots(extracted_spans)

        return await self.ingest_spans(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            spans=spans,
            traces=traces,
            sync=sync,
        )

    async def edit_trace(
        self,
        *,
        organization_id: UUID,
        project_id: UUID,
        user_id: UUID,
        spans: Optional[OTelFlatSpans] = None,
        traces: Optional[OTelTraceTree] = None,
        sync: bool = True,
    ) -> OTelLinks:
        extracted_spans = self._extract_single_trace_spans(spans=spans, traces=traces)
        self._validate_single_trace_roots(extracted_spans)

        return await self.ingest_spans(
            organization_id=organization_id,
            project_id=project_id,
            user_id=user_id,
            spans=spans,
            traces=traces,
            sync=sync,
        )

    @staticmethod
    def merge_queries(
        query_param: Optional[TracingQuery] = None,
        query_body: Optional[TracingQuery] = None,
    ) -> TracingQuery:
        if query_param is None and query_body is None:
            return TracingQuery(
                formatting=Formatting(
                    focus=Focus.TRACE,
                    format=Format.AGENTA,
                ),
                windowing=None,
                filtering=None,
            )

        if query_body is None and query_param is not None:
            query_param.filtering = query_param.filtering or Filtering()
            return query_param

        if query_param is None and query_body is not None:
            query_body.filtering = query_body.filtering or Filtering()
            return query_body

        return TracingQuery(
            formatting=query_body.formatting or query_param.formatting or Formatting(),
            windowing=query_body.windowing or query_param.windowing or Windowing(),
            filtering=query_body.filtering or query_param.filtering or Filtering(),
        )

    @staticmethod
    def merge_specs(
        specs_params: Optional[List[MetricSpec]],
        specs_body: Optional[List[MetricSpec]],
    ) -> List[MetricSpec]:
        if not specs_params and not specs_body:
            return []
        if not specs_params:
            return specs_body or []
        if not specs_body:
            return specs_params or []
        # Follow the existing body-over-params precedence used by merge_* helpers.
        return specs_body or specs_params or []

    @staticmethod
    def default_analytics_specs() -> List[MetricSpec]:
        return [
            MetricSpec(type=metric_type, path=path)
            for metric_type, path in DEFAULT_ANALYTICS_SPECS
        ]

    @classmethod
    def merge_analytics(
        cls,
        analytics_params: Tuple[Optional[TracingQuery], Optional[List[MetricSpec]]],
        analytics_body: Tuple[Optional[TracingQuery], Optional[List[MetricSpec]]],
    ) -> Tuple[TracingQuery, List[MetricSpec]]:
        query = cls.merge_queries(analytics_params[0], analytics_body[0])
        specs = cls.merge_specs(analytics_params[1], analytics_body[1])
        if not specs:
            specs = cls.default_analytics_specs()
        return query, specs

    @staticmethod
    def _merge_windowing(
        *,
        stored_windowing: Optional[Windowing],
        request_windowing: Optional[Windowing],
    ) -> Optional[Windowing]:
        if not stored_windowing:
            return request_windowing

        merged_windowing = stored_windowing.model_copy()
        updates: Dict[str, Union[str, int, UUID]] = {}
        if request_windowing and request_windowing.limit is not None:
            updates["limit"] = request_windowing.limit
        if request_windowing and request_windowing.next is not None:
            updates["next"] = request_windowing.next
        if updates:
            merged_windowing = merged_windowing.model_copy(update=updates)
        return merged_windowing

    @staticmethod
    def _query_from_request(
        *,
        filtering: Optional[Filtering],
        windowing: Optional[Windowing],
        focus: Focus,
    ) -> TracingQuery:
        return TracingQuery(
            formatting={"focus": focus, "format": Format.AGENTA},
            filtering=filtering,
            windowing=windowing,
        )

    def _query_from_revision(
        self,
        *,
        revision_filtering: Optional[Filtering],
        revision_formatting: Optional[Formatting],
        revision_windowing: Optional[Windowing],
        request_windowing: Optional[Windowing],
        default_focus: Focus,
        conflict_focus: Focus,
        conflict_detail: str,
    ) -> TracingQuery:
        formatting = (
            revision_formatting.model_copy(
                update={
                    "focus": revision_formatting.focus or default_focus,
                    "format": revision_formatting.format or Format.AGENTA,
                }
            )
            if revision_formatting
            else Formatting(focus=default_focus, format=Format.AGENTA)
        )

        if formatting.focus == conflict_focus:
            raise QueryFocusConflictError(conflict_detail)

        merged_windowing = self._merge_windowing(
            stored_windowing=revision_windowing,
            request_windowing=request_windowing,
        )

        return TracingQuery(
            formatting=formatting,
            filtering=revision_filtering,
            windowing=merged_windowing,
        )

    @staticmethod
    def _extract_trace_ids_from_query(query: TracingQuery) -> Optional[List[UUID]]:
        if not query.filtering or not query.filtering.conditions:
            return None

        if len(query.filtering.conditions) != 1:
            return None

        condition = query.filtering.conditions[0]

        if not isinstance(condition, Condition):
            return None
        if condition.field != "trace_id":
            return None
        if condition.operator not in [ComparisonOperator.IS, ListOperator.IN]:
            return None

        try:
            if isinstance(condition.value, list):
                return [UUID(str(tid)) for tid in condition.value]
            return [UUID(str(condition.value))]
        except (ValueError, TypeError):
            return None

    @staticmethod
    def build_next_windowing(
        *,
        input_windowing: Optional[Windowing],
        result_ids: List[str],
        activity_cursor: Optional[datetime],
    ) -> Optional[Windowing]:
        if not (
            input_windowing
            and input_windowing.limit
            and result_ids
            and len(result_ids) >= input_windowing.limit
            and activity_cursor
        ):
            return None

        order_direction = (
            input_windowing.order.lower() if input_windowing.order else "descending"
        )
        if order_direction == "ascending":
            return Windowing(
                newest=input_windowing.newest,
                oldest=activity_cursor,
                limit=input_windowing.limit,
                order=input_windowing.order,
            )
        return Windowing(
            newest=activity_cursor,
            oldest=input_windowing.oldest,
            limit=input_windowing.limit,
            order=input_windowing.order,
        )

    async def resolve_query_request(
        self,
        *,
        project_id: UUID,
        queries_service: Optional["QueriesService"],
        query_ref: Optional[Reference],
        query_variant_ref: Optional[Reference],
        query_revision_ref: Optional[Reference],
        filtering: Optional[Filtering],
        windowing: Optional[Windowing],
        default_focus: Focus,
        conflict_focus: Focus,
        conflict_detail: str,
    ) -> Optional[TracingQuery]:
        if not (query_ref or query_variant_ref or query_revision_ref):
            return self._query_from_request(
                filtering=filtering,
                windowing=windowing,
                focus=default_focus,
            )

        if not queries_service:
            return None

        query_revision = await queries_service.fetch_query_revision(
            project_id=project_id,
            query_ref=query_ref,
            query_variant_ref=query_variant_ref,
            query_revision_ref=query_revision_ref,
        )
        if not query_revision or not query_revision.data:
            return None

        return self._query_from_revision(
            revision_filtering=query_revision.data.filtering,
            revision_formatting=query_revision.data.formatting,
            revision_windowing=query_revision.data.windowing,
            request_windowing=windowing,
            default_focus=default_focus,
            conflict_focus=conflict_focus,
            conflict_detail=conflict_detail,
        )

    async def query(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[OTelFlatSpan]:
        parse_query(query)

        span_dtos = await self.tracing_dao.query(
            project_id=project_id,
            #
            query=query,
        )

        return span_dtos

    async def query_span_dtos(
        self,
        *,
        project_id: UUID,
        query: TracingQuery,
    ) -> OTelFlatSpans:
        trace_ids = self._extract_trace_ids_from_query(query)
        if trace_ids is not None:
            return await self.fetch(
                project_id=project_id,
                trace_ids=trace_ids,
            )

        return await self.query(
            project_id=project_id,
            query=query,
        )

    async def query_spans_or_traces(
        self,
        *,
        project_id: UUID,
        query: TracingQuery,
        focus: Optional[Focus] = None,
    ) -> Optional[Union[OTelFlatSpans, OTelTraceTree]]:
        formatting = query.formatting or Formatting()
        if formatting.focus is None:
            formatting.focus = Focus.TRACE
        if formatting.format is None:
            formatting.format = Format.AGENTA
        if focus is not None:
            formatting.focus = focus

        merged_query = query.model_copy(update={"formatting": formatting})
        span_dtos = await self.query_span_dtos(
            project_id=project_id,
            query=merged_query,
        )

        return parse_spans_into_response(
            span_dtos,
            focus=formatting.focus,
            format=formatting.format,
        )

    async def query_spans(
        self,
        *,
        project_id: UUID,
        query: TracingQuery,
    ) -> Spans:
        spans_or_traces = await self.query_spans_or_traces(
            project_id=project_id,
            query=query,
            focus=Focus.SPAN,
        )
        if isinstance(spans_or_traces, list):
            return spans_or_traces
        return []

    async def fetch_spans(
        self,
        *,
        project_id: UUID,
        trace_ids: Optional[List[str]] = None,
        span_ids: Optional[List[str]] = None,
    ) -> Spans:
        if not trace_ids and not span_ids:
            return []

        try:
            normalized_trace_ids = (
                [UUID(parse_trace_id_to_uuid(trace_id)) for trace_id in trace_ids]
                if trace_ids
                else None
            )
            normalized_span_ids = (
                [UUID(parse_span_id_to_uuid(span_id)) for span_id in span_ids]
                if span_ids
                else None
            )
        except (TypeError, ValueError) as e:
            raise FilteringException(str(e)) from e

        spans = await self.fetch(
            project_id=project_id,
            trace_ids=normalized_trace_ids,
            span_ids=normalized_span_ids,
        )

        spans_or_traces = parse_spans_into_response(
            spans,
            focus=Focus.SPAN,
            format=Format.AGENTA,
        )
        if isinstance(spans_or_traces, list):
            return spans_or_traces
        return []

    async def fetch_span(
        self,
        *,
        project_id: UUID,
        trace_id: str,
        span_id: str,
    ) -> Optional[Span]:
        spans = await self.fetch_spans(
            project_id=project_id,
            trace_ids=[trace_id],
            span_ids=[span_id],
        )
        return spans[0] if spans else None

    async def query_traces(
        self,
        *,
        project_id: UUID,
        query: TracingQuery,
    ) -> Traces:
        spans_or_traces = await self.query_spans_or_traces(
            project_id=project_id,
            query=query,
            focus=Focus.TRACE,
        )
        if isinstance(spans_or_traces, dict):
            return trace_map_to_traces(spans_or_traces)
        return []

    async def analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
        specs: List[MetricSpec],
    ) -> List[MetricsBucket]:
        parse_query(query)

        bucket_dtos = await self.tracing_dao.analytics(
            project_id=project_id,
            #
            query=query,
            specs=specs,
        )

        return bucket_dtos

    async def legacy_analytics(
        self,
        *,
        project_id: UUID,
        #
        query: TracingQuery,
    ) -> List[Bucket]:
        parse_query(query)

        bucket_dtos = await self.tracing_dao.legacy_analytics(
            project_id=project_id,
            #
            query=query,
        )

        return bucket_dtos

    ## TRACES

    async def fetch(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: Optional[List[UUID]] = None,
        span_ids: Optional[List[UUID]] = None,
    ) -> List[OTelFlatSpan]:
        """Fetch spans by trace IDs and/or span IDs."""
        return await self.tracing_dao.fetch(
            project_id=project_id,
            #
            trace_ids=trace_ids,
            span_ids=span_ids,
        )

    async def fetch_traces(
        self,
        *,
        project_id: UUID,
        trace_ids: List[str],
    ) -> Traces:
        if not trace_ids:
            return []

        uuid_ids = [UUID(parse_trace_id_to_uuid(trace_id)) for trace_id in trace_ids]
        spans = await self.fetch(
            project_id=project_id,
            trace_ids=uuid_ids,
        )
        traces = parse_spans_into_response(
            spans,
            focus=Focus.TRACE,
            format=Format.AGENTA,
        )
        if isinstance(traces, dict):
            return trace_map_to_traces(traces)
        return []

    async def fetch_trace(
        self,
        *,
        project_id: UUID,
        trace_id: str,
    ) -> Optional[Trace]:
        normalized_trace_id = UUID(parse_trace_id_to_uuid(trace_id))

        traces = await self.fetch_traces(
            project_id=project_id,
            trace_ids=[str(normalized_trace_id)],
        )
        if not traces:
            return None

        target_hex = normalized_trace_id.hex
        for trace in traces:
            if trace.trace_id in {target_hex, str(normalized_trace_id)}:
                return trace

        return traces[0] if len(traces) == 1 else None

    async def delete(
        self,
        *,
        project_id: UUID,
        #
        trace_ids: List[UUID],
    ) -> List[OTelLink]:
        """Delete all spans for the given trace IDs."""
        return await self.tracing_dao.delete(
            project_id=project_id,
            #
            trace_ids=trace_ids,
        )

    async def delete_trace(
        self,
        *,
        project_id: UUID,
        trace_id: str,
    ) -> OTelLinks:
        normalized_trace_id = UUID(parse_trace_id_to_uuid(trace_id))
        return await self.delete(
            project_id=project_id,
            trace_ids=[normalized_trace_id],
        )

    ## SESSIONS & USERS

    async def sessions(
        self,
        *,
        project_id: UUID,
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        return await self.tracing_dao.sessions(
            project_id=project_id,
            #
            realtime=realtime,
            #
            windowing=windowing,
        )

    async def users(
        self,
        *,
        project_id: UUID,
        #
        realtime: Optional[bool] = None,
        #
        windowing: Optional[Windowing] = None,
    ) -> Tuple[List[str], Optional[datetime]]:
        return await self.tracing_dao.users(
            project_id=project_id,
            #
            realtime=realtime,
            #
            windowing=windowing,
        )
