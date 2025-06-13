from typing import Optional, Tuple, Any, List, Dict
from uuid import UUID
from collections import OrderedDict
from json import loads, JSONDecodeError, dumps
from copy import copy
from datetime import datetime, timedelta, time

from fastapi import Query, HTTPException

from oss.src.apis.fastapi.observability.opentelemetry.semconv import CODEX
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__file__)

from oss.src.apis.fastapi.observability.utils.serialization import (
    decode_key,
    decode_value,
    encode_key,
)
from oss.src.apis.fastapi.observability.utils.marshalling import unmarshal_attributes

from oss.src.apis.fastapi.observability.models import (
    LegacyDataPoint,
    LegacySummary,
)

from oss.src.core.observability.dtos import (
    TimeDTO,
    StatusDTO,
    RootDTO,
    TreeDTO,
    NodeDTO,
    ParentDTO,
    LinkDTO,
    ExceptionDTO,
    Attributes,
    SpanDTO,
    OTelExtraDTO,
    OTelEventDTO,
    OTelSpanDTO,
    OTelContextDTO,
    OTelLinkDTO,
    BucketDTO,
    NodeType,
    TreeType,
)
from oss.src.core.observability.dtos import (
    GroupingDTO,
    WindowingDTO,
    FilteringDTO,
    PaginationDTO,
    QueryDTO,
    AnalyticsDTO,
    ConditionDTO,
)
from oss.src.apis.fastapi.observability.extractors.span_processor import SpanProcessor
from oss.src.apis.fastapi.observability.extractors.span_data_builders import NodeBuilder

node_builder_instance = NodeBuilder()
span_processor = SpanProcessor(builders=[node_builder_instance])


# --- PARSE QUERY / ANALYTICS DTO ---


def _parse_windowing(
    oldest: Optional[str] = None,
    newest: Optional[str] = None,
    window: Optional[int] = None,
) -> Optional[WindowingDTO]:
    _windowing = None

    if oldest or newest:
        _windowing = WindowingDTO(oldest=oldest, newest=newest, window=window)

    return _windowing


def _parse_filtering(
    filtering: Optional[str] = None,
) -> Optional[FilteringDTO]:
    # Parse JSON filtering
    _filtering = None

    if filtering:
        try:
            filtering_json_data = loads(filtering)
            _filtering = FilteringDTO(**filtering_json_data)
        except JSONDecodeError as e:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid JSON filtering provided: {str(e)}",
            ) from e

    return _filtering


def _parse_grouping(
    focus: Optional[str] = None,
) -> Optional[GroupingDTO]:
    _grouping = None

    if focus != "node":
        _grouping = GroupingDTO(focus=focus or "tree")

    return _grouping


def _parse_pagination(
    page: Optional[int] = None,
    size: Optional[int] = None,
    next: Optional[str] = None,  # pylint: disable=W0622:redefined-builtin
    stop: Optional[str] = None,
) -> Optional[PaginationDTO]:
    _pagination = None

    if page and next:
        raise HTTPException(
            status_code=400,
            detail="Both 'page' and 'next' cannot be provided at the same time",
        )

    if size and stop:
        raise HTTPException(
            status_code=400,
            detail="Both 'size' and 'stop' cannot be provided at the same time",
        )

    if page and not size:
        raise HTTPException(
            status_code=400,
            detail="'size' is required when 'page' is provided",
        )

    _pagination = PaginationDTO(
        page=page,
        size=size,
        next=next,
        stop=stop,
    )

    return _pagination


def parse_query_request(
    # GROUPING
    # - Option 2: Flat query parameters
    focus: Optional[str] = Query(None),
    # WINDOWING
    # - Option 2: Flat query parameters
    oldest: Optional[str] = Query(None),
    newest: Optional[str] = Query(None),
    # FILTERING
    # - Option 1: Single query parameter as JSON
    filtering: Optional[str] = Query(None),
    # PAGINATION
    # - Option 2: Flat query parameters
    page: Optional[int] = Query(None),
    size: Optional[int] = Query(None),
    next: Optional[str] = Query(None),  # pylint: disable=W0622:redefined-builtin
    stop: Optional[str] = Query(None),
) -> QueryDTO:
    return QueryDTO(
        grouping=_parse_grouping(focus=focus),
        windowing=_parse_windowing(oldest=oldest, newest=newest),
        filtering=_parse_filtering(filtering=filtering),
        pagination=_parse_pagination(page=page, size=size, next=next, stop=stop),
    )


def parse_analytics_dto(
    # GROUPING
    # - Option 2: Flat query parameters
    focus: Optional[str] = Query(None),
    # WINDOWING
    # - Option 2: Flat query parameters
    oldest: Optional[str] = Query(None),
    newest: Optional[str] = Query(None),
    window: Optional[int] = Query(None),
    # FILTERING
    # - Option 1: Single query parameter as JSON
    filtering: Optional[str] = Query(None),
) -> AnalyticsDTO:
    return AnalyticsDTO(
        grouping=_parse_grouping(focus=focus),
        windowing=_parse_windowing(oldest=oldest, newest=newest, window=window),
        filtering=_parse_filtering(filtering=filtering),
    )


# --- PARSE SPAN DTO ---


def _get_attributes(
    attributes: Attributes,
    namespace: str,
):
    return {
        decode_key(namespace, key): decode_value(value)
        for key, value in attributes.items()
        if key != decode_key(namespace, key)
    }


def _parse_from_types(
    otel_span_dto: OTelSpanDTO,
) -> dict:
    types = _get_attributes(otel_span_dto.attributes, "type")

    if types.get("tree"):
        del otel_span_dto.attributes[encode_key("type", "tree")]

    if types.get("node"):
        del otel_span_dto.attributes[encode_key("type", "node")]

    return types


def _parse_from_semconv(
    attributes: Attributes,
) -> None:
    _attributes = copy(attributes)

    for old_key, value in _attributes.items():
        if old_key in CODEX["keys"]["attributes"]["exact"]["from"]:
            new_key = CODEX["maps"]["attributes"]["exact"]["from"][old_key]

            attributes[new_key] = value

            del attributes[old_key]

        else:
            for prefix_key in CODEX["keys"]["attributes"]["prefix"]["from"]:
                if old_key.startswith(prefix_key):
                    prefix = CODEX["maps"]["attributes"]["prefix"]["from"][prefix_key]

                    new_key = old_key.replace(prefix_key, prefix)

                    attributes[new_key] = value

                    del attributes[old_key]

            for dynamic_key in CODEX["keys"]["attributes"]["dynamic"]["from"]:
                if old_key == dynamic_key:
                    try:
                        new_key, new_value = CODEX["maps"]["attributes"]["dynamic"][
                            "from"
                        ][dynamic_key](value)

                        attributes[new_key] = new_value

                    except:  # pylint: disable=bare-except
                        pass


def _parse_from_links(
    otel_span_dto: OTelSpanDTO,
) -> dict:
    # LINKS
    links = None
    otel_links = None

    if otel_span_dto.links:
        links = list()
        otel_links = list()

        for link in otel_span_dto.links:
            _links = _get_attributes(link.attributes, "type")

            if _links:
                link_type = _links.get("link")
                link_tree_id = str(UUID(link.context.trace_id[2:]))
                link_node_id = str(
                    UUID(link.context.trace_id[2 + 16 :] + link.context.span_id[2:])
                )

                links.append(
                    LinkDTO(
                        type=link_type,
                        tree_id=link_tree_id,
                        id=link_node_id,
                    )
                )
            else:
                otel_links.append(link)

        links = links if links else None
        otel_links = otel_links if otel_links else None

    otel_span_dto.links = otel_links

    return links


def _parse_from_attributes(
    otel_span_dto: OTelSpanDTO,
) -> Tuple[dict, dict, dict, dict, dict]:
    # DATA
    _data = _get_attributes(otel_span_dto.attributes, "data")

    for key in _data.keys():
        del otel_span_dto.attributes[encode_key("data", key)]

    # _data = unmarshal_attributes(_data)
    _data = _data if _data else None

    # METRICS
    _metrics = _get_attributes(otel_span_dto.attributes, "metrics")

    for key in _metrics.keys():
        del otel_span_dto.attributes[encode_key("metrics", key)]

    # _metrics = unmarshal_attributes(_metrics)
    _metrics = _metrics if _metrics else None

    # META
    _meta = _get_attributes(otel_span_dto.attributes, "meta")

    for key in _meta.keys():
        del otel_span_dto.attributes[encode_key("meta", key)]

    # _meta = unmarshal_attributes(_meta)
    _meta = _meta if _meta else None

    # REFS
    _refs = _get_attributes(otel_span_dto.attributes, "refs")

    for key in _refs.keys():
        del otel_span_dto.attributes[encode_key("refs", key)]

    _refs = _refs if _refs else None

    if len(otel_span_dto.attributes.keys()) < 1:
        otel_span_dto.attributes = None

    return _data, _metrics, _meta, _refs


def _parse_from_events(
    otel_span_dto: OTelSpanDTO,
) -> Optional[ExceptionDTO]:
    exception = None

    _other_events = list()

    if otel_span_dto.events:
        for event in otel_span_dto.events:
            if event.name == "exception":
                exception = ExceptionDTO(
                    timestamp=event.timestamp,
                    type=event.attributes.get("exception.type"),
                    message=event.attributes.get("exception.message"),
                    stacktrace=event.attributes.get("exception.stacktrace"),
                    attributes=event.attributes,
                )

                del event.attributes["exception.type"]
                del event.attributes["exception.message"]
                del event.attributes["exception.stacktrace"]

            else:
                _other_events.append(event)

    otel_span_dto.events = _other_events if _other_events else None

    return exception


def parse_from_otel_span_dto(
    otel_span_dto: OTelSpanDTO,
) -> SpanDTO:
    """
    Process an OpenTelemetry span into a SpanDTO using the new architecture.

    This function maintains the same signature as the original but uses the new
    SpanProcessor internally (with NodeBuilder) for better handling of different data formats.
    The result from the processor is a dictionary, from which the 'node_builder' output is extracted.
    """
    processed_results = span_processor.process(otel_span_dto)
    span_dto = processed_results.get("node_builder")

    if not isinstance(span_dto, SpanDTO):
        log.error(
            f"NodeBuilder did not produce a valid SpanDTO for trace_id {otel_span_dto.context.trace_id}, "
            f"span_id {otel_span_dto.context.span_id}. Processor results: {processed_results}"
        )

    return span_dto


def _parse_to_attributes(
    span_dto: SpanDTO,
) -> Attributes:
    attributes = dict()

    # DATA
    if span_dto.data:
        _data = span_dto.data

        for key, value in _data.items():
            attributes[encode_key("data", key)] = encode_key(value)

    # METRICS
    if span_dto.metrics:
        _metrics = span_dto.metrics

        for key, value in _metrics.items():
            attributes[encode_key("metrics", key)] = encode_key(value)

    # META
    if span_dto.meta:
        _meta = span_dto.meta

        for key, value in _meta.items():
            attributes[encode_key("meta", key)] = encode_key(value)

    # REFS
    if span_dto.refs:
        for key, value in span_dto.refs.items():
            attributes[encode_key("refs", key)] = encode_key(value)

    return attributes


def _parse_to_types(
    span_dto: SpanDTO,
    attributes: Attributes,
) -> Attributes:
    if span_dto.tree.type:
        attributes[encode_key("type", "tree")] = span_dto.tree.type.value
    if span_dto.node.type:
        attributes[encode_key("type", "node")] = span_dto.node.type.value


def _parse_to_semconv(
    attributes: Attributes,
) -> None:
    _attributes = copy(attributes)

    for old_key, value in _attributes.items():
        if old_key in CODEX["keys"]["attributes"]["exact"]["to"]:
            new_key = CODEX["maps"]["attributes"]["exact"]["to"][old_key]

            attributes[new_key] = value

            del attributes[old_key]

        else:
            for prefix_key in CODEX["keys"]["attributes"]["prefix"]["to"]:
                if old_key.startswith(prefix_key):
                    prefix = CODEX["maps"]["attributes"]["prefix"]["to"][prefix_key]

                    new_key = old_key.replace(prefix_key, prefix)

                    attributes[new_key] = value

                    del attributes[old_key]


def _parse_to_links(
    span_dto: SpanDTO,
    links: List[LinkDTO],
) -> None:
    if span_dto.links:
        for link in span_dto.links:
            links.append(
                OTelLinkDTO(
                    context=OTelContextDTO(
                        trace_id="0x" + link.tree_id.hex,
                        span_id="0x" + link.id.hex[16:],
                    ),
                    attributes={
                        encode_key("type", "link"): link.type,
                    },
                )
            )


def _parse_to_events(
    span_dto: SpanDTO,
    events: List[OTelEventDTO],
) -> None:
    if span_dto.exception:
        exception = span_dto.exception

        exception_event = OTelEventDTO(
            name="exception",
            timestamp=exception.timestamp,
            attributes={
                "exception.type": exception.type,
                "exception.message": exception.message,
                "exception.stacktrace": exception.stacktrace,
            },
        )

        exception_event.attributes.update(exception.attributes)

        events.append(exception_event)


def parse_to_otel_span_dto(
    span_dto: SpanDTO,
) -> OTelSpanDTO:
    trace_id = "0x" + span_dto.tree.id.hex
    span_id = "0x" + span_dto.node.id.hex[16:]

    context = OTelContextDTO(trace_id=trace_id, span_id=span_id)

    parent_id = "0x" + span_dto.parent.id.hex[16:] if span_dto.parent else None

    parent = OTelContextDTO(trace_id=trace_id, span_id=parent_id) if parent_id else None

    attributes = _parse_to_attributes(span_dto)

    _parse_to_types(span_dto, attributes)

    _parse_to_semconv(attributes)

    attributes = OrderedDict(sorted(attributes.items())) if attributes.keys() else None

    links = span_dto.otel.links or list()

    _parse_to_links(span_dto, links)

    events = span_dto.otel.events or list()

    _parse_to_events(span_dto, events)

    links = links if links else None

    # MASK LINKS FOR NOW
    links = None
    # ------------------

    otel_span_dto = OTelSpanDTO(
        context=context,
        parent=parent,
        name=span_dto.node.name,
        kind=span_dto.otel.kind,
        start_time=span_dto.time.start,
        end_time=span_dto.time.end,
        status_code="STATUS_CODE_" + span_dto.status.code,
        status_message=span_dto.status.message,
        attributes=attributes,
        events=events,
        links=links,
    )

    return otel_span_dto


def parse_to_agenta_span_dto(
    span_dto: SpanDTO,
) -> SpanDTO:
    # DATA
    if span_dto.data:
        span_dto.data = unmarshal_attributes(span_dto.data)

        if "outputs" in span_dto.data:
            if (
                isinstance(span_dto.data["outputs"], dict)
                and "__default__" in span_dto.data["outputs"]
            ):
                span_dto.data["outputs"] = span_dto.data["outputs"]["__default__"]

    # METRICS
    if span_dto.metrics:
        span_dto.metrics = unmarshal_attributes(span_dto.metrics)

    # META
    if span_dto.meta:
        span_dto.meta = unmarshal_attributes(span_dto.meta)

    # REFS
    if span_dto.refs:
        span_dto.refs = unmarshal_attributes(span_dto.refs)

    # EXCEPTION
    if span_dto.exception:
        span_dto.exception.attributes = unmarshal_attributes(
            span_dto.exception.attributes
        )

    # LINKS
    if span_dto.links:
        for link in span_dto.links:
            link.tree_id = None

    # NODES
    if span_dto.nodes:
        for node in span_dto.nodes.values():
            if isinstance(node, list):
                for span in node:
                    parse_to_agenta_span_dto(span)
            else:
                parse_to_agenta_span_dto(node)

    # MASK LINKS FOR NOW
    span_dto.links = None
    # ------------------

    # MASK LIFECYCLE FOR NOW
    # span_dto.lifecycle = None
    if span_dto.lifecycle:
        span_dto.lifecycle.updated_at = None
        span_dto.lifecycle.updated_by_id = None
    # ----------------------

    return span_dto


# --- PARSE LEGACY ANALYTICS ---


def _parse_time_range(
    window_text: str,
) -> Tuple[datetime, datetime, int]:
    quantity, unit = window_text.split("_")
    quantity = int(quantity)

    today = datetime.now()
    newest = datetime.combine(today.date(), time.max)

    if unit == "hours":
        oldest = newest - timedelta(hours=quantity)
        window = 60  # 1 hour
        return newest, oldest, window

    elif unit == "days":
        oldest = newest - timedelta(days=quantity)
        window = 1440  # 1 day
        return newest, oldest, window

    else:
        raise ValueError(f"Unknown time unit: {unit}")


def parse_legacy_analytics_dto(
    timeRange: Optional[str] = Query(None),  # pylint: disable=invalid-name
    app_id: Optional[str] = Query(None),
    environment: Optional[str] = Query(None),
    variant: Optional[str] = Query(None),
) -> Optional[AnalyticsDTO]:
    if not timeRange and not environment and not variant:
        return None

    application_condition = None
    environment_condition = None
    variant_condition = None
    filtering = None

    if app_id:
        application_condition = ConditionDTO(
            key="refs.application.id",  # ID ?
            operator="is",
            value=app_id,
        )

    if environment:
        environment_condition = ConditionDTO(
            key="refs.environment.slug",  # SLUG ?
            operator="is",
            value=environment,
        )

    if variant:
        variant_condition = ConditionDTO(
            key="refs.variant.id",  # ID ?
            operator="is",
            value=variant,
        )

    if application_condition or environment_condition or variant_condition:
        filtering = FilteringDTO(
            conditions=[
                condition
                for condition in [
                    application_condition,
                    environment_condition,
                    variant_condition,
                ]
                if condition
            ]
        )

    windowing = None

    if timeRange:
        newest, oldest, window = _parse_time_range(timeRange)
        windowing = WindowingDTO(newest=newest, oldest=oldest, window=window)

    grouping = GroupingDTO(focus="tree")

    return AnalyticsDTO(
        grouping=grouping,
        windowing=windowing,
        filtering=filtering,
    )


def parse_legacy_analytics(
    bucket_dtos: List[BucketDTO],
) -> Tuple[List[LegacyDataPoint], LegacySummary]:
    data_points = list()

    total_failure = 0
    total_latency = 0.0

    summary = LegacySummary(
        total_count=0,
        failure_rate=0.0,
        total_cost=0.0,
        avg_cost=0.0,
        avg_latency=0.0,
        total_tokens=0,
        avg_tokens=0.0,
    )

    for bucket_dto in bucket_dtos:
        data_point = LegacyDataPoint(
            timestamp=bucket_dto.timestamp,
            success_count=(bucket_dto.total.count or 0) - (bucket_dto.error.count or 0),
            failure_count=bucket_dto.error.count or 0,
            cost=bucket_dto.total.cost or 0.0,
            latency=(
                ((bucket_dto.total.duration or 0.0) / bucket_dto.total.count)
                if bucket_dto.total.count
                else 0.0
            )
            / 1_000,
            total_tokens=bucket_dto.total.tokens or 0,
        )

        data_points.append(data_point)

        summary.total_count += bucket_dto.total.count if bucket_dto.total.count else 0
        summary.total_cost += bucket_dto.total.cost if bucket_dto.total.cost else 0.0
        summary.total_tokens += (
            bucket_dto.total.tokens if bucket_dto.total.tokens else 0
        )

        total_failure += bucket_dto.error.count if bucket_dto.error.count else 0
        total_latency += bucket_dto.total.duration if bucket_dto.total.duration else 0.0

    if summary.total_count:
        summary.failure_rate = (total_failure / summary.total_count) * 100

        summary.avg_cost = summary.total_cost / summary.total_count
        summary.avg_latency = (total_latency / summary.total_count) / 1_000
        summary.avg_tokens = summary.total_tokens / summary.total_count

    return data_points, summary
