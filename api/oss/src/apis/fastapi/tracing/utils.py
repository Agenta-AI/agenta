from typing import Optional, Union, Dict
from json import loads

from fastapi import Query as _Query

from oss.src.utils.logging import get_module_logger

from oss.src.core.tracing.dtos import (
    OTelAttributes,
    OTelSpan,
    OTelNestedSpans,
    OTelFlatSpans,
    OTelTraceTree,
    Formatting,
    Windowing,
    Filtering,
    Query,
    Focus,
    Format,
)

from oss.src.core.tracing.utils import (
    parse_timestamp_to_datetime,
    parse_trace_id_to_uuid,
    parse_span_id_to_uuid,
    parse_trace_id_from_uuid,
    parse_span_id_from_uuid,
    unmarshal_attributes,
    parse_span_idx_to_span_id_tree,
    connect_children,
)

log = get_module_logger(__name__)

# --- PARSE QUERY DTO ---


def _parse_windowing(
    oldest: Optional[Union[str, int]] = None,
    newest: Optional[Union[str, int]] = None,
    limit: Optional[int] = None,
) -> Optional[Windowing]:
    # if not oldest and not newest:
    #     oldest = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()

    oldest = parse_timestamp_to_datetime(oldest)
    newest = parse_timestamp_to_datetime(newest)

    _windowing = Windowing(oldest=oldest, newest=newest, limit=limit)

    return _windowing


def _parse_filtering(
    filter: Optional[Union[str, dict]] = None,  # pylint: disable=redefined-builtin
) -> Optional[Filtering]:
    # Accepts either a dict or a string (JSON)
    _filtering = None
    filtering_json_data = None

    if filter:
        if isinstance(filter, dict):
            filtering_json_data = filter
        elif isinstance(filter, str):
            try:
                filtering_json_data = loads(filter)
            except Exception as e:  # pylint: disable=broad-exception-caught
                log.warn(f"Error parsing filter string to JSON: {e}")
                filtering_json_data = None

        if filtering_json_data:
            try:
                _filtering = Filtering(**filtering_json_data)
            except Exception as e:  # pylint: disable=broad-exception-caught
                log.warn(f"Error parsing filter JSON to Filtering DTO: {e}")

    return _filtering


def _parse_formatting(
    focus: Optional[Focus] = Focus.TRACE,
    format: Optional[Format] = Format.AGENTA,  # pylint: disable=redefined-builtin
) -> Optional[Formatting]:
    _formatting = Formatting(
        focus=focus or Focus.SPAN,
        format=format or Format.AGENTA,
    )

    return _formatting


def parse_query_request(
    # GROUPING
    focus: Optional[Focus] = _Query(None),
    format: Optional[Format] = _Query(None),  # pylint: disable=redefined-builtin
    # WINDOWING
    oldest: Optional[Union[str, int]] = _Query(None),
    newest: Optional[Union[str, int]] = _Query(None),
    limit: Optional[int] = _Query(None),
    # FILTERING
    filter=_Query(None),  # pylint: disable=redefined-builtin
) -> Query:
    return parse_body_request(
        focus=focus,
        format=format,
        oldest=oldest,
        newest=newest,
        limit=limit,
        filter=filter,
    )


def parse_body_request(
    # GROUPING
    focus: Optional[Focus] = None,
    format: Optional[Format] = None,  # pylint: disable=redefined-builtin
    # WINDOWING
    oldest: Optional[Union[str, int]] = None,
    newest: Optional[Union[str, int]] = None,
    limit: Optional[int] = None,
    # FILTERING
    filter: Optional[Union[dict, str]] = None,  # pylint: disable=redefined-builtin
) -> Query:
    try:
        _query = Query(
            formatting=_parse_formatting(focus=focus, format=format),
            windowing=_parse_windowing(oldest=oldest, newest=newest, limit=limit),
            filtering=_parse_filtering(filter=filter),
        )
    except Exception as e:  # pylint: disable=broad-except
        log.warn(e)

        _query = None

    return _query


def merge_queries(
    query_param: Optional[Query] = None,
    query_body: Optional[Query] = None,
) -> Query:
    if query_body is None:
        if query_param.filtering is None:
            query_param.filtering = Filtering()
        return query_param

    if query_param is None:
        if query_body.filtering is None:
            query_body.filtering = Filtering()
        return query_body

    return Query(
        formatting=query_param.formatting or query_body.formatting or Formatting(),
        windowing=query_param.windowing or query_body.windowing or Windowing(),
        filtering=query_param.filtering or query_body.filtering or Filtering(),
    )


# --- PARSE TRACE/SPAN/PARENT ID ---


def _parse_span_from_request(
    raw_span: OTelSpan,
) -> Optional[OTelFlatSpans]:
    raw_span_dtos: OTelFlatSpans = []

    # HANDLE IDs (TRACE, SPAN, PARENT, LINKS)
    raw_span.trace_id = parse_trace_id_to_uuid(raw_span.trace_id)
    raw_span.span_id = parse_span_id_to_uuid(raw_span.span_id)

    if raw_span.parent_id:
        raw_span.parent_id = parse_span_id_to_uuid(raw_span.parent_id)

    if raw_span.links:
        for link in raw_span.links:
            link.trace_id = parse_trace_id_to_uuid(link.trace_id)
            link.span_id = parse_span_id_to_uuid(link.span_id)

    # HANDLE TIMESTAMPS
    raw_span.start_time = parse_timestamp_to_datetime(raw_span.start_time)
    raw_span.end_time = parse_timestamp_to_datetime(raw_span.end_time)

    # HANDLE ATTRIBUTES
    if not raw_span.attributes:
        raw_span.attributes = dict()

    raw_span.attributes = unmarshal_attributes(raw_span.attributes)

    # HANDLE LATENCY
    if not "agenta" in raw_span.attributes:
        raw_span.attributes["agenta"] = {}
    if not "metrics" in raw_span.attributes["agenta"]:
        raw_span.attributes["agenta"]["metrics"] = {}

    raw_span.attributes["agenta"]["metrics"]["latency"] = round(
        (raw_span.end_time - raw_span.start_time).total_seconds() * 1_000,
        3,
    )  # milliseconds

    # HANDLE EVENTS (TIMESTAMPS AND EXCEPTIONS)
    if raw_span.events:
        for event in raw_span.events:
            event.timestamp = parse_timestamp_to_datetime(event.timestamp)

            if event.name == "exception":
                if not "agenta" in raw_span.attributes:
                    raw_span.attributes["agenta"] = {}
                if not "metrics" in raw_span.attributes["agenta"]:
                    raw_span.attributes["agenta"]["metrics"] = {}

                raw_span.attributes["agenta"]["metrics"]["errors"] = 1

    # HANDLE CHILDREN
    if raw_span.spans:
        raw_span_dtos.extend(parse_spans_from_request(raw_span.spans))
        raw_span.spans = None

    raw_span_dtos.append(raw_span)

    return raw_span_dtos


def parse_spans_from_request(
    spans: Dict[str, Union[OTelSpan, OTelFlatSpans]],
) -> Optional[OTelFlatSpans]:
    raw_span_dtos: OTelFlatSpans = []
    span_dtos: OTelFlatSpans = []

    try:
        for span_group in spans.values():
            if isinstance(span_group, list):
                raw_span_dtos.extend(span_group)

            else:
                raw_span_dtos.append(span_group)

        for span in raw_span_dtos:
            span_dtos.extend(_parse_span_from_request(span))

    except Exception as e:  # pylint:disable=broad-exception-caught
        log.error(f"Error processing spans: {e}")

        span_dtos = []  # FULL RESET OR RETURN PARTIAL?

    return span_dtos


def _parse_span_into_response(
    span_dto: OTelSpan,
    marshall: Optional[bool] = False,
) -> Optional[OTelSpan]:
    if not span_dto.attributes:
        span_dto.attributes = OTelAttributes()

    # HANDLE IDs (TRACE, SPAN, PARENT, LINKS)
    span_dto.trace_id = parse_trace_id_from_uuid(span_dto.trace_id)
    span_dto.span_id = parse_span_id_from_uuid(span_dto.span_id)

    if span_dto.parent_id:
        span_dto.parent_id = parse_span_id_from_uuid(span_dto.parent_id)

    if span_dto.links:
        for link in span_dto.links:
            link.trace_id = parse_trace_id_from_uuid(link.trace_id)
            link.span_id = parse_span_id_from_uuid(link.span_id)

    # HANDLE ATTRIBUTES
    if marshall:
        pass  # TODO: MARSHALL ATTRIBUTES

    return span_dto


def parse_spans_into_response(
    span_dtos: OTelFlatSpans,
    focus: Focus,
    format: Format,
) -> Optional[Union[OTelFlatSpans, OTelTraceTree]]:
    clean_span_dtos: OTelFlatSpans = []

    spans: OTelFlatSpans = None
    traces: OTelTraceTree = None

    try:
        for span_dto in span_dtos:
            clean_span_dtos.append(
                _parse_span_into_response(
                    span_dto,
                    marshall=(format == Format.OPENTELEMETRY),
                )
            )

        if format == Format.AGENTA and focus == Focus.TRACE:
            span_lookup = {span.span_id: span for span in clean_span_dtos}

            span_id_tree = parse_span_idx_to_span_id_tree(span_lookup)

            connect_children(span_id_tree, span_lookup)

            span_lookup: OTelNestedSpans

            traces: OTelTraceTree = {
                span_dto.trace_id: {"spans": {span_dto.span_name: span_dto}}
                for span_dto in span_lookup.values()
                if span_dto.parent_id is None
            }

        else:
            spans: OTelFlatSpans = clean_span_dtos

    except Exception as e:  # pylint:disable=broad-exception-caught
        log.error(f"Error processing spans: {e}")

        if format == Format.AGENTA and focus == Focus.TRACE:
            traces: OTelTraceTree = {}  # FULL RESET OR RETURN PARTIAL?
        else:
            spans: OTelFlatSpans = []

    return spans if spans else traces
